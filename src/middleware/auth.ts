import type { MiddlewareHandler } from 'hono';
import { unauthorized } from '../core/http.js';
import { readSession, verifySession } from '../core/session.js';
import type { AppEnv } from '../types.js';

export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = readSession(c.req.header('Cookie'));
    const epoch = c.env.repo.settings.get('session_epoch');
    if (!session || !verifySession(session, c.env.config.cookieSecret, epoch)) {
      return unauthorized();
    }
    await next();
  };
}
