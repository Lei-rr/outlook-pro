import type { Context } from 'hono';
import type { AppEnv } from '../types.js';

// True when the request reached us over HTTPS, accounting for a reverse proxy.
export function isSecureRequest(c: Context<AppEnv>): boolean {
  if (c.env.config.publicBaseUrl.startsWith('https://')) return true;
  const proto = c.req.header('x-forwarded-proto');
  if (proto) return proto.split(',')[0]!.trim() === 'https';
  return new URL(c.req.url).protocol === 'https:';
}

// Public origin of this deployment, honoring PUBLIC_BASE_URL and proxy headers.
export function baseUrl(c: Context<AppEnv>): string {
  const configured = c.env.config.publicBaseUrl;
  if (configured) return configured;

  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]!.trim() || url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || url.host;
  return `${proto}://${host}`;
}
