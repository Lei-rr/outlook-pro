import type { Ctx } from './types.js';

export interface RefreshLogRow {
  id: number;
  account_id: number;
  ok: number;
  message: string;
  created_at: string;
}

export interface RefreshEntry {
  accountId: number;
  ok: boolean;
  message?: string;
}

export function refreshLogRepo({ db }: Ctx) {
  return {
    // One transaction for the whole run: a batch of 200 separate inserts would
    // fsync 200 times.
    addMany(entries: RefreshEntry[]): void {
      if (!entries.length) return;
      const stmt = db.prepare('INSERT INTO refresh_log (account_id, ok, message) VALUES (?, ?, ?)');
      const tx = db.transaction((items: RefreshEntry[]) => {
        for (const e of items) stmt.run(e.accountId, e.ok ? 1 : 0, (e.message ?? '').slice(0, 300));
      });
      tx(entries);
    },

    forAccount(accountId: number, limit = 20): RefreshLogRow[] {
      return db
        .prepare('SELECT * FROM refresh_log WHERE account_id = ? ORDER BY id DESC LIMIT ?')
        .all(accountId, limit) as RefreshLogRow[];
    },

    // Keeps the table bounded. Called once per refresh run.
    prune(days = 30): number {
      return db
        .prepare("DELETE FROM refresh_log WHERE created_at < datetime('now', '-' || ? || ' days')")
        .run(days).changes;
    },

    // Attempt counts for the whole retention window, for the dashboard.
    totals(): { ok: number; failed: number } {
      const rows = db.prepare('SELECT ok, COUNT(*) AS c FROM refresh_log GROUP BY ok').all() as {
        ok: number;
        c: number;
      }[];
      const out = { ok: 0, failed: 0 };
      for (const r of rows) {
        if (r.ok) out.ok = r.c;
        else out.failed = r.c;
      }
      return out;
    },
  };
}
