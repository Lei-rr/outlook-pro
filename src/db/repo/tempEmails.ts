import type { Ctx, TempEmailRow } from './types.js';

export function tempEmailsRepo({ db }: Ctx) {
  return {
    list(): TempEmailRow[] {
      return db.prepare('SELECT * FROM temp_emails ORDER BY created_at DESC').all() as TempEmailRow[];
    },

    get(id: number): TempEmailRow | null {
      return (db.prepare('SELECT * FROM temp_emails WHERE id = ?').get(id) as TempEmailRow | undefined) ?? null;
    },

    create(email: string, source: string): void {
      db.prepare('INSERT INTO temp_emails (email, source) VALUES (?, ?)').run(email, source);
    },

    remove(id: number): void {
      db.prepare('DELETE FROM temp_emails WHERE id = ?').run(id);
    },
  };
}
