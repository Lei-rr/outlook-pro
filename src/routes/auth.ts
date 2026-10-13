import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../core/crypto.js';
import { badRequest } from '../core/http.js';
import { isSecureRequest } from '../core/request.js';
import { clearCookie, issueSession, readSession, sessionCookie, verifySession } from '../core/session.js';
import type { AppEnv } from '../types.js';

const auth = new Hono<AppEnv>();

auth.post('/login', async (c) => {
  const { repo, config } = c.env;
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  const password = body.password?.trim();
  if (!password) return badRequest('请输入密码');

  const stored = repo.settings.get('login_password_hash');
  let valid = false;
  // Only scrypt-format hashes are verified; anything else (e.g. a legacy
  // SHA-256 hash imported from an older database) falls back to ADMIN_PASSWORD.
  if (stored?.startsWith('scrypt$')) {
    valid = verifyPassword(password, stored);
  } else if (password === config.adminPassword) {
    repo.settings.set('login_password_hash', hashPassword(password));
    valid = true;
  }
  if (!valid) return badRequest('密码错误');

  return new Response(JSON.stringify({ success: true, data: {} }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(issueSession(config.cookieSecret), isSecureRequest(c)),
    },
  });
});

auth.post('/logout', () => {
  return new Response(JSON.stringify({ success: true, data: {} }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie() },
  });
});

auth.get('/me', (c) => {
  const session = readSession(c.req.header('Cookie'));
  const loggedIn = Boolean(session && verifySession(session, c.env.config.cookieSecret));
  return Response.json({ success: true, data: { loggedIn } });
});

export default auth;
