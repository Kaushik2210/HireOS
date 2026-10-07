// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { MemoryMatchStore } from "@/db/matching/memory-store";
import { SupabaseMatchStore } from "@/db/matching/supabase-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { EXPECTED_DEMO_UNIQUE_JOBS } from "@/db/seed/demo-jobs";
import type { Job } from "@/lib/jobs/schemas";
import { buildCandidate } from "@/services/matching/candidate";
import { listVisibleJobs, rankJobs } from "@/services/matching/rank";
import { scoreJob } from "@/services/matching/score";
import { NOW, candidateFrom, makeJob } from "../fixtures/matching";

const HASH = "a".repeat(64);

async function sample() {
  const candidate = await candidateFrom({ skills: [["Python", "advanced"]] });
  return scoreJob(makeJob({ required_skills: ["Python"] }), candidate);
}

describe("MemoryMatchStore", () => {
  it("saves, reads back and replaces a match", async () => {
    const store = new MemoryMatchStore();
    const result = await sample();
    expect(await store.get("u", "j")).toBeNull();
    await store.save("u", "j", result, HASH);
    expect((await store.get("u", "j"))?.result).toEqual(result);
    await store.save("u", "j", { ...result, strength: 12 }, "b".repeat(64));
    const again = await store.get("u", "j");
    expect(again?.result.strength).toBe(12);
    expect(again?.profileHash).toBe("b".repeat(64));
  });

  it("keeps each visitor's matches separate", async () => {
    const store = new MemoryMatchStore();
    await store.save("a", "j", await sample(), HASH);
    expect(await store.get("b", "j")).toBeNull();
  });

  it("returns copies, so callers cannot change what is stored", async () => {
    const store = new MemoryMatchStore();
    await store.save("u", "j", await sample(), HASH);
    const got = await store.get("u", "j");
    got!.result.strength = 0;
    expect((await store.get("u", "j"))?.result.strength).not.toBe(0);
  });
});

function fakeClient(opts: { row?: Record<string, unknown> | null; error?: { code: string } }) {
  const calls: { table: string; upsert?: unknown; options?: unknown; eq: [string, unknown][] }[] =
    [];
  const client = {
    from(table: string) {
      const call: (typeof calls)[number] = { table, eq: [] };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => {
          call.eq.push([c, v]);
          return chain;
        },
        maybeSingle: async () => ({ data: opts.row ?? null, error: opts.error ?? null }),
        upsert: async (row: unknown, options: unknown) => {
          call.upsert = row;
          call.options = options;
          return { error: opts.error ?? null };
        },
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("SupabaseMatchStore", () => {
  it("upserts on user and job with every column", async () => {
    const result = await sample();
    const { client, calls } = fakeClient({});
    await new SupabaseMatchStore(client).save("u1", "j1", result, HASH);
    const call = calls[0]!;
    expect(call.table).toBe("job_matches");
    expect(call.options).toEqual({ onConflict: "user_id,job_id" });
    expect(call.upsert).toMatchObject({
      user_id: "u1",
      job_id: "j1",
      strength: result.strength,
      label: result.label,
      profile_hash: HASH,
      scorer_version: result.scorer_version,
    });
  });

  it("reads a saved row back into a validated result", async () => {
    const result = await sample();
    const row = { ...result, profile_hash: HASH, computed_at: "2026-10-06T00:00:00Z" };
    const { client, calls } = fakeClient({ row });
    const got = await new SupabaseMatchStore(client).get("u1", "j1");
    expect(got?.result).toEqual(result);
    expect(got?.profileHash).toBe(HASH);
    expect(calls[0]!.eq).toEqual([
      ["user_id", "u1"],
      ["job_id", "j1"],
    ]);
  });

  it("treats a row that no longer fits the schema as absent", async () => {
    const result = await sample();
    const { client } = fakeClient({
      row: { ...result, components: [], profile_hash: HASH, computed_at: "x" },
    });
    expect(await new SupabaseMatchStore(client).get("u", "j")).toBeNull();
  });

  it("throws without leaking row contents when the query fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ error: { code: "42501" } });
    await expect(new SupabaseMatchStore(client).get("u", "j")).rejects.toThrow("Match store error");
    await expect(
      new SupabaseMatchStore(client).save("u", "j", await sample(), HASH),
    ).rejects.toThrow();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Python");
    spy.mockRestore();
  });
});

describe("ranking", () => {
  let jobs: Job[];
  beforeAll(async () => {
    jobs = await listVisibleJobs(new MemoryJobStore(), "u");
  });

  it("lists every visible job across pages without repeats", () => {
    expect(jobs).toHaveLength(EXPECTED_DEMO_UNIQUE_JOBS);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(jobs.length);
  });

  it("honours the limit", async () => {
    expect(await listVisibleJobs(new MemoryJobStore(), "u", 25)).toHaveLength(25);
  });

  it("orders best first, deterministically", async () => {
    const candidate = buildCandidate(await new MemoryProfileStore("asha").getSnapshot("u"), NOW);
    const a = rankJobs(jobs, candidate);
    const b = rankJobs([...jobs].reverse(), candidate);
    expect(a.map((r) => r.job.id)).toEqual(b.map((r) => r.job.id));
    for (let i = 1; i < a.length; i++) {
      expect(a[i - 1]!.match.strength).toBeGreaterThanOrEqual(a[i]!.match.strength);
    }
  });
});
