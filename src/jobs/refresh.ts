import { MAX_REFRESH_WINDOW_DAYS, type Config } from '../config.js';
import { mapLimit, RateLimiter, sleep } from '../core/async.js';
import type { Repo } from '../db/repo/index.js';
import type { RefreshEntry } from '../db/repo/refreshLog.js';
import { refreshAccessToken } from '../services/graph.js';

export interface RefreshSummary {
  ranAt: string;
  scanned: number;
  ok: number;
  failed: number;
  rotated: number;
}

const MAX_RETRIES = 2;

// Retry only on Graph throttling (429); other failures are terminal for this run.
async function refreshOne(clientId: string, token: string, limiter: RateLimiter) {
  for (let attempt = 0; ; attempt++) {
    await limiter.acquire();
    const res = await refreshAccessToken(clientId, token);
    if (res.token || res.error?.code !== 'RATE_LIMITED' || attempt >= MAX_RETRIES) return res;
    await sleep(1000 * 2 ** attempt);
  }
}

export async function runTokenRefresh(
  repo: Repo,
  config: Config,
  opts: { force?: boolean } = {}
): Promise<RefreshSummary | null> {
  const { settings, accounts } = repo;

  const enabled = opts.force || settings.get('token_refresh_enabled') === '1' || config.refresh.enabled;
  if (!enabled) return null;

  if (!opts.force) {
    const intervalHours =
      Number.parseInt(settings.get('token_refresh_interval_hours') || '', 10) || config.refresh.intervalHours;
    const lastRun = Number.parseInt(settings.get('token_refresh_last_run') || '0', 10);
    if (lastRun && Date.now() - lastRun < intervalHours * 3600_000) return null;
  }

  const windowDays = Math.min(
    Number.parseInt(settings.get('token_refresh_window_days') || '', 10) || config.refresh.windowDays,
    MAX_REFRESH_WINDOW_DAYS
  );
  const perRun = Number.parseInt(settings.get('token_refresh_batch') || '', 10) || config.refresh.perRun;
  const concurrency =
    Number.parseInt(settings.get('token_refresh_concurrency') || '', 10) || config.refresh.concurrency;
  const rate =
    Number.parseInt(settings.get('token_refresh_rate_per_sec') || '', 10) || config.refresh.ratePerSec;

  // Only accounts idle longer than the window are due. The window is capped at
  // MAX_REFRESH_WINDOW_DAYS so a token is always rotated while still valid:
  // Microsoft refresh tokens slide-expire around 90 days, so a 30-day window
  // keeps a 3x safety margin and never rotates a token that is already dead.
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  const due = accounts.dueForRefresh(cutoff, perRun);

  let ok = 0;
  let failed = 0;
  let rotated = 0;
  const limiter = new RateLimiter(rate);
  const attempts: RefreshEntry[] = [];

  await mapLimit(due, concurrency, async (acc) => {
    const res = await refreshOne(acc.client_id, acc.refresh_token, limiter);
    if (res.token) {
      ok++;
      const isRotated = Boolean(res.newRefreshToken && res.newRefreshToken !== acc.refresh_token);
      if (isRotated) rotated++;
      accounts.markRefreshed(acc.id, isRotated ? res.newRefreshToken : undefined);
      attempts.push({ accountId: acc.id, ok: true });
    } else {
      failed++;
      const message = res.error?.message ?? 'Token 获取失败';
      accounts.markError(acc.id, message);
      attempts.push({ accountId: acc.id, ok: false, message });
    }
  });

  // Attempt history for diagnostics, batched into one transaction and bounded to
  // a 30-day window so the table cannot grow without limit.
  repo.refreshLog.addMany(attempts);
  repo.refreshLog.prune(30);

  const summary: RefreshSummary = {
    ranAt: new Date().toISOString(),
    scanned: due.length,
    ok,
    failed,
    rotated,
  };
  settings.set('token_refresh_last_run', String(Date.now()));
  settings.set(
    'token_refresh_last_result',
    `${summary.ranAt} 刷新 ${summary.scanned} 个：成功 ${ok}，失败 ${failed}，轮换 ${rotated}`
  );
  return summary;
}
