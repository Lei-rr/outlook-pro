import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  up: string;
}

// Ordered and append-only. Migration 1 is the original schema and stays
// replayable, because a database created before this list existed reports
// user_version 0 and therefore runs it once more — which is why every statement
// in it is IF NOT EXISTS.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  color       TEXT DEFAULT '#2563eb',
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO groups (id, name, description, color)
VALUES (1, '默认分组', '默认邮箱分组', '#2563eb');

CREATE TABLE IF NOT EXISTS accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE,
  client_id         TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  password          TEXT DEFAULT '',
  group_id          INTEGER DEFAULT 1,
  remark            TEXT DEFAULT '',
  status            TEXT DEFAULT 'active',
  last_refreshed_at TEXT DEFAULT '',
  refresh_fail_count INTEGER DEFAULT 0,
  last_refresh_error TEXT DEFAULT '',
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id)
);
CREATE INDEX IF NOT EXISTS idx_accounts_group   ON accounts(group_id);
CREATE INDEX IF NOT EXISTS idx_accounts_refresh ON accounts(last_refreshed_at);
-- The accounts table is always listed newest-first; without this the query falls
-- back to "USE TEMP B-TREE FOR ORDER BY" on the whole table.
CREATE INDEX IF NOT EXISTS idx_accounts_created ON accounts(created_at DESC);
-- Status filtering moved server-side (the table is paginated), so the count and
-- page queries both filter on it.
CREATE INDEX IF NOT EXISTS idx_accounts_status  ON accounts(status);

CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_tags (
  account_id INTEGER NOT NULL,
  tag_id     INTEGER NOT NULL,
  PRIMARY KEY (account_id, tag_id),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)     REFERENCES tags(id)     ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_account_tags_tag ON account_tags(tag_id);

CREATE TABLE IF NOT EXISTS push_state (
  account_id     INTEGER PRIMARY KEY,
  last_pushed_at TEXT DEFAULT '',
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
`,
  },
  {
    version: 2,
    up: `
-- The GPTMail temp-mailbox feature is gone; its table only ever held scratch data.
DROP TABLE IF EXISTS temp_emails;
`,
  },
  {
    version: 3,
    up: `
-- Refresh scheduling. Without this a failed account keeps its old
-- last_refreshed_at, which is the queue's sort key, so it re-enters at the front
-- of every run and starves healthy accounts out of the batch.
ALTER TABLE accounts ADD COLUMN next_refresh_at TEXT DEFAULT '';

-- getByEmail filters on lower(email), which the unique index on email cannot
-- serve: that query was a full table scan (4ms vs 0.14ms over 7916 rows).
CREATE INDEX IF NOT EXISTS idx_accounts_email_lower ON accounts(lower(email));
`,
  },
  {
    version: 4,
    up: `
-- Every refresh attempt, so "has this account been flapping?" is answerable.
-- The refresh job prunes rows older than 30 days once per run.
CREATE TABLE IF NOT EXISTS refresh_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  ok         INTEGER NOT NULL,
  message    TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_log_account ON refresh_log(account_id, id DESC);
`,
  },
];

// Applies every migration newer than PRAGMA user_version, each in its own
// transaction so a failure leaves the database at the last good version.
export function applyMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}
