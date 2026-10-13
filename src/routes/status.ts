import { Hono } from 'hono';
import { MAX_REFRESH_WINDOW_DAYS } from '../config.js';
import { ok } from '../core/http.js';
import type { AppEnv } from '../types.js';

const status = new Hono<AppEnv>();

// Scheduler and queue state for the dashboard: what ran last, when the next run
// is, and how much work is waiting. Everything here already lives in settings /
// the database - this endpoint just makes it visible.
status.get('/', (c) => {
  const { repo, config } = c.env;
  const s = repo.settings;

  const intervalHours =
    Number.parseInt(s.get('token_refresh_interval_hours') || '', 10) || config.refresh.intervalHours;
  const windowDays = Math.min(
    Number.parseInt(s.get('token_refresh_window_days') || '', 10) || config.refresh.windowDays,
    MAX_REFRESH_WINDOW_DAYS
  );
  const lastRun = Number.parseInt(s.get('token_refresh_last_run') || '0', 10) || 0;
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

  return ok({
    refresh: {
      enabled: s.get('token_refresh_enabled') === '1' || config.refresh.enabled,
      intervalHours,
      windowDays,
      batch: Number.parseInt(s.get('token_refresh_batch') || '', 10) || config.refresh.perRun,
      lastRun,
      lastResult: s.get('token_refresh_last_result'),
      nextRunAt: lastRun ? lastRun + intervalHours * 3_600_000 : 0,
      due: repo.accounts.countDue(cutoff),
    },
    log: repo.refreshLog.totals(),
  });
});

export default status;
