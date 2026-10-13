import type Database from 'better-sqlite3';
import { accountsRepo } from './accounts.js';
import { groupsRepo } from './groups.js';
import { pushStateRepo } from './pushState.js';
import { refreshLogRepo } from './refreshLog.js';
import { settingsRepo } from './settings.js';
import { tagsRepo } from './tags.js';

export function createRepo(db: Database.Database, key: Buffer) {
  const ctx = { db, key };
  return {
    db,
    settings: settingsRepo(ctx),
    accounts: accountsRepo(ctx),
    groups: groupsRepo(ctx),
    tags: tagsRepo(ctx),
    pushState: pushStateRepo(ctx),
    refreshLog: refreshLogRepo(ctx),
  };
}

export type Repo = ReturnType<typeof createRepo>;
export * from './types.js';
