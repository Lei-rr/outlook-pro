import type { Config } from '../config.js';
import type { Repo } from '../db/repo/index.js';
import { runEmailPush } from './push.js';
import { runTokenRefresh } from './refresh.js';

const TICK_MS = 60_000;

// Background tick. Jobs run sequentially so the refresh and push jobs never
// touch the same account's refresh_token at the same time. Each job self-gates
// on its own settings, so a tick is cheap when nothing is due.
export function startScheduler(repo: Repo, config: Config): () => void {
  let stopped = false;
  let busy = false;

  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      await runTokenRefresh(repo, config).catch((e) => console.error('刷新任务异常:', e));
      await runEmailPush(repo, config).catch((e) => console.error('推送任务异常:', e));
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(tick, TICK_MS);
  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
