import { decryptField, encryptField } from '../../core/crypto.js';
import type { Ctx } from './types.js';

// Secrets stored in settings that must be encrypted at rest.
const SECRET_KEYS = new Set(['telegram_bot_token']);

export function settingsRepo({ db, key }: Ctx) {
  return {
    get(name: string): string {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(name) as
        | { value: string }
        | undefined;
      if (!row) return '';
      return SECRET_KEYS.has(name) ? decryptField(row.value, key) : row.value;
    },

    set(name: string, value: string): void {
      const stored = SECRET_KEYS.has(name) ? encryptField(value, key) : value;
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      ).run(name, stored);
    },

    all(): Record<string, string> {
      const rows = db.prepare('SELECT key, value FROM settings').all() as {
        key: string;
        value: string;
      }[];
      const out: Record<string, string> = {};
      for (const r of rows) {
        out[r.key] = SECRET_KEYS.has(r.key) ? decryptField(r.value, key) : r.value;
      }
      return out;
    },

    remove(name: string): void {
      db.prepare('DELETE FROM settings WHERE key = ?').run(name);
    },
  };
}
