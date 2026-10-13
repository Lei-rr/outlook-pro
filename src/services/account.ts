import type { Repo } from '../db/repo/index.js';
import type { AccountRow } from '../db/repo/types.js';
import { refreshAccessToken } from './graph.js';

export interface RefreshOutcome {
  token?: string;
  error?: string;
  rotated: boolean;
}

// Access-token cache, keyed by account id.
//
// Microsoft hands out an access token that stays valid for ~1 hour, but every
// mailbox read, connection test, external API call and push tick used to trade
// the refresh_token for a brand new one. That is an extra OAuth round trip on
// every single mail operation, a DB write each time, and exactly the kind of
// high-frequency traffic that gets accounts throttled or locked.
//
// Tokens are kept in memory only; a restart just means one extra refresh.
const TOKEN_SKEW_MS = 5 * 60_000;
const CACHE_MAX = 500;
const tokenCache = new Map<number, { token: string; expiresAt: number }>();

// Drop a cached token after the account's credentials change, so the next call
// re-authenticates instead of reusing a token minted for the old refresh_token.
export function invalidateTokenCache(accountId?: number): void {
  if (accountId === undefined) tokenCache.clear();
  else tokenCache.delete(accountId);
}

function cacheToken(accountId: number, token: string, expiresIn?: number): void {
  const lifetimeMs = Math.min(Math.max((expiresIn ?? 3600) * 1000 - TOKEN_SKEW_MS, 60_000), 3_600_000);
  tokenCache.delete(accountId); // re-insert to keep insertion order = LRU order
  tokenCache.set(accountId, { token, expiresAt: Date.now() + lifetimeMs });
  if (tokenCache.size > CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
}

// Single source of truth for "refresh an account's token and persist the result".
// Every caller (email reading, connection test, external API, cron jobs) uses this
// so token rotation and error/status handling stay consistent.
export async function refreshAccountToken(repo: Repo, account: AccountRow): Promise<RefreshOutcome> {
  const cached = tokenCache.get(account.id);
  if (cached && cached.expiresAt > Date.now()) {
    tokenCache.delete(account.id);
    tokenCache.set(account.id, cached); // touch for LRU
    return { token: cached.token, rotated: false };
  }

  const res = await refreshAccessToken(account.client_id, account.refresh_token);

  if (!res.token) {
    tokenCache.delete(account.id);
    const message = res.error?.message ?? 'Token 获取失败';
    repo.accounts.markError(account.id, message);
    return { error: message, rotated: false };
  }

  cacheToken(account.id, res.token, res.expiresIn);
  const rotated = Boolean(res.newRefreshToken && res.newRefreshToken !== account.refresh_token);
  repo.accounts.markRefreshed(account.id, rotated ? res.newRefreshToken : undefined);
  return { token: res.token, rotated };
}
