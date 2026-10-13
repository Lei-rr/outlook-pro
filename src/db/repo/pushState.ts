import type { Ctx } from './types.js';

// Per-account state for the Telegram push job.
// last_pushed_at = watermark of the newest pushed message.
// updated_at     = when the account was last checked (drives fair rotation).
export function pushStateRepo({ db }: Ctx) {
  return {
    watermark(accountId: number): string {
      const row = db
        .prepare('SELECT last_pushed_at FROM push_state WHERE account_id = ?')
        .get(accountId) as { last_pushed_at: string } | undefined;
      return row?.last_pushed_at ?? '';
    },

    markChecked(accountId: number, lastPushedAt?: string): void {
      if (lastPushedAt !== undefined) {
        db.prepare(
          `INSERT INTO push_state (account_id, last_pushed_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(account_id) DO UPDATE SET last_pushed_at = excluded.last_pushed_at, updated_at = CURRENT_TIMESTAMP`
        ).run(accountId, lastPushedAt);
      } else {
        db.prepare(
          `INSERT INTO push_state (account_id, last_pushed_at, updated_at) VALUES (?, '', CURRENT_TIMESTAMP)
           ON CONFLICT(account_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`
        ).run(accountId);
      }
    },
  };
}
