import type Database from 'better-sqlite3';
import { accountsRepo } from './accounts.js';
import { groupsRepo } from './groups.js';
import { pushStateRepo } from './pushState.js';
import { settingsRepo } from './settings.js';
import { tagsRepo } from './tags.js';
import { tempEmailsRepo } from './tempEmails.js';

export function createRepo(db: Database.Database, key: Buffer) {
  const ctx = { db, key };
  return {
    db,
    settings: settingsRepo(ctx),
    accounts: accountsRepo(ctx),
    groups: groupsRepo(ctx),
    tags: tagsRepo(ctx),
    tempEmails: tempEmailsRepo(ctx),
    pushState: pushStateRepo(ctx),
  };
}

export type Repo = ReturnType<typeof createRepo>;
export * from './types.js';
