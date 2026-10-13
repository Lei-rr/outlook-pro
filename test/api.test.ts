import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { cookieOf, makeRepo } from './helpers.js';

function setup() {
  const { repo } = makeRepo();
  const config = loadConfig({
    DATA_DIR: mkdtempSync(join(tmpdir(), 'om-api-')),
    ADMIN_PASSWORD: 'admin',
    COOKIE_SECRET: 'cookie-secret',
    ENCRYPTION_KEY: 'a'.repeat(64),
  });
  return { app: createApp(), env: { config, repo } };
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function login(app: ReturnType<typeof createApp>, env: { config: ReturnType<typeof loadConfig> }) {
  const res = await app.request('/api/auth/login', json({ password: 'admin' }), env as never);
  return cookieOf(res);
}

describe('auth flow', () => {
  it('rejects protected route without session', async () => {
    const { app, env } = setup();
    const res = await app.request('/api/accounts', {}, env as never);
    expect(res.status).toBe(401);
  });

  it('rejects wrong password', async () => {
    const { app, env } = setup();
    const res = await app.request('/api/auth/login', json({ password: 'nope' }), env as never);
    expect(res.status).toBe(400);
  });

  it('logs in and accesses protected route', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    expect(cookie.startsWith('session=')).toBe(true);
    const res = await app.request('/api/accounts', { headers: { Cookie: cookie } }, env as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });
});

describe('accounts api', () => {
  it('creates, lists and exports an account', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    const auth = { Cookie: cookie };

    const created = await app.request(
      '/api/accounts',
      { ...json({ email: 'user@outlook.com', client_id: 'cid', refresh_token: 'rt', password: 'pw' }), headers: { 'Content-Type': 'application/json', Cookie: cookie } },
      env as never
    );
    expect(created.status).toBe(200);

    const list = await app.request('/api/accounts', { headers: auth }, env as never);
    const listBody = (await list.json()) as { data: { email: string; refresh_token: string }[] };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]!.email).toBe('user@outlook.com');
    expect(listBody.data[0]!.refresh_token).toBe('****'); // masked in list

    const exported = await app.request('/api/accounts/export', { headers: auth }, env as never);
    const exportBody = (await exported.json()) as { data: { content: string; count: number } };
    expect(exportBody.data.count).toBe(1);
    expect(exportBody.data.content).toBe('user@outlook.com----pw----cid----rt');
  });

  it('batch import parses multiple lines', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    const text = 'a@x.com----p1----cid1----rt1\nb@x.com----p2----cid2----rt2\n';
    const res = await app.request(
      '/api/accounts',
      { ...json({ account_string: text }), headers: { 'Content-Type': 'application/json', Cookie: cookie } },
      env as never
    );
    const body = (await res.json()) as { data: { added: number } };
    expect(body.data.added).toBe(2);
  });
});

describe('groups & tags', () => {
  it('creates a group and a tag', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    const auth = { 'Content-Type': 'application/json', Cookie: cookie };

    const g = await app.request('/api/groups', { ...json({ name: '测试组' }), headers: auth }, env as never);
    expect(g.status).toBe(200);

    const t = await app.request('/api/tags', { ...json({ name: 'vip' }), headers: auth }, env as never);
    expect(t.status).toBe(200);

    const groups = (await (await app.request('/api/groups', { headers: { Cookie: cookie } }, env as never)).json()) as {
      data: { name: string }[];
    };
    expect(groups.data.map((x) => x.name)).toContain('测试组');
  });
});

describe('external api', () => {
  it('is disabled until a key is generated', async () => {
    const { app, env } = setup();
    const res = await app.request('/api/external/emails?email=a@b.c', {}, env as never);
    expect(res.status).toBe(403);
  });
});
