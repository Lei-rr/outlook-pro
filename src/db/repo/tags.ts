import type { Ctx, TagRow } from './types.js';

// SQLite caps a single statement at 32766 bound parameters, so account id lists
// are chunked rather than inlined into one huge IN (...).
const ID_CHUNK = 900;

export function tagsRepo({ db }: Ctx) {
  return {
    list(): (TagRow & { account_count: number })[] {
      return db
        .prepare(
          `SELECT t.*, COUNT(at.account_id) AS account_count
           FROM tags t LEFT JOIN account_tags at ON t.id = at.tag_id
           GROUP BY t.id ORDER BY t.name`
        )
        .all() as (TagRow & { account_count: number })[];
    },

    get(id: number): TagRow | null {
      return (db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined) ?? null;
    },

    create(input: { name: string; color?: string }): void {
      db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(input.name, input.color ?? '#6366f1');
    },

    update(id: number, input: { name: string; color: string }): void {
      db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(input.name, input.color, id);
    },

    // account_tags rows are removed by ON DELETE CASCADE.
    remove(id: number): void {
      db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    },

    setForAccount(accountId: number, tagIds: number[]): void {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM account_tags WHERE account_id = ?').run(accountId);
        const ins = db.prepare('INSERT OR IGNORE INTO account_tags (account_id, tag_id) VALUES (?, ?)');
        for (const tid of tagIds) ins.run(accountId, tid);
      });
      tx();
    },

    // Batch-load tags for a set of accounts to avoid an N+1 query.
    forAccounts(ids: number[]): Map<number, { id: number; name: string; color: string }[]> {
      const map = new Map<number, { id: number; name: string; color: string }[]>();
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const slice = ids.slice(i, i + ID_CHUNK);
        const placeholders = slice.map(() => '?').join(',');
        const rows = db
          .prepare(
            `SELECT at.account_id, t.id, t.name, t.color
             FROM account_tags at JOIN tags t ON t.id = at.tag_id
             WHERE at.account_id IN (${placeholders}) ORDER BY t.name`
          )
          .all(...slice) as { account_id: number; id: number; name: string; color: string }[];
        for (const r of rows) {
          const list = map.get(r.account_id) ?? [];
          list.push({ id: r.id, name: r.name, color: r.color });
          map.set(r.account_id, list);
        }
      }
      return map;
    },

    forAccount(accountId: number): { id: number; name: string; color: string }[] {
      return this.forAccounts([accountId]).get(accountId) ?? [];
    },
  };
}
