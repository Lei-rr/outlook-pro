import { describe, expect, it, vi } from 'vitest';
import {
  decryptField,
  encryptField,
  hashPassword,
  hmacSign,
  hmacVerify,
  verifyPassword,
} from '../src/core/crypto.js';
import { issueSession, verifySession } from '../src/core/session.js';
import { intParam, isValidEmail, maskToken } from '../src/core/validate.js';
import { makeRepo } from './helpers.js';

describe('crypto', () => {
  it('hashPassword + verifyPassword roundtrip', () => {
    const h = hashPassword('secret123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('secret123', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });

  it('encryptField / decryptField roundtrip', () => {
    const key = Buffer.alloc(32, 1);
    const enc = encryptField('refresh-token-value', key);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptField(enc, key)).toBe('refresh-token-value');
    expect(encryptField('', key)).toBe('');
  });

  it('decryptField passes through legacy plaintext', () => {
    expect(decryptField('plain-token', Buffer.alloc(32, 1))).toBe('plain-token');
  });

  it('hmac sign/verify', () => {
    const sig = hmacSign('payload', 'secret');
    expect(hmacVerify('payload', sig, 'secret')).toBe(true);
    expect(hmacVerify('payload', sig, 'other')).toBe(false);
  });
});

describe('session', () => {
  it('roundtrip', () => {
    const c = issueSession('sec', 'epoch1');
    expect(verifySession(c, 'sec', 'epoch1')).toBe(true);
    expect(verifySession(c, 'nope', 'epoch1')).toBe(false);
    expect(verifySession('garbage', 'sec', 'epoch1')).toBe(false);
  });

  it('rejects a cookie issued under an older epoch', () => {
    const c = issueSession('sec', 'epoch1');
    expect(verifySession(c, 'sec', 'epoch2')).toBe(false);
  });
});

describe('validate', () => {
  it('email', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('bad')).toBe(false);
  });

  it('mask', () => {
    expect(maskToken('abcdefghijklmnop')).toBe('abcd****mnop');
    expect(maskToken('short')).toBe('****');
  });

  it('intParam clamps to range', () => {
    expect(intParam('-5', 10, 0, 100)).toBe(0);
    expect(intParam('999', 10, 0, 100)).toBe(100);
    expect(intParam(undefined, 10, 0, 100)).toBe(10);
  });
});

describe('repo', () => {
  it('stores account secrets encrypted, returns plaintext', () => {
    const { db, repo } = makeRepo();
    const id = repo.accounts.create({ email: 'a@b.c', client_id: 'cid', refresh_token: 'rt', password: 'pw' });
    const raw = db.prepare('SELECT refresh_token FROM accounts WHERE id = ?').get(id) as { refresh_token: string };
    expect(raw.refresh_token.startsWith('v1:')).toBe(true);
    const acc = repo.accounts.get(id)!;
    expect(acc.refresh_token).toBe('rt');
    expect(acc.client_id).toBe('cid');
  });

  it('bulk insert skips duplicates', () => {
    const { repo } = makeRepo();
    const rows = [
      { email: 'x@y.z', client_id: 'c', refresh_token: 'r' },
      { email: 'x@y.z', client_id: 'c', refresh_token: 'r' },
    ];
    expect(repo.accounts.createBulk(rows, 1)).toBe(1);
  });

  it('dueForRefresh skips freshly refreshed accounts', () => {
    const { repo } = makeRepo();
    const id = repo.accounts.create({ email: 'a@b.c', client_id: 'c', refresh_token: 'r' });
    const cutoff = new Date(Date.now() - 60 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    expect(repo.accounts.dueForRefresh(cutoff, 10)).toHaveLength(1);
    repo.accounts.markRefreshed(id, 'rt2');
    expect(repo.accounts.dueForRefresh(cutoff, 10)).toHaveLength(0);
  });

  it('deleting an account cascades push_state', () => {
    const { db, repo } = makeRepo();
    const id = repo.accounts.create({ email: 'a@b.c', client_id: 'c', refresh_token: 'r' });
    repo.pushState.markChecked(id, '2020-01-01');
    repo.accounts.remove(id);
    expect((db.prepare('SELECT COUNT(*) AS c FROM push_state').get() as { c: number }).c).toBe(0);
  });

  it('settings encrypt secret keys', () => {
    const { db, repo } = makeRepo();
    repo.settings.set('telegram_bot_token', 'bot-secret');
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'telegram_bot_token'").get() as { value: string };
    expect(raw.value.startsWith('v1:')).toBe(true);
    expect(repo.settings.get('telegram_bot_token')).toBe('bot-secret');
  });
});

describe('access token cache', () => {
  it('reuses a live token instead of re-authenticating on every call', async () => {
    vi.resetModules();
    const refreshAccessToken = vi.fn(async () => ({
      token: 'access-1',
      newRefreshToken: 'rt2',
      expiresIn: 3600,
    }));
    vi.doMock('../src/services/graph.js', () => ({ refreshAccessToken }));

    const { refreshAccountToken, invalidateTokenCache } = await import('../src/services/account.js');
    const { repo } = makeRepo();
    const id = repo.accounts.create({ email: 'cache@b.c', client_id: 'c', refresh_token: 'r' });

    await refreshAccountToken(repo, repo.accounts.get(id)!);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    // Inside the TTL the token is served from cache: no extra OAuth round trip,
    // no redundant DB write.
    const again = await refreshAccountToken(repo, repo.accounts.get(id)!);
    expect(again.token).toBe('access-1');
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    // New credentials must force a fresh token.
    invalidateTokenCache(id);
    await refreshAccountToken(repo, repo.accounts.get(id)!);
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);

    vi.doUnmock('../src/services/graph.js');
    vi.resetModules();
  });
});
