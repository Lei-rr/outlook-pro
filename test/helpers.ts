import Database from 'better-sqlite3';
import { createRepo } from '../src/db/repo/index.js';
import { applyMigrations } from '../src/db/schema.js';

export function makeRepo() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  const key = Buffer.alloc(32, 7);
  return { db, repo: createRepo(db, key) };
}

export function cookieOf(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}
