import type { MiddlewareHandler } from 'hono';
import { unauthorized } from '../core/http.js';
import { readSession, verifySession } from '../core/session.js';
import type { AppEnv } from '../types.js';

export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = readSession(c.req.header('Cookie'));
    if (!session || !verifySession(session, c.env.config.cookieSecret)) {
      return unauthorized();
    }
    await next();
  };
}
