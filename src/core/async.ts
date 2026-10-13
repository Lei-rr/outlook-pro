// Run `fn` over items with at most `limit` concurrent executions.
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Token bucket limiter shared across concurrent workers.
export class RateLimiter {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly ratePerSec: number,
    private readonly burst = Math.max(1, Math.ceil(ratePerSec))
  ) {
    this.tokens = this.burst;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000);
      await new Promise((r) => setTimeout(r, Math.max(1, waitMs)));
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hand the event loop back between chunks of a long synchronous job, so queued
// requests get served instead of waiting for the whole job to finish.
export const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));
