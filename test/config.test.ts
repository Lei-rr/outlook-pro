import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const dirs: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'om-config-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe('config', () => {
  it('runs with zero configuration and defaults the password to admin', () => {
    const c = loadConfig({ DATA_DIR: tmp() });
    expect(c.adminPassword).toBe('admin');
    expect(c.port).toBe(3000);
    expect(c.encryptionKey).toHaveLength(32);
    expect(c.cookieSecret).toHaveLength(64);
  });

  it('persists generated secrets so restarts reuse them', () => {
    const dir = tmp();
    const a = loadConfig({ DATA_DIR: dir });
    const b = loadConfig({ DATA_DIR: dir });
    expect(b.cookieSecret).toBe(a.cookieSecret);
    expect(b.encryptionKey.equals(a.encryptionKey)).toBe(true);
    const saved = JSON.parse(readFileSync(join(dir, 'secret.json'), 'utf8')) as { cookieSecret: string };
    expect(saved.cookieSecret).toBe(a.cookieSecret);
  });

  it('lets env override generated secrets and defaults', () => {
    const c = loadConfig({
      DATA_DIR: tmp(),
      COOKIE_SECRET: 'my-cookie',
      ENCRYPTION_KEY: 'a'.repeat(64),
      PORT: '5000',
      ADMIN_PASSWORD: 'root',
      TOKEN_REFRESH_WINDOW_DAYS: '30',
    });
    expect(c.cookieSecret).toBe('my-cookie');
    expect(c.encryptionKey.toString('hex')).toBe('a'.repeat(64));
    expect(c.port).toBe(5000);
    expect(c.adminPassword).toBe('root');
    expect(c.refresh.windowDays).toBe(30);
  });

  it('derives a 32-byte key from a passphrase', () => {
    const c = loadConfig({ DATA_DIR: tmp(), ENCRYPTION_KEY: 'short-pass' });
    expect(c.encryptionKey).toHaveLength(32);
  });
});
