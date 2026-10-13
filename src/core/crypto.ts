import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_LEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (!salt.length || !expected.length) return false;
  const actual = scryptSync(password, salt, expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

// AES-256-GCM field encryption. Legacy plaintext (no "v1:" prefix) passes through
// so databases written before encryption was enabled stay readable.
export function encryptField(plain: string, key: Buffer): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptField(payload: string, key: Buffer): string {
  if (!payload || !payload.startsWith('v1:')) return payload;
  const [, iv, tag, data] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export function hmacSign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function hmacVerify(payload: string, signature: string, secret: string): boolean {
  const a = Buffer.from(hmacSign(payload, secret));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function randomHex(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}
