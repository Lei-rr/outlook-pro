import { yieldToLoop } from '../../core/async.js';
import { decryptField, encryptField } from '../../core/crypto.js';
import type { AccountRow, Ctx } from './types.js';

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
  next_refresh_at: string;
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

export interface AccountFilter {
  groupId?: number;
  keyword?: string;
  tagId?: number;
  status?: string;
}

export interface AccountPage {
  items: AccountListRow[];
  total: number;
}

// id/email/status only, for pickers that need every account but no row detail.
export interface AccountOption {
  id: number;
  email: string;
  status: string;
}

// Whitelist for the list's ORDER BY. Anything unknown falls back to created_at,
// so a client-supplied string never reaches the SQL.
const SORT_COLUMNS: Record<string, string> = {
  created: 'a.created_at',
  email: 'a.email',
  status: 'a.status',
  refreshed: 'a.last_refreshed_at',
  fails: 'a.refresh_fail_count',
};

// Shared WHERE/JOIN builder for the account list queries.
function buildFilter(filter: AccountFilter) {
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
  if (filter.status) {
    conditions.push('a.status = ?');
    params.push(filter.status);
  }
  if (filter.keyword) {
    conditions.push('(a.email LIKE ? OR a.remark LIKE ?)');
    params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
  }

  return { join, where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

export function accountsRepo({ db, key }: Ctx) {
  const enc = (v: string) => encryptField(v, key);

  interface ExportRow {
    id: number;
    email: string;
    password: string;
    client_id: string;
    refresh_token: string;
  }

  const exportLine = (r: ExportRow): string =>
    `${r.email}----${decryptField(r.password, key)}----${decryptField(r.client_id, key)}----${decryptField(r.refresh_token, key)}`;

  const EXPORT_CHUNK = 500;

  // Walks the table by id and yields the export in chunks. Building the whole file
  // in one string blocked the event loop for the entire request; this keeps memory
  // flat and lets queued requests run between chunks.
  async function* exportLines(opts: { filter?: AccountFilter; ids?: number[] }): AsyncGenerator<string> {
    if (opts.ids?.length) {
      const stmt = db.prepare('SELECT id, email, password, client_id, refresh_token FROM accounts WHERE id = ?');
      for (let i = 0; i < opts.ids.length; i += EXPORT_CHUNK) {
        const lines = opts.ids
          .slice(i, i + EXPORT_CHUNK)
          .map((id) => stmt.get(id) as ExportRow | undefined)
          .filter((r): r is ExportRow => r !== undefined)
          .map(exportLine);
        if (lines.length) yield lines.join('\n') + '\n';
        await yieldToLoop();
      }
      return;
    }

    // Same filters as the table, so "export what I am looking at" means the same
    // thing on both sides.
    const { join, where, params } = buildFilter(opts.filter ?? {});
    const stmt = db.prepare(
      `SELECT a.id, a.email, a.password, a.client_id, a.refresh_token
       FROM accounts a${join}${where ? `${where} AND` : ' WHERE'} a.id > ?
       ORDER BY a.id LIMIT ?`
    );
    let cursor = 0;
    for (;;) {
      const rows = stmt.all(...params, cursor, EXPORT_CHUNK) as ExportRow[];
      if (!rows.length) return;
      cursor = rows[rows.length - 1]!.id;
      yield rows.map(exportLine).join('\n') + '\n';
      await yieldToLoop();
    }
  }

  return {
    // One page of the table listing. Secret columns are deliberately not read:
    // the UI only ever shows them masked, so decrypting ~24k AES fields per
    // request would be pure waste. `id` is always the tiebreaker so that paging
    // through equal sort values can neither repeat nor drop rows.
    listForTable(
      filter: AccountFilter = {},
      page: { limit: number; offset: number; sort?: string; order?: string }
    ): AccountPage {
      const { join, where, params } = buildFilter(filter);
      const column = SORT_COLUMNS[page.sort ?? ''] ?? SORT_COLUMNS.created;
      const dir = page.order === 'asc' ? 'ASC' : 'DESC';
      const total = (
        db.prepare(`SELECT COUNT(*) AS c FROM accounts a${join}${where}`).get(...params) as { c: number }
      ).c;
      const items = db
        .prepare(
          `SELECT a.id, a.email, a.group_id, a.remark, a.status, a.last_refreshed_at,
                  a.last_refresh_error, a.next_refresh_at, a.refresh_fail_count,
                  a.created_at, a.updated_at,
                  g.name AS group_name, g.color AS group_color
           FROM accounts a LEFT JOIN groups g ON a.group_id = g.id${join}${where}
           ORDER BY ${column} ${dir}, a.id ${dir} LIMIT ? OFFSET ?`
        )
        .all(...params, page.limit, page.offset) as AccountListRow[];
      return { items, total };
    },

    // Ids of every row matching the filter, for "apply to all N matches".
    idsMatching(filter: AccountFilter = {}): number[] {
      const { join, where, params } = buildFilter(filter);
      return (db.prepare(`SELECT a.id FROM accounts a${join}${where}`).all(...params) as { id: number }[]).map(
        (r) => r.id
      );
    },

    // How many accounts the next refresh run would consider.
    countDue(cutoffIso: string): number {
      return (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM accounts
             WHERE status != 'disabled'
               AND (last_refreshed_at = '' OR last_refreshed_at < ?)
               AND (next_refresh_at = '' OR next_refresh_at <= CURRENT_TIMESTAMP)`
          )
          .get(cutoffIso) as { c: number }
      ).c;
    },

    // Whole-set id/email/status list for the mail page's account picker, which
    // needs every account but none of the per-row detail.
    options(): AccountOption[] {
      return db
        .prepare('SELECT id, email, status FROM accounts ORDER BY created_at DESC')
        .all() as AccountOption[];
    },

    exportLines,

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
    // `overwrite` turns it into an upsert, which is what a re-import needs once
    // Microsoft has rotated the refresh tokens. The group is deliberately left
    // alone: re-importing a file should not silently move existing accounts.
    createBulk(rows: AccountInput[], groupId: number, overwrite = false): number {
      const stmt = db.prepare(
        overwrite
          ? `INSERT INTO accounts (email, password, client_id, refresh_token, group_id)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(email) DO UPDATE SET
               password = excluded.password,
               client_id = excluded.client_id,
               refresh_token = excluded.refresh_token,
               status = 'active',
               refresh_fail_count = 0,
               last_refresh_error = '',
               next_refresh_at = '',
               updated_at = CURRENT_TIMESTAMP`
          : `INSERT OR IGNORE INTO accounts (email, password, client_id, refresh_token, group_id)
             VALUES (?, ?, ?, ?, ?)`
      );
      const tx = db.transaction((items: AccountInput[]) => {
        let changed = 0;
        for (const it of items) {
          const info = stmt.run(
            it.email,
            enc(it.password ?? ''),
            enc(it.client_id),
            enc(it.refresh_token),
            groupId
          );
          changed += info.changes;
        }
        return changed;
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
    // next_refresh_at holds failed accounts back so a dead token cannot occupy a
    // slot in every single run while healthy accounts wait.
    dueForRefresh(cutoffIso: string, limit: number): AccountRow[] {
      const rows = db
        .prepare(
          `SELECT * FROM accounts
           WHERE status != 'disabled'
             AND (last_refreshed_at = '' OR last_refreshed_at < ?)
             AND (next_refresh_at = '' OR next_refresh_at <= CURRENT_TIMESTAMP)
           ORDER BY last_refreshed_at ASC LIMIT ?`
        )
        .all(cutoffIso, limit) as AccountRow[];
      return rows.map((r) => decrypt(r, key));
    },

    markRefreshed(id: number, rotatedToken?: string): void {
      if (rotatedToken) {
        db.prepare(
          `UPDATE accounts SET refresh_token = ?, status = 'active', refresh_fail_count = 0,
             last_refresh_error = '', next_refresh_at = '', last_refreshed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(enc(rotatedToken), id);
      } else {
        db.prepare(
          `UPDATE accounts SET status = 'active', refresh_fail_count = 0, last_refresh_error = '',
             next_refresh_at = '', last_refreshed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(id);
      }
    },

    // last_refreshed_at doubles as the refresh queue's sort key, so a failure has
    // to advance it too: leaving it untouched kept the account at the head of the
    // queue, where it was retried ahead of healthy accounts on every run.
    // next_refresh_at then applies an exponential backoff - 6h, 12h, 24h, 48h,
    // 96h, capped at 7 days - so a permanently dead token stops burning quota.
    markError(id: number, message: string): void {
      db.prepare(
        `UPDATE accounts SET
           status = 'error',
           refresh_fail_count = refresh_fail_count + 1,
           last_refresh_error = ?,
           last_refreshed_at = CURRENT_TIMESTAMP,
           next_refresh_at = datetime('now', '+' || MIN(168, 6 * (1 << MIN(refresh_fail_count, 5))) || ' hours'),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(message.slice(0, 500), id);
    },
  };
}
