// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createUser, errorOf } from "./helpers";

let db: PGlite;
let alice: string;
let bob: string;
let sharedJob: string;
let otherJob: string;
let bobPrivateJob: string;

const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
const OK = '{"ok":true,"checked":3,"blocked":[]}';
const BAD = '{"ok":false,"checked":3,"blocked":[{"claim_id":"x","text":"t","reason":"r"}]}';

beforeAll(async () => {
  db = await createDb({ seed: true });
  alice = await createUser(db);
  bob = await createUser(db);
  const jobs = (await db.query<{ id: string }>("select id from public.jobs limit 2")).rows;
  sharedJob = jobs[0]!.id;
  otherJob = jobs[1]!.id;
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

function save(userId: string, jobId: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    user_id: userId,
    job_id: jobId,
    kind: "resume",
    version_number: 1,
    content: '{"kind":"resume"}',
    changes: "[]",
    missing: "[]",
    verification: OK,
    body: "Some resume text",
    tailor_version: 1,
    profile_hash: hash(),
    ...over,
  };
  const cols = Object.keys(row);
  return as(db, "authenticated", userId, () =>
    db.query<{ id: string }>(
      `insert into public.document_versions (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
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
      (await db.query<{ n: number }>("select count(*)::int as n from public.document_versions"))
        .rows[0]!.n,
  );

const approve = (userId: string, id: string) =>
  as(db, "authenticated", userId, () =>
    db.query(
      "update public.document_versions set status = 'approved', approved_at = now() where id = $1 returning id",
      [id],
    ),
  );

describe("document_versions", () => {
  it("lets a user save a version and read it back", async () => {
    await save(alice, sharedJob);
    expect(await count(alice)).toBe(1);
  });

  it("keeps versions private", async () => {
    expect(await count(bob)).toBe(0);
    const upd = await approve(bob, (await save(bob, sharedJob)).rows[0]!.id);
    expect(upd.rows).toHaveLength(1); // bob's own
    const aliceRow = (
      await as(db, "authenticated", alice, () =>
        db.query<{ id: string }>("select id from public.document_versions"),
      )
    ).rows[0]!;
    expect((await approve(bob, aliceRow.id)).rows).toHaveLength(0);
    const del = await as(db, "authenticated", bob, () =>
      db.query("delete from public.document_versions where id = $1 returning id", [aliceRow.id]),
    );
    expect(del.rows).toHaveLength(0);
  });

  it("denies anonymous access", async () => {
    expect(await errorOf(() => count(null, "anon"))).toMatch(/permission denied/i);
  });

  it("refuses to save as another user or against a job the user cannot see", async () => {
    expect(
      await errorOf(() => save(bob, sharedJob, { user_id: alice, version_number: 9 })),
    ).toMatch(/row-level security/i);
    expect(await errorOf(() => save(alice, bobPrivateJob, { version_number: 9 }))).toMatch(
      /row-level security/i,
    );
  });

  it("numbers versions per user, job and kind, with no repeats", async () => {
    expect(await errorOf(() => save(alice, sharedJob))).toMatch(/unique|duplicate/i);
    expect(await errorOf(() => save(alice, sharedJob, { version_number: 2 }))).toBeNull();
    expect(await errorOf(() => save(alice, sharedJob, { kind: "cover_letter" }))).toBeNull();
    expect(await errorOf(() => save(alice, otherJob))).toBeNull();
  });

  it("lets a version descend only from the user's own version", async () => {
    const parent = (await save(alice, otherJob, { version_number: 2 })).rows[0]!.id;
    expect(
      await errorOf(() => save(alice, otherJob, { version_number: 3, parent_id: parent })),
    ).toBeNull();
    const bobsVersion = (await save(bob, otherJob)).rows[0]!.id;
    expect(
      await errorOf(() => save(alice, otherJob, { version_number: 4, parent_id: bobsVersion })),
    ).toMatch(/row-level security/i);
  });

  it.each([
    ["unknown kind", { kind: "letter" }],
    ["version number 0", { version_number: 0 }],
    ["empty body", { body: "" }],
    ["body over 20000 characters", { body: "x".repeat(20001) }],
    ["content not an object", { content: "[]" }],
    ["verification without ok", { verification: "{}" }],
    ["verification not an object", { verification: "[]" }],
    ["malformed profile hash", { profile_hash: "nope" }],
  ])("rejects %s", async (_n, over) => {
    const job = (
      await db.query<{ id: string }>(
        "select id from public.jobs where id not in ($1, $2) limit 1",
        [sharedJob, otherJob],
      )
    ).rows[0]!.id;
    expect(await errorOf(() => save(alice, job, over))).toMatch(/check constraint|violates/i);
  });

  it("approves a draft once, and an approved version can never change again", async () => {
    const id = (await save(alice, sharedJob, { version_number: 10 })).rows[0]!.id;
    expect((await approve(alice, id)).rows).toHaveLength(1);
    expect(await errorOf(() => approve(alice, id))).toMatch(/approved versions cannot change/);
    expect(
      await errorOf(() =>
        as(db, "authenticated", alice, () =>
          db.query(
            "update public.document_versions set status = 'draft', approved_at = null where id = $1",
            [id],
          ),
        ),
      ),
    ).toMatch(/approved versions cannot change/);
  });

  it("never approves a version whose integrity check failed", async () => {
    const id = (await save(alice, sharedJob, { version_number: 11, verification: BAD })).rows[0]!
      .id;
    expect(await errorOf(() => approve(alice, id))).toMatch(/check constraint|violates/i);
    // Users cannot insert an already-approved row at all (no grant on status), and the
    // constraint holds even for a privileged writer.
    expect(
      await errorOf(() => save(alice, sharedJob, { version_number: 12, status: "approved" })),
    ).toMatch(/permission denied/i);
    const insertApproved = (verification: string, approvedAt: string | null) =>
      db.query(
        `insert into public.document_versions (user_id, job_id, kind, version_number, status, approved_at,
           content, verification, body, tailor_version, profile_hash)
         values ($1, $2, 'resume', 50, 'approved', $3, '{}', $4, 'x', 1, $5)`,
        [alice, sharedJob, approvedAt, verification, hash()],
      );
    expect(await errorOf(() => insertApproved(BAD, new Date().toISOString()))).toMatch(
      /check constraint|violates/i,
    );
    expect(await errorOf(() => insertApproved(OK, null))).toMatch(/check constraint|violates/i);
  });

  it("does not allow the saved content to be edited, or the row moved", async () => {
    const id = (await save(alice, sharedJob, { version_number: 13 })).rows[0]!.id;
    for (const col of ["body", "content", "verification", "user_id", "job_id", "version_number"]) {
      const value =
        col === "body"
          ? "'x'"
          : col === "user_id"
            ? `'${bob}'`
            : col === "job_id"
              ? `'${otherJob}'`
              : col === "version_number"
                ? "99"
                : "'{}'";
      expect(
        await errorOf(() =>
          as(db, "authenticated", alice, () =>
            db.query(`update public.document_versions set ${col} = ${value} where id = $1`, [id]),
          ),
        ),
        col,
      ).toMatch(/permission denied/i);
    }
  });

  it("can be deleted by its owner, approved or not", async () => {
    const id = (await save(alice, sharedJob, { version_number: 14 })).rows[0]!.id;
    await approve(alice, id);
    const del = await as(db, "authenticated", alice, () =>
      db.query("delete from public.document_versions where id = $1 returning id", [id]),
    );
    expect(del.rows).toHaveLength(1);
  });

  it("is removed with the job and with the user, and a parent can be deleted without losing its children", async () => {
    const parent = (await save(alice, otherJob, { version_number: 20 })).rows[0]!.id;
    const child = (await save(alice, otherJob, { version_number: 21, parent_id: parent })).rows[0]!
      .id;
    await as(db, "authenticated", alice, () =>
      db.query("delete from public.document_versions where id = $1", [parent]),
    );
    const row = (
      await db.query<{ parent_id: string | null }>(
        "select parent_id from public.document_versions where id = $1",
        [child],
      )
    ).rows[0]!;
    expect(row.parent_id).toBeNull();

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
    await as(db, "authenticated", alice, () =>
      db.query("delete from public.jobs where id = $1", [jobId]),
    );
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from public.document_versions where job_id = $1",
          [jobId],
        )
      ).rows[0]!.n,
    ).toBe(0);

    await db.query("delete from auth.users where id = $1", [alice]);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from public.document_versions where user_id = $1",
          [alice],
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
});
