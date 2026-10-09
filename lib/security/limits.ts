import { createHash } from "node:crypto";
import { createRateLimiter, type RateLimitResult } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * A rate limiter that is shared across server instances when the database is configured
 * with a service role key, and falls back to per-instance memory otherwise (demo mode,
 * local development, or if the database cannot be reached).
 *
 * Failing back to memory rather than refusing keeps an outage from locking everyone out,
 * while the local counter still slows abuse on that instance.
 */
export interface SharedLimiter {
  check(key: string): Promise<RateLimitResult>;
  /** Clears the local counters (tests and development). */
  reset(): void;
}

export interface RateLimitClient {
  rpc(
    fn: "rate_limit_hit",
    args: { p_key: string; p_limit: number; p_window_ms: number },
  ): PromiseLike<{
    data: { ok: boolean; retry_after_ms: number }[] | null;
    error: { message: string } | null;
  }>;
}

/** Keys can contain emails and IP addresses, so only a one-way digest leaves the process. */
export function limitKey(name: string, key: string): string {
  return `${name}:${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

export function createSharedLimiter(options: {
  name: string;
  limit: number;
  windowMs: number;
  /** Injected in tests. Defaults to the service-role client when one is configured. */
  client?: () => RateLimitClient | null;
}): SharedLimiter {
  const { name, limit, windowMs } = options;
  const getClient = options.client ?? (() => createSupabaseAdminClient() as RateLimitClient | null);
  const local = createRateLimiter({ limit, windowMs });

  return {
    async check(key) {
      const client = getClient();
      if (!client) return local.check(key);
      try {
        const { data, error } = await client.rpc("rate_limit_hit", {
          p_key: limitKey(name, key),
          p_limit: limit,
          p_window_ms: windowMs,
        });
        const row = data?.[0];
        if (error || !row) throw new Error("rate limit store unavailable");
        return { ok: row.ok, retryAfterMs: row.retry_after_ms };
      } catch {
        console.error("shared rate limit unavailable, using local counters", { name });
        return local.check(key);
      }
    },
    reset() {
      local.reset();
    },
  };
}
