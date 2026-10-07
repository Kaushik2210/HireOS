// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { JobStoreError } from "@/db/jobs/store";
import { SupabaseJobStore } from "@/db/jobs/supabase-store";
import { EXPECTED_DEMO_UNIQUE_JOBS } from "@/db/seed/demo-jobs";
import { JOBS_PAGE_SIZE, MAX_PRIVATE_JOBS } from "@/lib/jobs/constants";
import { DEFAULT_JOB_QUERY, type JobQuery } from "@/lib/jobs/schemas";
import { normalizeRawJob, type NormalizedJob } from "@/services/jobs/normalize";
import { MANUAL_SOURCE } from "@/services/jobs/providers/registry";

const q = (patch: Partial<JobQuery> = {}): JobQuery => ({ ...DEFAULT_JOB_QUERY, ...patch });

function manual(title: string, extra: Record<string, unknown> = {}): NormalizedJob {
  const r = normalizeRawJob(
    {
      company_name: "Acme",
      title,
      location: "Pune",
      description: "Requirements\n• 2+ years of experience with Python",
      ...extra,
    },
    MANUAL_SOURCE,
  );
  if (!r.ok) throw new Error(r.reason);
  return r.job;
}

describe("MemoryJobStore", () => {
  it("shows the whole demo catalogue, one page at a time", async () => {
    const store = new MemoryJobStore();
    const first = await store.search("u", q());
    expect(first.total).toBe(EXPECTED_DEMO_UNIQUE_JOBS);
    expect(first.jobs).toHaveLength(JOBS_PAGE_SIZE);
    expect(first.pageCount).toBe(Math.ceil(EXPECTED_DEMO_UNIQUE_JOBS / JOBS_PAGE_SIZE));
    const last = await store.search("u", q({ page: first.pageCount }));
    expect(last.jobs).toHaveLength(
      EXPECTED_DEMO_UNIQUE_JOBS - JOBS_PAGE_SIZE * (first.pageCount - 1),
    );
    const past = await store.search("u", q({ page: first.pageCount + 1 }));
    expect(past.jobs).toEqual([]);
    expect(past.total).toBe(EXPECTED_DEMO_UNIQUE_JOBS);
  });

  it("never repeats or drops a job across pages", async () => {
    const store = new MemoryJobStore();
    const ids: string[] = [];
    for (let page = 1; page <= 3; page++)
      ids.push(...(await store.search("u", q({ page }))).jobs.map((j) => j.id));
    expect(new Set(ids).size).toBe(EXPECTED_DEMO_UNIQUE_JOBS);
  });

  it("returns copies, so callers cannot change the shared catalogue", async () => {
    const store = new MemoryJobStore();
    const [job] = (await store.search("u", q())).jobs;
    job!.title = "Tampered";
    job!.required_skills.length = 0;
    const again = await store.get("u", job!.id);
    expect(again?.title).not.toBe("Tampered");
    expect(again?.required_skills.length).toBeGreaterThan(0);
  });

  it("finds a job by id and reports unknown ids as null", async () => {
    const store = new MemoryJobStore();
    const [job] = (await store.search("u", q())).jobs;
    expect((await store.get("u", job!.id))?.title).toBe(job!.title);
    expect(await store.get("u", crypto.randomUUID())).toBeNull();
  });

  it("lists distinct company names, sorted", async () => {
    const names = await new MemoryJobStore().companies("u");
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it("lets a visitor add a private job, which only they can see", async () => {
    const store = new MemoryJobStore();
    const created = await store.createPrivate("owner", manual("Zebra Wrangler"));
    expect(created).toMatchObject({ source_key: "manual", owner_user_id: "owner", is_demo: false });
    expect((await store.search("owner", q({ q: "zebra" }))).total).toBe(1);
    expect((await store.search("someone-else", q({ q: "zebra" }))).total).toBe(0);
    expect(await store.get("someone-else", created.id)).toBeNull();
    expect((await store.get("owner", created.id))?.title).toBe("Zebra Wrangler");
  });

  it("rejects an exact duplicate for the same visitor, but not for another", async () => {
    const store = new MemoryJobStore();
    await store.createPrivate("a", manual("Same Job"));
    await expect(store.createPrivate("a", manual("Same Job"))).rejects.toMatchObject({
      kind: "duplicate",
    });
    await expect(store.createPrivate("b", manual("Same Job"))).resolves.toBeDefined();
  });

  it("stops at the private job limit", async () => {
    const store = new MemoryJobStore();
    for (let i = 0; i < MAX_PRIVATE_JOBS; i++)
      await store.createPrivate("a", manual(`Job number ${i}`));
    await expect(store.createPrivate("a", manual("One too many"))).rejects.toBeInstanceOf(
      JobStoreError,
    );
    await expect(store.createPrivate("a", manual("One too many"))).rejects.toMatchObject({
      kind: "limit",
    });
    expect(await store.countPrivate("a")).toBe(MAX_PRIVATE_JOBS);
  });

  it("deletes only the owner's private jobs, never catalogue jobs or someone else's", async () => {
    const store = new MemoryJobStore();
    const mine = await store.createPrivate("owner", manual("Mine"));
    const catalogue = (await store.search("owner", q())).jobs.find((j) => j.owner_user_id === null);
    expect(await store.deletePrivate("intruder", mine.id)).toBe(false);
    expect(await store.deletePrivate("owner", catalogue!.id)).toBe(false);
    expect(await store.get("owner", catalogue!.id)).not.toBeNull();
    expect(await store.deletePrivate("owner", mine.id)).toBe(true);
    expect(await store.deletePrivate("owner", mine.id)).toBe(false);
  });

  it("hides and restores demo jobs per visitor, leaving private jobs alone", async () => {
    const store = new MemoryJobStore();
    await store.createPrivate("a", manual("Keep me"));
    expect(await store.demo("a")).toEqual({ available: true, hidden: false });

    await store.setDemoHidden("a", true);
    const hidden = await store.search("a", q());
    expect(hidden.jobs.map((j) => j.title)).toEqual(["Keep me"]);
    expect((await store.search("b", q())).total).toBe(EXPECTED_DEMO_UNIQUE_JOBS); // another visitor unaffected
    expect(await store.demo("a")).toEqual({ available: true, hidden: true });

    await store.setDemoHidden("a", false);
    expect((await store.search("a", q())).total).toBe(EXPECTED_DEMO_UNIQUE_JOBS + 1);
  });

  it("keeps memory bounded across many visitors", async () => {
    const store = new MemoryJobStore();
    await store.createPrivate("first", manual("Early job"));
    for (let i = 0; i < 505; i++) await store.countPrivate(`filler-${i}`);
    expect(await store.countPrivate("first")).toBe(0); // evicted
  });
});

/** Records the query chain and rpc calls, and resolves with canned results. */
function fakeSupabase(
  plan: {
    rpc?: { data?: unknown; error?: { code?: string; message?: string } | null };
    table?: { data?: unknown; error?: { code?: string; message?: string } | null; count?: number };
    users?: { data?: unknown; error?: null };
  } = {},
) {
  const calls: { op: string; args: unknown[] }[] = [];
  const builder = (name: string) => {
    const result =
      name === "users"
        ? { data: plan.users?.data ?? null, error: null }
        : {
            data: plan.table?.data ?? null,
            error: plan.table?.error ?? null,
            count: plan.table?.count ?? 0,
          };
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "insert", "update", "delete", "limit"]) {
      chain[op] = (...args: unknown[]) => {
        calls.push({ op: `${name}.${op}`, args });
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve(result);
    chain.single = () => Promise.resolve(result);
    chain.then = (resolve: (v: unknown) => void) => resolve({ ...result, data: result.data ?? [] });
    return chain;
  };
  const client = {
    from: (name: string) => builder(name),
    rpc: (fn: string, params: unknown) => {
      calls.push({ op: `rpc.${fn}`, args: [params] });
      return Promise.resolve({ data: plan.rpc?.data ?? [], error: plan.rpc?.error ?? null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const storedRow = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  owner_user_id: null,
  source_key: "demo",
  fingerprint: "a".repeat(64),
  company_name: "Acme",
  title: "Engineer",
  location: null,
  work_mode: null,
  job_type: null,
  seniority: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: "Does things.",
  requirements: [],
  responsibilities: [],
  required_skills: ["Python"],
  preferred_skills: [],
  min_years: null,
  apply_url: null,
  posted_at: null,
  external_id: null,
  also_listed_on: [],
  is_demo: true,
  discovered_at: "2026-10-05T00:00:00+00:00",
  ...over,
});

describe("SupabaseJobStore", () => {
  it("calls search_jobs with the filters, paging and the user's demo preference", async () => {
    const { client, calls } = fakeSupabase({
      rpc: { data: [{ job: storedRow(), total: "45" }] },
      users: { data: { settings: { hide_demo_jobs: true } } },
    });
    const result = await new SupabaseJobStore(client).search(
      "user-1",
      q({
        q: "python",
        work_modes: ["remote"],
        seniority: ["senior"],
        company: "ac",
        has_salary: true,
        sort: "title",
        page: 3,
      }),
    );
    const call = calls.find((c) => c.op === "rpc.search_jobs")!;
    expect(call.args[0]).toEqual({
      q: "python",
      modes: ["remote"],
      types: [],
      levels: ["senior"],
      company: "ac",
      only_with_salary: true,
      hide_demo: true,
      sort_by: "title",
      page_size: JOBS_PAGE_SIZE,
      page_offset: JOBS_PAGE_SIZE * 2,
    });
    expect(result).toMatchObject({ total: 45, page: 3, pageCount: 3 });
    expect(result.jobs).toHaveLength(1);
  });

  it("returns an empty result for no rows", async () => {
    const { client } = fakeSupabase({ rpc: { data: [] } });
    expect(await new SupabaseJobStore(client).search("u", q())).toMatchObject({
      jobs: [],
      total: 0,
      pageCount: 0,
    });
  });

  it("skips a stored row that no longer validates instead of failing the page", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase({
      rpc: {
        data: [
          { job: storedRow(), total: 2 },
          { job: { id: "x", nonsense: true }, total: 2 },
        ],
      },
    });
    const result = await new SupabaseJobStore(client).search("u", q());
    expect(result.jobs).toHaveLength(1);
    spy.mockRestore();
  });

  it("turns an rpc failure into an opaque error without echoing its message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase({
      rpc: { error: { code: "XX000", message: "boom with secret row data" } },
    });
    const error = await new SupabaseJobStore(client).search("u", q()).catch((e) => e);
    expect(error).toBeInstanceOf(JobStoreError);
    expect(error.message).not.toContain("secret");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    spy.mockRestore();
  });

  it("creates a private job owned by the caller, from the server and not the form", async () => {
    const { client, calls } = fakeSupabase({
      table: { data: storedRow({ owner_user_id: "user-1", source_key: "manual", is_demo: false }) },
    });
    await new SupabaseJobStore(client).createPrivate("user-1", manual("Mine"));
    const insert = calls.find((c) => c.op === "jobs.insert")!;
    expect(insert.args[0]).toMatchObject({
      owner_user_id: "user-1",
      source_key: "manual",
      title: "Mine",
    });
    expect(insert.args[0]).not.toHaveProperty("is_demo");
  });

  it("maps unique violations and the limit trigger to typed errors", async () => {
    const dup = fakeSupabase({ table: { error: { code: "23505" } } });
    await expect(
      new SupabaseJobStore(dup.client).createPrivate("u", manual("x")),
    ).rejects.toMatchObject({ kind: "duplicate" });
    const limit = fakeSupabase({
      table: { error: { code: "P0001", message: "private job limit reached" } },
    });
    await expect(
      new SupabaseJobStore(limit.client).createPrivate("u", manual("x")),
    ).rejects.toMatchObject({ kind: "limit" });
  });

  it("deletes scoped to both the job and its owner", async () => {
    const { client, calls } = fakeSupabase({ table: { data: [{ id: "j1" }] } });
    expect(await new SupabaseJobStore(client).deletePrivate("user-1", "j1")).toBe(true);
    expect(calls).toContainEqual({ op: "jobs.eq", args: ["id", "j1"] });
    expect(calls).toContainEqual({ op: "jobs.eq", args: ["owner_user_id", "user-1"] });
    expect(
      await new SupabaseJobStore(fakeSupabase({ table: { data: [] } }).client).deletePrivate(
        "u",
        "j",
      ),
    ).toBe(false);
  });

  it("returns null for a job that is not visible", async () => {
    expect(
      await new SupabaseJobStore(fakeSupabase({ table: { data: null } }).client).get("u", "j"),
    ).toBeNull();
  });

  it("stores the demo preference by merging into existing settings", async () => {
    const { client, calls } = fakeSupabase({ users: { data: { settings: { theme: "dark" } } } });
    await new SupabaseJobStore(client).setDemoHidden("user-1", true);
    const update = calls.find((c) => c.op === "users.update")!;
    expect(update.args[0]).toEqual({ settings: { theme: "dark", hide_demo_jobs: true } });
    expect(calls).toContainEqual({ op: "users.eq", args: ["id", "user-1"] });
  });

  it("reports whether demo jobs exist and whether this user hid them", async () => {
    const { client } = fakeSupabase({
      table: { count: 41 },
      users: { data: { settings: { hide_demo_jobs: true } } },
    });
    expect(await new SupabaseJobStore(client).demo("u")).toEqual({ available: true, hidden: true });
    const none = fakeSupabase({ table: { count: 0 }, users: { data: null } });
    expect(await new SupabaseJobStore(none.client).demo("u")).toEqual({
      available: false,
      hidden: false,
    });
  });
});
