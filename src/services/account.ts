import type { Repo } from '../db/repo/index.js';
import type { AccountRow } from '../db/repo/types.js';
import { refreshAccessToken } from './graph.js';

export interface RefreshOutcome {
  token?: string;
  error?: string;
  rotated: boolean;
}

// Single source of truth for "refresh an account's token and persist the result".
// Every caller (email reading, connection test, external API, cron jobs) uses this
// so token rotation and error/status handling stay consistent.
export async function refreshAccountToken(repo: Repo, account: AccountRow): Promise<RefreshOutcome> {
  const res = await refreshAccessToken(account.client_id, account.refresh_token);

  if (!res.token) {
    const message = res.error?.message ?? 'Token 获取失败';
    repo.accounts.markError(account.id, message);
    return { error: message, rotated: false };
  }

  const rotated = Boolean(res.newRefreshToken && res.newRefreshToken !== account.refresh_token);
  repo.accounts.markRefreshed(account.id, rotated ? res.newRefreshToken : undefined);
  return { token: res.token, rotated };
}
