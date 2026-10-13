import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import { serverError } from './core/http.js';
import { authMiddleware } from './middleware/auth.js';
import accountRoutes from './routes/accounts.js';
import authRoutes from './routes/auth.js';
import emailRoutes from './routes/emails.js';
import externalRoutes from './routes/external.js';
import groupRoutes from './routes/groups.js';
import oauthRoutes from './routes/oauth.js';
import settingRoutes from './routes/settings.js';
import tagRoutes from './routes/tags.js';
import tempEmailRoutes from './routes/tempEmails.js';
import type { AppEnv } from './types.js';

// Resolves to <project>/public for both `tsx src/server.ts` and `node dist/server.js`.
const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    console.error('未处理异常:', err instanceof Error ? err.message : String(err), c.req.path);
    return serverError();
  });

  app.get('/health', (c) => c.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

  // Public routes (their own auth): login, OAuth callback, external API key.
  app.route('/api/auth', authRoutes);
  app.route('/api/oauth', oauthRoutes);
  app.route('/api/external', externalRoutes);

  // Session-gated routes.
  app.use('/api/*', authMiddleware());
  app.route('/api/groups', groupRoutes);
  app.route('/api/tags', tagRoutes);
  app.route('/api/accounts', accountRoutes);
  app.route('/api/accounts/:id/emails', emailRoutes);
  app.route('/api/settings', settingRoutes);
  app.route('/api/temp-emails', tempEmailRoutes);

  // Static frontend.
  app.use('/*', serveStatic({ root: publicDir }));

  return app;
}
