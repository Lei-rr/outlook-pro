import type { Ctx, GroupRow } from './types.js';

export function groupsRepo({ db }: Ctx) {
  return {
    list(): (GroupRow & { account_count: number })[] {
      return db
        .prepare(
          `SELECT g.*, (SELECT COUNT(*) FROM accounts a WHERE a.group_id = g.id) AS account_count
           FROM groups g ORDER BY g.id`
        )
        .all() as (GroupRow & { account_count: number })[];
    },

    get(id: number): GroupRow | null {
      return (db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined) ?? null;
    },

    create(input: { name: string; description?: string; color?: string }): number {
      const info = db
        .prepare('INSERT INTO groups (name, description, color) VALUES (?, ?, ?)')
        .run(input.name, input.description ?? '', input.color ?? '#2563eb');
      return Number(info.lastInsertRowid);
    },

    update(id: number, input: { name: string; description: string; color: string }): void {
      db.prepare(
        'UPDATE groups SET name = ?, description = ?, color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(input.name, input.description, input.color, id);
    },

    // Move members to the default group first so the FK constraint stays satisfied.
    remove(id: number): void {
      const tx = db.transaction(() => {
        db.prepare('UPDATE accounts SET group_id = 1 WHERE group_id = ?').run(id);
        db.prepare('DELETE FROM groups WHERE id = ?').run(id);
      });
      tx();
    },
  };
}
