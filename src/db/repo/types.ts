import type Database from 'better-sqlite3';

// Shared context passed to every repository module.
export interface Ctx {
  db: Database.Database;
  key: Buffer;
}

export interface AccountRow {
  id: number;
  email: string;
  client_id: string;
  refresh_token: string;
  password: string;
  group_id: number;
  remark: string;
  status: string;
  last_refreshed_at: string;
  refresh_fail_count: number;
  last_refresh_error: string;
  created_at: string;
  updated_at: string;
}

export interface AccountWithGroup extends AccountRow {
  group_name: string;
  group_color: string;
}

export interface GroupRow {
  id: number;
  name: string;
  description: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface TagRow {
  id: number;
  name: string;
  color: string;
  created_at: string;
}
