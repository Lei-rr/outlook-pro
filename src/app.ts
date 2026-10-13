import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
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
import type { AppEnv } from './types.js';

// Resolves to <project>/public for both `tsx src/server.ts` and `node dist/server.js`.
const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // gzip/deflate every compressible response. The accounts list is ~2MB of JSON,
  // which shrinks roughly 8x on the wire.
  app.use(compress());

  app.onError((err, c) => {
    console.error('未处理异常:', err instanceof Error ? err.message : String(err), c.req.path);
    return serverError();
  });

  // API responses carry credentials and mailbox contents; keep them out of browser
  // and intermediary caches. Registered before every route so it also covers the
  // public auth / oauth / external endpoints.
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
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

  // Static frontend.
  app.use('/*', serveStatic({ root: publicDir }));

  return app;
}
