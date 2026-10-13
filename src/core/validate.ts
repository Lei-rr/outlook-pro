const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (value: string): boolean => EMAIL_RE.test(value);

export function maskToken(token: string, visible = 4): string {
  if (!token || token.length <= visible * 2) return '****';
  return `${token.slice(0, visible)}****${token.slice(-visible)}`;
}

// Clamp an integer query param into [min, max], falling back when unparseable.
export function intParam(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
