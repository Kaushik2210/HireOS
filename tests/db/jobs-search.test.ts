// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { EXPECTED_DEMO_UNIQUE_JOBS } from "@/db/seed/demo-jobs";
import { DEFAULT_JOB_QUERY, parseJobQuery, type JobQuery } from "@/lib/jobs/schemas";
import { normalizeRawJob } from "@/services/jobs/normalize";
import { MANUAL_SOURCE } from "@/services/jobs/providers/registry";
import { as, createDb, createUser } from "./helpers";

/**
 * The in-memory demo store and the SQL function `search_jobs` must agree exactly, so demo
 * mode shows what a real database would. Every query here runs against both.
 */

let db: PGlite;
let userId: string;
const memory = new MemoryJobStore();

beforeAll(async () => {
  db = await createDb({ seed: true });
  userId = await createUser(db);
}, 90_000);

afterAll(async () => {
  await db.close();
});

const q = (patch: Partial<JobQuery>): JobQuery => ({ ...DEFAULT_JOB_QUERY, ...patch });

async function sqlSearch(query: JobQuery, hideDemo = false, user = userId) {
  const rows = await as(
    db,
    "authenticated",
    user,
    async () =>
      (
        await db.query<{ job: { id: string; title: string }; total: string }>(
          `select job, total from public.search_jobs(
           q => $1, modes => $2::text[], types => $3::text[], levels => $4::text[],
           company => $5, only_with_salary => $6, hide_demo => $7, sort_by => $8,
           page_size => 20, page_offset => $9)`,
          [
            query.q ?? null,
            query.work_modes,
            query.job_types,
            query.seniority,
            query.company ?? null,
            query.has_salary,
            hideDemo,
            query.sort,
            (query.page - 1) * 20,
          ],
        )
      ).rows,
  );
  return {
    ids: rows.map((r) => r.job.id),
    titles: rows.map((r) => r.job.title),
    total: Number(rows[0]?.total ?? 0),
  };
}

async function memSearch(query: JobQuery, user = "parity-user") {
  const r = await memory.search(user, query);
  return { ids: r.jobs.map((j) => j.id), titles: r.jobs.map((j) => j.title), total: r.total };
}

const CASES: [string, JobQuery][] = [
  ["default, page 1", q({})],
  ["default, page 2", q({ page: 2 })],
  ["default, page 3 (past the end)", q({ page: 3 })],
  ["single word", q({ q: "python" })],
  ["two words, both required", q({ q: "python django" })],
  ["case and spacing ignored", q({ q: "  PYTHON   Django " })],
  ["matches a company", q({ q: "helix" })],
  ["matches a location", q({ q: "hyderabad" })],
  ["matches a skill", q({ q: "kubernetes" })],
  ["matches description text", q({ q: "settlement" })],
  ["no match", q({ q: "zzzzqqqq" })],
  ["remote only", q({ work_modes: ["remote"] })],
  ["internships", q({ job_types: ["internship"] })],
  ["senior", q({ seniority: ["senior"] })],
  ["entry level", q({ seniority: ["entry"] })],
  ["company filter", q({ company: "helix" })],
  ["company filter, mixed case", q({ company: "TIDE" })],
  ["has salary", q({ has_salary: true })],
  ["has salary + remote", q({ has_salary: true, work_modes: ["remote"] })],
  ["search + filters", q({ q: "python", work_modes: ["hybrid"], seniority: ["mid"] })],
  ["sort oldest", q({ sort: "oldest" })],
  ["sort oldest page 2", q({ sort: "oldest", page: 2 })],
  ["sort title", q({ sort: "title" })],
  ["sort title page 2", q({ sort: "title", page: 2 })],
  ["sort title with search", q({ sort: "title", q: "engineer" })],
  ["hand-edited url", { ...parseJobQuery({ work_mode: "teleport", page: "x", q: "sql" }) }],
];

