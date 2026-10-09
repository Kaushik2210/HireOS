// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createUser, errorOf } from "./helpers";

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

const hit = (key: string, limit = 3, windowMs = 60_000) =>
  as(db, "service_role", null, async () => {
    const { rows } = await db.query<{ ok: boolean; retry_after_ms: number }>(
      "select * from public.rate_limit_hit($1, $2, $3)",
      [key, limit, windowMs],
    );
    return rows[0]!;
  });

describe("public.rate_limit_hit", () => {
  it("allows up to the limit, then refuses with a wait time", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await hit("k-basic"));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false]);
    expect(results[0]!.retry_after_ms).toBe(0);
    expect(results[3]!.retry_after_ms).toBeGreaterThan(0);
    expect(results[3]!.retry_after_ms).toBeLessThanOrEqual(60_000);
  });

  it("keeps keys apart", async () => {
    for (let i = 0; i < 4; i++) await hit("k-a", 2);
    expect((await hit("k-a", 2)).ok).toBe(false);
    expect((await hit("k-b", 2)).ok).toBe(true);
  });

  it("starts a new window once the old one has ended", async () => {
    for (let i = 0; i < 3; i++) await hit("k-expiry", 2, 60_000);
    expect((await hit("k-expiry", 2, 60_000)).ok).toBe(false);
    await db.query(
      "update public.rate_limits set reset_at = now() - interval '1 second' where key = 'k-expiry'",
    );
    const next = await hit("k-expiry", 2, 60_000);
    expect(next.ok).toBe(true);
    const { rows } = await db.query<{ hits: number }>(
      "select hits from public.rate_limits where key = 'k-expiry'",
    );
    expect(rows[0]!.hits).toBe(1);
  });

  it("stops counting one past the limit, so a flood writes no bigger numbers", async () => {
    for (let i = 0; i < 50; i++) await hit("k-flood", 3);
    const { rows } = await db.query<{ hits: number }>(
      "select hits from public.rate_limits where key = 'k-flood'",
    );
    expect(rows[0]!.hits).toBe(4);
  });

  it("rejects nonsense settings", async () => {
    expect(await errorOf(() => hit("k-bad", 0))).toMatch(/invalid rate limit/);
    expect(await errorOf(() => hit("k-bad", 5, 0))).toMatch(/invalid rate limit/);
    expect(await errorOf(() => hit("k-bad", 5, 86_400_001))).toMatch(/invalid rate limit/);
  });

  it("is callable by the service role only", async () => {
    const userId = await createUser(db);
    for (const role of ["anon", "authenticated"] as const) {
      const error = await errorOf(() =>
        as(db, role, role === "anon" ? null : userId, () =>
          db.query("select * from public.rate_limit_hit('k-denied', 5, 1000)"),
        ),
      );
      expect(error, role).toMatch(/permission denied/);
    }
  });

  it("gives API roles no access to the counters themselves", async () => {
    await hit("k-visible");
    const userId = await createUser(db);
    for (const role of ["anon", "authenticated"] as const) {
      const error = await errorOf(() =>
        as(db, role, role === "anon" ? null : userId, () =>
          db.query("select * from public.rate_limits"),
        ),
      );
      expect(error, role).toMatch(/permission denied/);
    }
    const write = await errorOf(() =>
      as(db, "authenticated", userId, () =>
        db.query("update public.rate_limits set hits = 1 where key = 'k-visible'"),
      ),
    );
    expect(write).toMatch(/permission denied/);
  });
});
