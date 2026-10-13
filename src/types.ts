import type { Config } from './config.js';
import type { Repo } from './db/repo/index.js';

export interface AppBindings {
  config: Config;
  repo: Repo;
}

// Hono environment: every handler reads config + repo from c.env.
export type AppEnv = { Bindings: AppBindings };
