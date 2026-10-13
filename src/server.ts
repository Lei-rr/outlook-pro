import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { createRepo } from './db/repo/index.js';
import { startScheduler } from './jobs/scheduler.js';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const db = openDb(config.dataDir);
  const repo = createRepo(db, config.encryptionKey);
  const app = createApp();
  const env = { config, repo };

  const server = serve({ fetch: (req) => app.fetch(req, env), port: config.port }, (info) => {
    console.log(`服务已启动 http://localhost:${info.port}`);
  });

  const stopScheduler = startScheduler(repo, config);

  const shutdown = (): void => {
    stopScheduler();
    server.close(() => {
      // Let SQLite refresh its statistics before the connection goes away, so the
      // query planner keeps choosing the right indexes. Best effort only.
      try {
        db.pragma('optimize');
      } catch {
        // Never block shutdown on housekeeping.
      }
      db.close();
      process.exit(0);
    });
    // Hard stop if in-flight work refuses to settle.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
