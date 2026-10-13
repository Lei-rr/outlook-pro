import { hmacSign, hmacVerify } from './crypto.js';

const COOKIE = 'session';
const MAX_AGE = 7 * 24 * 60 * 60;

export function issueSession(secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `admin:${exp}`;
  return `${payload}.${hmacSign(payload, secret)}`;
}

export function verifySession(value: string, secret: string): boolean {
  const dot = value.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!hmacVerify(payload, sig, secret)) return false;
  const [role, exp] = payload.split(':');
  if (role !== 'admin') return false;
  const expAt = Number.parseInt(exp ?? '', 10);
  return Number.isFinite(expAt) && Date.now() / 1000 < expAt;
}

export function sessionCookie(value: string, secure: boolean): string {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${MAX_AGE}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSession(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}
