import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyMigrations } from './schema.js';

export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'outlook.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON'); // makes ON DELETE CASCADE actually fire
  // WAL + NORMAL is the recommended pairing: still crash-safe, but commits skip
  // the per-transaction fsync.
  db.pragma('synchronous = NORMAL');
  applyMigrations(db);
  return db;
}
