import { decryptField, encryptField } from '../../core/crypto.js';
import type { AccountRow, AccountWithGroup, Ctx } from './types.js';

export interface AccountInput {
  email: string;
  client_id: string;
  refresh_token: string;
  password?: string;
  group_id?: number;
  remark?: string;
}

export interface AccountPatch {
  email?: string;
  client_id?: string;
  refresh_token?: string;
  password?: string;
  group_id?: number;
  remark?: string;
  status?: string;
}

function decrypt(row: AccountRow, key: Buffer): AccountRow {
  return {
    ...row,
    client_id: decryptField(row.client_id, key),
    refresh_token: decryptField(row.refresh_token, key),
    password: decryptField(row.password, key),
  };
}

export interface AccountListRow {
  id: number;
  email: string;
  group_id: number;
  remark: string;
  status: string;
  last_refreshed_at: string;
  last_refresh_error: string;
  refresh_fail_count: number;
  created_at: string;
  updated_at: string;
  group_name: string;
  group_color: string;
}

export interface AccountStats {
  total: number;
  status: Record<string, number>;
  groups: { group_id: number; count: number }[];
  errors: { id: number; email: string }[];
}

// Shared WHERE/JOIN builder for the account list queries.
function buildFilter(filter: { groupId?: number; keyword?: string; tagId?: number }) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let join = '';

  if (filter.tagId) {
    join += ' JOIN account_tags at ON at.account_id = a.id';
    conditions.push('at.tag_id = ?');
    params.push(filter.tagId);
  }
  if (filter.groupId) {
    conditions.push('a.group_id = ?');
    params.push(filter.groupId);
  }
  if (filter.keyword) {
    conditions.push('(a.email LIKE ? OR a.remark LIKE ?)');
    params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
  }

  return { join, where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

export function accountsRepo({ db, key }: Ctx) {
  const enc = (v: string) => encryptField(v, key);

  return {
    list(filter: { groupId?: number; keyword?: string; tagId?: number } = {}): AccountWithGroup[] {
      const { join, where, params } = buildFilter(filter);
      const rows = db
        .prepare(
          `SELECT a.*, g.name AS group_name, g.color AS group_color
           FROM accounts a LEFT JOIN groups g ON a.group_id = g.id${join}${where}
           ORDER BY a.created_at DESC`
        )
        .all(...params) as AccountWithGroup[];
      return rows.map((r) => ({ ...decrypt(r, key), group_name: r.group_name, group_color: r.group_color }));
    },

    // Table listing for the accounts page. The secret columns are deliberately
    // not read: the UI only ever shows them masked, so decrypting ~24k AES fields
    // per request (the single biggest cost in this endpoint) would be pure waste.
    listForTable(filter: { groupId?: number; keyword?: string; tagId?: number } = {}): AccountListRow[] {
      const { join, where, params } = buildFilter(filter);
      return db
        .prepare(
          `SELECT a.id, a.email, a.group_id, a.remark, a.status, a.last_refreshed_at,
                  a.last_refresh_error, a.refresh_fail_count, a.created_at, a.updated_at,
                  g.name AS group_name, g.color AS group_color
           FROM accounts a LEFT JOIN groups g ON a.group_id = g.id${join}${where}
           ORDER BY a.created_at DESC`
        )
        .all(...params) as AccountListRow[];
    },

    // Aggregates for the dashboard: a few hundred bytes instead of shipping every
    // account row (and decrypting it) just to count statuses on the client.
    stats(): AccountStats {
      const statusRows = db
        .prepare('SELECT status, COUNT(*) AS count FROM accounts GROUP BY status')
        .all() as { status: string; count: number }[];
      const status: Record<string, number> = {};
      let total = 0;
      for (const r of statusRows) {
        status[r.status] = r.count;
        total += r.count;
      }
      return {
        total,
        status,
        groups: db
          .prepare('SELECT group_id, COUNT(*) AS count FROM accounts GROUP BY group_id')
          .all() as { group_id: number; count: number }[],
        errors: db
          .prepare("SELECT id, email FROM accounts WHERE status = 'error' ORDER BY updated_at DESC LIMIT 3")
          .all() as { id: number; email: string }[],
      };
    },

    get(id: number): AccountRow | null {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
      return row ? decrypt(row, key) : null;
    },

    getByEmail(email: string): AccountRow | null {
      const row = db
        .prepare('SELECT * FROM accounts WHERE lower(email) = lower(?)')
        .get(email) as AccountRow | undefined;
      return row ? decrypt(row, key) : null;
    },

    create(input: AccountInput): number {
      const info = db
        .prepare(
          `INSERT INTO accounts (email, client_id, refresh_token, password, group_id, remark)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.email,
          enc(input.client_id),
          enc(input.refresh_token),
          enc(input.password ?? ''),
          input.group_id ?? 1,
          input.remark ?? ''
        );
      return Number(info.lastInsertRowid);
    },

    // One transaction for the whole batch: atomic and far faster than N inserts.
    createBulk(rows: AccountInput[], groupId: number): number {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO accounts (email, password, client_id, refresh_token, group_id)
         VALUES (?, ?, ?, ?, ?)`
      );
      const tx = db.transaction((items: AccountInput[]) => {
        let added = 0;
        for (const it of items) {
          const info = stmt.run(
            it.email,
            enc(it.password ?? ''),
            enc(it.client_id),
            enc(it.refresh_token),
            groupId
          );
          added += info.changes;
        }
        return added;
      });
      return tx(rows);
    },

    update(id: number, patch: AccountPatch): void {
      const sets: string[] = [];
      const params: unknown[] = [];
      const put = (col: string, value: unknown) => {
        sets.push(`${col} = ?`);
        params.push(value);
      };

      if (patch.email !== undefined) put('email', patch.email);
      if (patch.client_id !== undefined) put('client_id', enc(patch.client_id));
      if (patch.refresh_token !== undefined) put('refresh_token', enc(patch.refresh_token));
      if (patch.password !== undefined) put('password', enc(patch.password));
      if (patch.group_id !== undefined) put('group_id', patch.group_id);
      if (patch.remark !== undefined) put('remark', patch.remark);
      if (patch.status !== undefined) put('status', patch.status);

      if (!sets.length) return;
      sets.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id);
      db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    },

    remove(id: number): void {
      // push_state / account_tags rows go away via ON DELETE CASCADE.
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    },

    batch(ids: number[], action: 'delete' | 'move' | 'enable' | 'disable', groupId?: number): void {
      const placeholders = ids.map(() => '?').join(',');
      const tx = db.transaction(() => {
        if (action === 'delete') {
          db.prepare(`DELETE FROM accounts WHERE id IN (${placeholders})`).run(...ids);
        } else if (action === 'move') {
          db.prepare(
            `UPDATE accounts SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
          ).run(groupId ?? 1, ...ids);
        } else {
          const status = action === 'enable' ? 'active' : 'disabled';
          db.prepare(
            `UPDATE accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
          ).run(status, ...ids);
        }
      });
      tx();
    },

    // Accounts least recently checked for new mail (never-checked first).
    dueForPush(limit: number): AccountRow[] {
      const rows = db
        .prepare(
          `SELECT a.* FROM accounts a
           LEFT JOIN push_state ps ON ps.account_id = a.id
           WHERE a.status != 'disabled'
           ORDER BY COALESCE(ps.updated_at, '') ASC LIMIT ?`
        )
        .all(limit) as AccountRow[];
      return rows.map((r) => decrypt(r, key));
    },

    // Accounts whose token is due for a keep-alive refresh, oldest first.
    dueForRefresh(cutoffIso: string, limit: number): AccountRow[] {
      const rows = db
        .prepare(
          `SELECT * FROM accounts
           WHERE status != 'disabled' AND (last_refreshed_at = '' OR last_refreshed_at < ?)
           ORDER BY last_refreshed_at ASC LIMIT ?`
        )
        .all(cutoffIso, limit) as AccountRow[];
      return rows.map((r) => decrypt(r, key));
    },

    markRefreshed(id: number, rotatedToken?: string): void {
      if (rotatedToken) {
        db.prepare(
          `UPDATE accounts SET refresh_token = ?, status = 'active', refresh_fail_count = 0,
             last_refresh_error = '', last_refreshed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(enc(rotatedToken), id);
      } else {
        db.prepare(
          `UPDATE accounts SET status = 'active', refresh_fail_count = 0, last_refresh_error = '',
             last_refreshed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(id);
      }
    },

    markError(id: number, message: string): void {
      db.prepare(
        `UPDATE accounts SET status = 'error', refresh_fail_count = refresh_fail_count + 1,
           last_refresh_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(message.slice(0, 500), id);
    },
  };
}
