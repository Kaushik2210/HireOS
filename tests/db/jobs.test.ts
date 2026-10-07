// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateJobsSeedSql } from "@/db/seed/jobs-sql";
import { EXPECTED_DEMO_UNIQUE_JOBS, DEMO_COMPANIES } from "@/db/seed/demo-jobs";
import { SEED_FILE, as, createDb, createUser, errorOf } from "./helpers";

let db: PGlite;

beforeAll(async () => {
  db = await createDb({ seed: true });
}, 90_000);

afterAll(async () => {
  await db.close();
});

const fp = () => createHash("sha256").update(randomUUID()).digest("hex");

/** Inserts a private (manual) job as the given user. */
function addPrivate(userId: string, o: Record<string, string | number | null> = {}) {
  const row: Record<string, string | number | null> = {
    owner_user_id: userId,
    company_name: "Acme",
    source_key: "manual",
    fingerprint: fp(),
    title: "Engineer",
    description: "Does things.",
    ...o,
  };
  const cols = Object.keys(row);
  return as(db, "authenticated", userId, () =>
    db.query<{ id: string }>(
      `insert into public.jobs (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      cols.map((c) => row[c]),
    ),
  );
}

describe("seed", () => {
  it("loads the demo companies and the merged, de-duplicated job list", async () => {
    const jobs = await db.query<{ n: number }>("select count(*)::int as n from public.jobs");
    const companies = await db.query<{ n: number }>(
      "select count(*)::int as n from public.companies",
    );
    expect(jobs.rows[0]!.n).toBe(EXPECTED_DEMO_UNIQUE_JOBS);
    expect(jobs.rows[0]!.n).toBeGreaterThanOrEqual(30);
    expect(companies.rows[0]!.n).toBe(DEMO_COMPANIES.length);
    expect(companies.rows[0]!.n).toBeGreaterThanOrEqual(10);
  });

  it("marks everything as shared demo data and links jobs to companies", async () => {
    const { rows } = await db.query<{ bad: number }>(
      `select count(*)::int as bad from public.jobs
        where owner_user_id is not null or not is_demo or company_id is null`,
    );
    expect(rows[0]!.bad).toBe(0);
  });

  it("records second sources for the merged duplicates", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.jobs where jsonb_array_length(also_listed_on) > 0",
    );
    expect(rows[0]!.n).toBe(3);
  });

  it("is idempotent: running it again changes nothing", async () => {
    await db.exec(readFileSync(SEED_FILE, "utf8"));
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.jobs");
    expect(rows[0]!.n).toBe(EXPECTED_DEMO_UNIQUE_JOBS);
  });

  it("matches what the generator produces today (regenerate with npm run seed:generate)", async () => {
    const committed = readFileSync(SEED_FILE, "utf8").replace(/\r\n/g, "\n");
    const fresh = (await generateJobsSeedSql()).replace(/\r\n/g, "\n");
    expect(committed).toBe(fresh);
  });
});

describe("visibility (Row Level Security)", () => {
  it("lets any signed-in user read the shared catalogue", async () => {
    const a = await createUser(db);
    const n = await as(
      db,
      "authenticated",
      a,
      async () =>
        (await db.query<{ n: number }>("select count(*)::int as n from public.jobs")).rows[0]!.n,
    );
    expect(n).toBe(EXPECTED_DEMO_UNIQUE_JOBS);
  });

  it("denies anon entirely", async () => {
    for (const table of ["jobs", "companies", "job_sources"]) {
      const err = await errorOf(() =>
        as(db, "anon", null, () => db.query(`select * from public.${table}`)),
      );
      expect(err, table).toMatch(/permission denied/i);
    }
  });

  it("lets a user add a private job that only they can see", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const job = await addPrivate(a, { title: "Only mine" });
    const seenByA = await as(
      db,
      "authenticated",
      a,
      async () =>
        (await db.query("select id from public.jobs where id = $1", [job.rows[0]!.id])).rows,
    );
    const seenByB = await as(
      db,
      "authenticated",
      b,
      async () =>
        (await db.query("select id from public.jobs where id = $1", [job.rows[0]!.id])).rows,
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByB).toHaveLength(0);
  });

  it("keeps private jobs out of search results for other users", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    await addPrivate(a, { title: "Zebra Wrangler Extraordinaire" });
    const search = (u: string) =>
      as(
        db,
        "authenticated",
        u,
        async () =>
          (
            await db.query<{ total: string }>(
              "select * from public.search_jobs(q => 'zebra wrangler')",
            )
          ).rows,
      );
    expect(await search(a)).toHaveLength(1);
    expect(await search(b)).toHaveLength(0);
  });

  it("makes shared jobs read-only for users: no insert, update or delete", async () => {
    const a = await createUser(db);
    const shared = (await db.query<{ id: string }>("select id from public.jobs limit 1")).rows[0]!
      .id;

    const insertErr = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query(
          `insert into public.jobs (owner_user_id, company_name, source_key, fingerprint, title, description)
           values (null, 'Fake', 'manual', $1, 'Planted', 'x')`,
          [fp()],
        ),
      ),
    );
    const updateErr = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query("update public.jobs set title = 'hacked' where id = $1", [shared]),
      ),
    );
    const deleted = await as(db, "authenticated", a, () =>
      db.query("delete from public.jobs where id = $1", [shared]),
    );
    expect(insertErr).toMatch(/row-level security/i);
    expect(updateErr).toMatch(/permission denied/i);
    expect(deleted.affectedRows).toBe(0);
  });

  it("blocks creating a job in someone else's name, and non-manual or demo private jobs", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    expect(await errorOf(() => addPrivate(b, {}).then(() => null))).toBeNull();
    const forOther = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query(
          `insert into public.jobs (owner_user_id, company_name, source_key, fingerprint, title, description)
           values ($1, 'X', 'manual', $2, 'T', 'D')`,
          [b, fp()],
        ),
      ),
    );
    const wrongSource = await errorOf(() => addPrivate(a, { source_key: "demo" }));
    expect(forOther).toMatch(/row-level security/i);
    expect(wrongSource).toMatch(/row-level security|check constraint/i);
  });

  it("does not let a user set is_demo, or reassign ownership", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const demoErr = await errorOf(() => addPrivate(a, { is_demo: 1 as unknown as number }));
    expect(demoErr).toMatch(/permission denied|invalid input|check constraint/i);
    const job = await addPrivate(a);
    const err = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query("update public.jobs set owner_user_id = $2 where id = $1", [job.rows[0]!.id, b]),
      ),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("lets owners delete their own private jobs, and nobody else's", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const job = await addPrivate(a);
    const denied = await as(db, "authenticated", b, () =>
      db.query("delete from public.jobs where id = $1", [job.rows[0]!.id]),
    );
    const ok = await as(db, "authenticated", a, () =>
      db.query("delete from public.jobs where id = $1", [job.rows[0]!.id]),
    );
    expect(denied.affectedRows).toBe(0);
    expect(ok.affectedRows).toBe(1);
  });

  it("removes a user's private jobs with their account, and leaves the catalogue alone", async () => {
    const a = await createUser(db);
    await addPrivate(a);
    await db.query("delete from auth.users where id = $1", [a]);
    const mine = await db.query("select 1 from public.jobs where owner_user_id = $1", [a]);
    const shared = await db.query<{ n: number }>(
      "select count(*)::int as n from public.jobs where owner_user_id is null",
    );
    expect(mine.rows).toHaveLength(0);
    expect(shared.rows[0]!.n).toBe(EXPECTED_DEMO_UNIQUE_JOBS);
  });

  it("makes companies and sources readable but not writable by users", async () => {
    const a = await createUser(db);
    const reads = await as(db, "authenticated", a, async () => ({
      companies: (await db.query("select * from public.companies")).rows.length,
      sources: (await db.query("select * from public.job_sources")).rows.length,
    }));
    expect(reads.companies).toBe(DEMO_COMPANIES.length);
    expect(reads.sources).toBe(3);
    for (const sql of [
      "insert into public.companies (slug, name) values ('evil', 'Evil')",
      "insert into public.job_sources (key, name, kind) values ('evil', 'Evil', 'feed')",
      "update public.companies set name = 'x'",
    ]) {
      expect(await errorOf(() => as(db, "authenticated", a, () => db.query(sql))), sql).toMatch(
        /permission denied/i,
      );
    }
  });
});

describe("constraints and limits", () => {
  const run = (sql: string, params: unknown[] = []) => errorOf(() => db.query(sql, params));

  it("rejects duplicate fingerprints in the catalogue and per owner, but not across owners", async () => {
    const dup = await run(
      `insert into public.jobs (company_name, source_key, fingerprint, title, description)
       select company_name, 'demo', fingerprint, title, description from public.jobs where owner_user_id is null limit 1`,
    );
    expect(dup).toMatch(/duplicate key|unique/i);

    const a = await createUser(db);
    const b = await createUser(db);
    const shared = fp();
    await addPrivate(a, { fingerprint: shared });
    expect(await errorOf(() => addPrivate(a, { fingerprint: shared }))).toMatch(
      /duplicate key|unique/i,
    );
    expect(await errorOf(() => addPrivate(b, { fingerprint: shared }))).toBeNull();
  });

  it("rejects bad salary data", async () => {
    const a = await createUser(db);
    expect(
      await errorOf(() =>
        addPrivate(a, { salary_min: 900, salary_max: 100, salary_currency: "INR" }),
      ),
    ).toMatch(/check constraint/i);
    expect(await errorOf(() => addPrivate(a, { salary_min: 100, salary_max: 200 }))).toMatch(
      /check constraint/i,
    ); // no currency
    expect(
      await errorOf(() => addPrivate(a, { salary_min: 100, salary_currency: "rupees" })),
    ).toMatch(/check constraint/i);
    expect(await errorOf(() => addPrivate(a, { salary_min: -5, salary_currency: "INR" }))).toMatch(
      /check constraint/i,
    );
  });

  it("rejects bad links, enums and sizes", async () => {
    const a = await createUser(db);
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://x.test",
      "http://a b.test",
    ]) {
      expect(await errorOf(() => addPrivate(a, { apply_url: bad })), bad).toMatch(
        /check constraint/i,
      );
    }
    expect(await errorOf(() => addPrivate(a, { work_mode: "teleport" }))).toMatch(
      /check constraint/i,
    );
    expect(await errorOf(() => addPrivate(a, { job_type: "forever" }))).toMatch(
      /check constraint/i,
    );
    expect(await errorOf(() => addPrivate(a, { title: "" }))).toMatch(/check constraint/i);
    expect(await errorOf(() => addPrivate(a, { title: "x".repeat(201) }))).toMatch(
      /check constraint/i,
    );
    expect(await errorOf(() => addPrivate(a, { description: "x".repeat(20_001) }))).toMatch(
      /check constraint/i,
    );
    expect(await errorOf(() => addPrivate(a, { fingerprint: "nothex" }))).toMatch(
      /check constraint/i,
    );
  });

  it("stops a user at 100 private jobs, whatever the application does", async () => {
    const a = await createUser(db);
    for (let i = 0; i < 100; i++) await addPrivate(a, { title: `Job ${i}` });
    expect(await errorOf(() => addPrivate(a, { title: "One too many" }))).toMatch(
      /private job limit/i,
    );
    const other = await createUser(db);
    expect(await errorOf(() => addPrivate(other))).toBeNull();
  }, 60_000);

  it("keeps updated_at current", async () => {
    const a = await createUser(db);
    const job = await addPrivate(a);
    await db.query("update public.jobs set title = 'Renamed' where id = $1", [job.rows[0]!.id]);
    const { rows } = await db.query<{ ok: boolean }>(
      "select updated_at > discovered_at as ok from public.jobs where id = $1",
      [job.rows[0]!.id],
    );
    expect(rows[0]!.ok).toBe(true);
  });
});
