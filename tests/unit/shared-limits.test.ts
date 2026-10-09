// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSharedLimiter, limitKey, type RateLimitClient } from "@/lib/security/limits";

const rpc = vi.fn();
const client: RateLimitClient = { rpc };

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("limitKey", () => {
  it("never carries the raw value, only a stable digest under the limiter's name", () => {
    const key = limitKey("signInByEmail", "Someone@Example.com");
    expect(key).toMatch(/^signInByEmail:[0-9a-f]{40}$/);
    expect(key).not.toContain("example");
    expect(limitKey("signInByEmail", "Someone@Example.com")).toBe(key);
    expect(limitKey("other", "Someone@Example.com")).not.toBe(key);
  });
});

describe("createSharedLimiter", () => {
  const make = (c: RateLimitClient | null = client) =>
    createSharedLimiter({ name: "t", limit: 2, windowMs: 1000, client: () => c });

  it("asks the shared store and returns its answer", async () => {
    rpc.mockResolvedValueOnce({ data: [{ ok: false, retry_after_ms: 750 }], error: null });
    const result = await make().check("1.2.3.4");
    expect(result).toEqual({ ok: false, retryAfterMs: 750 });
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_key: limitKey("t", "1.2.3.4"),
      p_limit: 2,
      p_window_ms: 1000,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("1.2.3.4");
  });

  it("falls back to local counters when the store errors, throws or answers nothing", async () => {
    for (const failure of [
      () => Promise.resolve({ data: null, error: { message: "down" } }),
      () => Promise.reject(new Error("network")),
      () => Promise.resolve({ data: [], error: null }),
    ]) {
      rpc.mockImplementation(failure);
      const limiter = make();
      expect((await limiter.check("k")).ok).toBe(true);
      expect((await limiter.check("k")).ok).toBe(true);
      // The local limit still holds during the outage.
      expect((await limiter.check("k")).ok).toBe(false);
    }
  });

  it("uses local counters when no database is configured", async () => {
    const limiter = make(null);
    expect((await limiter.check("k")).ok).toBe(true);
    expect((await limiter.check("k")).ok).toBe(true);
    expect((await limiter.check("k")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    limiter.reset();
    expect((await limiter.check("k")).ok).toBe(true);
  });
});