describe("search_jobs matches the in-memory store", () => {
  it.each(CASES)("%s", async (_label, query) => {
    const [sql, mem] = await Promise.all([sqlSearch(query), memSearch(query)]);
    expect(mem.total).toBe(sql.total);
    expect(mem.titles).toEqual(sql.titles);
    expect(mem.ids).toEqual(sql.ids);
  });

  it("agrees when demo data is hidden: nothing from the shared catalogue", async () => {
    await memory.setDemoHidden("hider", true);
    const [sql, mem] = await Promise.all([sqlSearch(q({}), true), memSearch(q({}), "hider")]);
    expect(sql.total).toBe(0);
    expect(mem.total).toBe(0);
  });

  it("agrees when a user has added a private job (it sorts newest, and only they see it)", async () => {
    const raw = {
      company_name: "Parity Works",
      title: "Zebra Parity Engineer",
      location: "Pune",
      description: "Requirements\n• 2+ years of experience with Python",
    };
    const n = normalizeRawJob(raw, MANUAL_SOURCE);
    if (!n.ok) throw new Error(n.reason);

    const owner = await createUser(db);
    await as(db, "authenticated", owner, () =>
      db.query(
        `insert into public.jobs (owner_user_id, company_name, source_key, fingerprint, title, location, description, required_skills)
         values ($1, $2, 'manual', $3, $4, $5, $6, $7)`,
        [
          owner,
          n.job.company_name,
          n.job.fingerprint,
          n.job.title,
          n.job.location,
          n.job.description,
          n.job.required_skills,
        ],
      ),
    );
    await memory.createPrivate("parity-owner", n.job);

    const sqlOwner = await sqlSearch(q({ q: "zebra parity" }), false, owner);
    const memOwner = await memSearch(q({ q: "zebra parity" }), "parity-owner");
    expect(sqlOwner.titles).toEqual(["Zebra Parity Engineer"]);
    expect(memOwner.titles).toEqual(sqlOwner.titles);

    const sqlOther = await sqlSearch(q({ q: "zebra parity" }));
    const memOther = await memSearch(q({ q: "zebra parity" }));
    expect(sqlOther.total).toBe(0);
    expect(memOther.total).toBe(0);

    const newestOwner = await sqlSearch(q({}), false, owner);
    expect(newestOwner.titles[0]).toBe("Zebra Parity Engineer");
    expect((await memSearch(q({}), "parity-owner")).titles[0]).toBe("Zebra Parity Engineer");
    expect(newestOwner.total).toBe(EXPECTED_DEMO_UNIQUE_JOBS + 1);
  });
});

describe("search_jobs behaviour", () => {
  it("treats search text as plain text, never as a pattern or SQL", async () => {
    for (const hostile of ["%", "_", "'; drop table jobs; --", "\\", "a\\b", "%%__"]) {
      const sql = await sqlSearch(q({ q: hostile }));
      const mem = await memSearch(q({ q: hostile }));
      expect(mem.total, hostile).toBe(sql.total);
    }
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.jobs");
    expect(rows[0]!.n).toBeGreaterThanOrEqual(EXPECTED_DEMO_UNIQUE_JOBS);
  });

  it("clamps paging so no one can ask for everything at once", async () => {
    const { rows } = await as(db, "authenticated", userId, () =>
      db.query("select * from public.search_jobs(page_size => 100000)"),
    );
    expect(rows.length).toBeLessThanOrEqual(100);
    const negative = await as(db, "authenticated", userId, () =>
      db.query("select * from public.search_jobs(page_size => -5, page_offset => -10)"),
    );
    expect(negative.rows.length).toBe(1);
  });

  it("reports the total across pages while returning one page", async () => {
    const sql = await sqlSearch(q({}));
    expect(sql.ids).toHaveLength(20);
    expect(sql.total).toBe(EXPECTED_DEMO_UNIQUE_JOBS);
  });

  it("finds the Docker jobs the first demo candidate lacks", async () => {
    const sql = await sqlSearch(q({ q: "docker" }));
    expect(sql.total).toBeGreaterThan(0);
  });
});
