import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  publicBaseUrl: string;
  adminPassword: string;
  cookieSecret: string;
  encryptionKey: Buffer;
  refresh: {
    enabled: boolean;
    intervalHours: number;
    windowDays: number;
    perRun: number;
    concurrency: number;
    ratePerSec: number;
  };
  pushIntervalMinutes: number;
  gptmailApiKey: string;
}

// Accept a 64-char hex key directly, otherwise derive 32 bytes from any passphrase.
function deriveKey(raw: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return createHash('sha256').update(raw).digest();
}

// cookieSecret + encryptionKey are generated on first run and stored in
// <dataDir>/secret.json, so a fresh deployment needs no configuration at all.
// Environment variables still override them when provided.
function resolveSecrets(dataDir: string, env: NodeJS.ProcessEnv) {
  const file = path.join(dataDir, 'secret.json');
  let stored: { cookieSecret?: string; encryptionKey?: string } = {};
  if (existsSync(file)) {
    try {
      stored = JSON.parse(readFileSync(file, 'utf8')) as typeof stored;
    } catch {
      // Corrupt file: regenerate below.
    }
  }

  const cookieSecret = env.COOKIE_SECRET || stored.cookieSecret || randomBytes(32).toString('hex');
  const encryptionKey = env.ENCRYPTION_KEY || stored.encryptionKey || randomBytes(32).toString('hex');

  if (!stored.cookieSecret || !stored.encryptionKey) {
    writeFileSync(file, JSON.stringify({ cookieSecret, encryptionKey }, null, 2), { mode: 0o600 });
  }
  return { cookieSecret, encryptionKey };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR || './data');
  mkdirSync(dataDir, { recursive: true });

  const { cookieSecret, encryptionKey } = resolveSecrets(dataDir, env);

  const num = (raw: string | undefined, fallback: number, min = 0): number => {
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  const bool = (raw: string | undefined, fallback: boolean): boolean =>
    raw === undefined || raw === '' ? fallback : raw === '1' || raw.toLowerCase() === 'true';

  return {
    port: num(env.PORT, 3000, 1),
    dataDir,
    publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    // Only used to seed the first login; afterwards the password lives in the DB.
    adminPassword: env.ADMIN_PASSWORD || 'admin',
    cookieSecret,
    encryptionKey: deriveKey(encryptionKey),
    refresh: {
      enabled: bool(env.TOKEN_REFRESH_ENABLED, false),
      intervalHours: num(env.TOKEN_REFRESH_INTERVAL_HOURS, 6, 1),
      windowDays: num(env.TOKEN_REFRESH_WINDOW_DAYS, 60, 1),
      perRun: num(env.TOKEN_REFRESH_PER_RUN, 200, 1),
      concurrency: num(env.TOKEN_REFRESH_CONCURRENCY, 10, 1),
      ratePerSec: num(env.TOKEN_REFRESH_RATE_PER_SEC, 10, 1),
    },
    pushIntervalMinutes: num(env.PUSH_INTERVAL_MINUTES, 1, 1),
    gptmailApiKey: env.GPTMAIL_API_KEY || '',
  };
}
