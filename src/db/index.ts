import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA } from './schema.js';

export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'outlook.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON'); // makes ON DELETE CASCADE actually fire
  db.exec(SCHEMA);
  return db;
}
