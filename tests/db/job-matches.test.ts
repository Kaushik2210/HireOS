// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createUser, errorOf } from "./helpers";

let db: PGlite;
let alice: string;
let bob: string;
let sharedJob: string;
let bobPrivateJob: string;

const hash = () => createHash("sha256").update(randomUUID()).digest("hex");

beforeAll(async () => {
  db = await createDb({ seed: true });
  alice = await createUser(db);
  bob = await createUser(db);
  sharedJob = (await db.query<{ id: string }>("select id from public.jobs limit 1")).rows[0]!.id;
  bobPrivateJob = (
    await as(db, "authenticated", bob, () =>
      db.query<{ id: string }>(
        `insert into public.jobs (owner_user_id, company_name, source_key, fingerprint, title, description)
         values ($1, 'Acme', 'manual', $2, 'Engineer', 'Does things.') returning id`,
        [bob, hash()],
      ),
    )
  ).rows[0]!.id;
}, 90_000);

afterAll(async () => {
  await db.close();
});

const components = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ id: `c${i}` })));

function save(userId: string, jobId: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    user_id: userId,
    job_id: jobId,
    scorer_version: 1,
    strength: 72,
    label: "good",
    components,
    why: "[]",
    gaps: "[]",
    keywords: '{"covered":[],"missing":[]}',
    concerns: "[]",
    cap: '{"applied":false,"reason":null}',
    action: '{"kind":"tailor","text":"x"}',
    profile_hash: hash(),
    ...over,
  };
  const cols = Object.keys(row);
  return as(db, "authenticated", userId, () =>
    db.query<{ id: string }>(
      `insert into public.job_matches (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      cols.map((c) => row[c]),
    ),
  );
}

const count = (userId: string | null, role: "authenticated" | "anon" = "authenticated") =>
  as(
    db,
    role,
    userId,
    async () =>
      (await db.query<{ n: number }>("select count(*)::int as n from public.job_matches")).rows[0]!
        .n,
  );

describe("job_matches", () => {
  it("lets a user save and read their own match", async () => {
    await save(alice, sharedJob);
    expect(await count(alice)).toBe(1);
  });

  it("keeps matches private: another user sees none and cannot touch them", async () => {
    expect(await count(bob)).toBe(0);
    const upd = await as(db, "authenticated", bob, () =>
      db.query("update public.job_matches set strength = 1 returning id"),
    );
    expect(upd.rows).toHaveLength(0);
    const del = await as(db, "authenticated", bob, () =>
      db.query("delete from public.job_matches returning id"),
    );
    expect(del.rows).toHaveLength(0);
    expect(await count(alice)).toBe(1);
  });

  it("denies anonymous access", async () => {
    expect(await errorOf(() => count(null, "anon"))).toMatch(/permission denied/i);
  });

  it("refuses to save a match as someone else", async () => {
    expect(await errorOf(() => save(bob, sharedJob, { user_id: alice }))).toMatch(
      /row-level security|permission/i,
    );
  });

  it("refuses a match for a job the user cannot see", async () => {
    expect(await errorOf(() => save(alice, bobPrivateJob))).toMatch(/row-level security/i);
    expect(await errorOf(() => save(bob, bobPrivateJob))).toBeNull();
  });

  it("keeps one row per user and job", async () => {
    expect(await errorOf(() => save(alice, sharedJob))).toMatch(/unique|duplicate/i);
  });

  it("lets the owner refresh a saved match but not move it to another user or job", async () => {
    const ok = await as(db, "authenticated", alice, () =>
      db.query(
        "update public.job_matches set strength = 80, label = 'strong' where job_id = $1 returning strength",
        [sharedJob],
      ),
    );
    expect(ok.rows[0]).toMatchObject({ strength: 80 });
    expect(
      await errorOf(() =>
        as(db, "authenticated", alice, () =>
          db.query("update public.job_matches set user_id = $1", [bob]),
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(
      await errorOf(() =>
        as(db, "authenticated", alice, () =>
          db.query("update public.job_matches set job_id = $1", [bobPrivateJob]),
        ),
      ),
    ).toMatch(/permission denied/i);
  });

  it.each([
    ["strength above 100", { strength: 101 }],
    ["negative strength", { strength: -1 }],
    ["unknown label", { label: "certain" }],
    ["six components", { components: JSON.stringify(Array.from({ length: 6 }, () => ({}))) }],
    ["components not an array", { components: "{}" }],
    ["keywords not an object", { keywords: "[]" }],
    ["scorer version 0", { scorer_version: 0 }],
    ["malformed profile hash", { profile_hash: "abc" }],
  ])("rejects %s", async (_n, over) => {
    const other = (
      await db.query<{ id: string }>("select id from public.jobs where id <> $1 limit 1", [
        sharedJob,
      ])
    ).rows[0]!.id;
    expect(await errorOf(() => save(alice, other, over))).toMatch(/check constraint|violates/i);
  });

  it("is removed with the job and with the user", async () => {
    const { id: jobId } = (
      await as(db, "authenticated", alice, () =>
        db.query<{ id: string }>(
          `insert into public.jobs (owner_user_id, company_name, source_key, fingerprint, title, description)
           values ($1, 'Acme', 'manual', $2, 'Temp', 'x') returning id`,
          [alice, hash()],
        ),
      )
    ).rows[0]!;
    await save(alice, jobId);
    expect(await count(alice)).toBe(2);
    await as(db, "authenticated", alice, () =>
      db.query("delete from public.jobs where id = $1", [jobId]),
    );
    expect(await count(alice)).toBe(1);

    await db.query("delete from auth.users where id = $1", [alice]);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from public.job_matches where user_id = $1",
          [alice],
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
});
