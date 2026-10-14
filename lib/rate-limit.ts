/**
 * Fixed-window in-memory rate limiter.
 *
 * Scope: per server instance. This is the local engine behind the shared limiter in
 * lib/security/limits.ts, which uses the database when it is available and falls back to
 * these counters when it is not (demo mode, local runs, or an unreachable database).
 */
export interface RateLimitResult {
  ok: boolean;
  /** Milliseconds until the window resets (0 when ok). */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  reset(): void;
}

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const { limit, windowMs, now = Date.now, maxKeys = 10_000 } = options;
  const hits = new Map<string, { count: number; resetAt: number }>();

  function sweep(t: number) {
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
  }

  return {
    check(key) {
      const t = now();
      if (hits.size >= maxKeys) {
        sweep(t);
        // Still full of live entries: evict the oldest so memory stays bounded.
        if (hits.size >= maxKeys) {
          const oldest = hits.keys().next();
          if (!oldest.done) hits.delete(oldest.value);
        }
      }
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + windowMs });
        return { ok: true, retryAfterMs: 0 };
      }
      if (entry.count >= limit) return { ok: false, retryAfterMs: entry.resetAt - t };
      entry.count += 1;
      return { ok: true, retryAfterMs: 0 };
    },
    reset() {
      hits.clear();
    },
  };
}
