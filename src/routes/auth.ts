import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { hashPassword, randomHex, verifyPassword } from '../core/crypto.js';
import { badRequest, tooManyRequests } from '../core/http.js';
import { isSecureRequest } from '../core/request.js';
import { clearCookie, issueSession, readSession, sessionCookie, verifySession } from '../core/session.js';
import type { AppEnv } from '../types.js';

const auth = new Hono<AppEnv>();

// Failed logins per client IP. In-memory is enough here: a single container owns
// the process, and losing the counters on restart is an acceptable trade.
const FAIL_WINDOW_MS = 5 * 60_000;
const MAX_FAILS = 5;
const MAX_TRACKED_IPS = 5_000;
const failures = new Map<string, number[]>();

// The TCP peer address cannot be spoofed, so prefer it. In-process test requests
// carry no socket, hence the header fallback.
function clientIp(c: Context<AppEnv>): string {
  try {
    const address = getConnInfo(c).remote.address;
    if (address) return address;
  } catch {
    // No underlying socket for this request.
  }
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// Recent failure timestamps for this IP, dropping anything past the window.
function recentFailures(ip: string): number[] {
  const now = Date.now();
  const list = (failures.get(ip) ?? []).filter((at) => now - at < FAIL_WINDOW_MS);
  if (list.length) failures.set(ip, list);
  else failures.delete(ip);
  return list;
}

function recordFailure(ip: string): void {
  // Bound the map so a flood of distinct IPs cannot grow it without limit.
  if (failures.size >= MAX_TRACKED_IPS && !failures.has(ip)) {
    for (const key of failures.keys()) recentFailures(key);
  }
  failures.set(ip, [...recentFailures(ip), Date.now()]);
}

interface SettingsStore {
  get(key: string): string;
  set(key: string, value: string): void;
}

// Created on first use, so an upgraded deployment also drops every cookie that
// the previous build handed out.
function currentEpoch(settings: SettingsStore): string {
  const existing = settings.get('session_epoch');
  if (existing) return existing;
  const created = randomHex(16);
  settings.set('session_epoch', created);
  return created;
}

auth.post('/login', async (c) => {
  const { repo, config } = c.env;
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  const password = body.password?.trim();
  if (!password) return badRequest('请输入密码');

  const ip = clientIp(c);
  if (recentFailures(ip).length >= MAX_FAILS) {
    return tooManyRequests('密码错误次数过多，请 5 分钟后再试');
  }

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
  if (!valid) {
    recordFailure(ip);
    return badRequest('密码错误');
  }
  failures.delete(ip);

  return new Response(JSON.stringify({ success: true, data: {} }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(issueSession(config.cookieSecret, currentEpoch(repo.settings)), isSecureRequest(c)),
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
  const epoch = c.env.repo.settings.get('session_epoch');
  const loggedIn = Boolean(session && verifySession(session, c.env.config.cookieSecret, epoch));
  return Response.json({ success: true, data: { loggedIn } });
});

export default auth;
