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
    const body = (await res.json()) as { success: boolean; data: { items: unknown[]; total: number } };
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it('throttles repeated failed logins from one IP', async () => {
    const { app, env } = setup();
    const attempt = (password: string) =>
      app.request(
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
          body: JSON.stringify({ password }),
        },
        env as never
      );

    for (let i = 0; i < 5; i++) {
      expect((await attempt('wrong')).status).toBe(400);
    }
    expect((await attempt('wrong')).status).toBe(429);
    // The correct password is refused too while the IP is locked out.
    expect((await attempt('admin')).status).toBe(429);
  });

  it('keeps the session epoch out of the settings payload', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    const res = await app.request('/api/settings', { headers: { Cookie: cookie } }, env as never);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.login_password).toBe('******');
    expect(body.data.session_epoch).toBeUndefined();
  });

  it('invalidates issued cookies when the password changes', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    const before = await app.request('/api/accounts', { headers: { Cookie: cookie } }, env as never);
    expect(before.status).toBe(200);

    const changed = await app.request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ login_password: 'newpass' }),
      },
      env as never
    );
    expect(changed.status).toBe(200);

    const after = await app.request('/api/accounts', { headers: { Cookie: cookie } }, env as never);
    expect(after.status).toBe(401);
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
    const accountId = ((await created.json()) as { data: { id: number } }).data.id;

    const list = await app.request('/api/accounts', { headers: auth }, env as never);
    const listBody = (await list.json()) as {
      data: { items: { email: string; refresh_token?: string }[]; total: number };
    };
    expect(listBody.data.total).toBe(1);
    expect(listBody.data.items).toHaveLength(1);
    expect(listBody.data.items[0]!.email).toBe('user@outlook.com');
    // Secrets are omitted from the list (the edit modal reads /accounts/:id), so
    // the endpoint never has to decrypt every row.
    expect(listBody.data.items[0]!.refresh_token).toBeUndefined();

    const stats = await app.request('/api/accounts/stats', { headers: auth }, env as never);
    const statsBody = (await stats.json()) as { data: { total: number; status: Record<string, number> } };
    expect(statsBody.data.total).toBe(1);
    expect(statsBody.data.status.active).toBe(1);

    // A failed refresh stores the reason, and the list surfaces it for the UI.
    env.repo.accounts.markError(accountId, 'token 已过期');
    const errList = (await (
      await app.request('/api/accounts', { headers: auth }, env as never)
    ).json()) as { data: { items: { status: string; last_refresh_error: string }[] } };
    expect(errList.data.items[0]!.status).toBe('error');
    expect(errList.data.items[0]!.last_refresh_error).toBe('token 已过期');

    // Detail payload must not carry the plaintext password; the token stays masked.
    const detail = await app.request(`/api/accounts/${accountId}`, { headers: auth }, env as never);
    const detailBody = (await detail.json()) as { data: Record<string, unknown> };
    expect(detailBody.data.password).toBeUndefined();
    expect(detailBody.data.refresh_token).toBe('****');

    // ...it is only served by its own on-demand endpoint.
    const pwd = await app.request(`/api/accounts/${accountId}/password`, { headers: auth }, env as never);
    const pwdBody = (await pwd.json()) as { data: { password: string } };
    expect(pwdBody.data.password).toBe('pw');

    const noStore = await app.request('/api/accounts/stats', { headers: auth }, env as never);
    expect(noStore.headers.get('cache-control')).toBe('no-store');

    // The public endpoints must be covered too, not just the session-gated ones.
    const publicNoStore = await app.request('/api/auth/me', {}, env as never);
    expect(publicNoStore.headers.get('cache-control')).toBe('no-store');

    // The export streams plain text behind a download header instead of building
    // one giant JSON string for thousands of accounts.
    const exported = await app.request('/api/accounts/export', { headers: auth }, env as never);
    expect(exported.headers.get('content-type')).toContain('text/plain');
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    expect(await exported.text()).toBe('user@outlook.com----pw----cid----rt\n');
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

  it('paginates and filters the account list', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    const auth = { 'Content-Type': 'application/json', Cookie: cookie };

    for (let i = 0; i < 5; i++) {
      await app.request(
        '/api/accounts',
        { ...json({ email: `p${i}@x.com`, client_id: 'c', refresh_token: 'r' }), headers: auth },
        env as never
      );
    }
    env.repo.accounts.update(1, { status: 'disabled' });

    const page1 = (await (
      await app.request('/api/accounts?page=1&page_size=2', { headers: { Cookie: cookie } }, env as never)
    ).json()) as { data: { items: { email: string }[]; total: number; page: number; page_size: number } };
    expect(page1.data.total).toBe(5);
    expect(page1.data.page).toBe(1);
    expect(page1.data.page_size).toBe(2);
    expect(page1.data.items).toHaveLength(2);

    const page3 = (await (
      await app.request('/api/accounts?page=3&page_size=2', { headers: { Cookie: cookie } }, env as never)
    ).json()) as { data: { items: unknown[] } };
    expect(page3.data.items).toHaveLength(1);

    const filtered = (await (
      await app.request('/api/accounts?status=disabled', { headers: { Cookie: cookie } }, env as never)
    ).json()) as { data: { items: { id: number }[]; total: number } };
    expect(filtered.data.total).toBe(1);
    expect(filtered.data.items[0]!.id).toBe(1);
  });

  it('re-import can overwrite an existing account', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    const auth = { 'Content-Type': 'application/json', Cookie: cookie };

    await app.request(
      '/api/accounts',
      { ...json({ account_string: 'a@x.com----p1----cid1----rt1' }), headers: auth },
      env as never
    );

    // Same email, rotated credentials: without the flag the row is skipped.
    const skipped = await app.request(
      '/api/accounts',
      { ...json({ account_string: 'a@x.com----p2----cid2----rt2' }), headers: auth },
      env as never
    );
    expect(skipped.status).toBe(400);
    expect(env.repo.accounts.get(1)!.refresh_token).toBe('rt1');

    const overwritten = await app.request(
      '/api/accounts',
      { ...json({ account_string: 'a@x.com----p2----cid2----rt2', overwrite: true }), headers: auth },
      env as never
    );
    expect(overwritten.status).toBe(200);
    const acc = env.repo.accounts.get(1)!;
    expect(acc.refresh_token).toBe('rt2');
    expect(acc.password).toBe('p2');
  });

  it('backs a failed account off instead of retrying it every run', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    await app.request(
      '/api/accounts',
      {
        ...json({ account_string: 'f@x.com----p----c----r' }),
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
      },
      env as never
    );

    const { repo } = env;
    // A far-future cutoff makes every account eligible, so this isolates the
    // queue's other conditions.
    expect(repo.accounts.dueForRefresh('9999-12-31 00:00:00', 10)).toHaveLength(1);

    repo.accounts.markError(1, 'invalid_grant');
    const row = repo.accounts.get(1)!;
    expect(row.status).toBe('error');
    expect(row.refresh_fail_count).toBe(1);
    // last_refreshed_at is the queue's sort key and has to advance on failure too.
    expect(row.last_refreshed_at).not.toBe('');
    // The backoff window keeps the account out of the very next run.
    expect(row.next_refresh_at).not.toBe('');
    expect(repo.accounts.dueForRefresh('9999-12-31 00:00:00', 10)).toHaveLength(0);

    // A later success clears the backoff.
    repo.accounts.markRefreshed(1);
    expect(repo.accounts.get(1)!.next_refresh_at).toBe('');
    expect(repo.accounts.dueForRefresh('9999-12-31 00:00:00', 10)).toHaveLength(1);
  });

  it('serves a lightweight option list for pickers', async () => {
    const { app, env } = setup();
    const cookie = await login(app, env);
    await app.request(
      '/api/accounts',
      {
        ...json({ email: 'pick@x.com', client_id: 'c', refresh_token: 'r' }),
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
      },
      env as never
    );

    const res = await app.request('/api/accounts/options', { headers: { Cookie: cookie } }, env as never);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.email).toBe('pick@x.com');
    // The picker never needs the heavy columns.
    expect(body.data[0]!.remark).toBeUndefined();
    expect(body.data[0]!.created_at).toBeUndefined();
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
