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
const OK = '{"ok":true,"checked":3,"blocked":[]}';
const BAD = '{"ok":false,"checked":3,"blocked":[{"claim_id":"x","text":"t","reason":"r"}]}';

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

function save(userId: string, jobId: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    user_id: userId,
    job_id: jobId,
    type: "recruiter",
    channel: "email",
    recipient_name: "Priya",
    subject: "Interested in the role",
    body: "Hello, I am interested.",
    content: '{"channel":"email"}',
    verification: OK,
    profile_hash: hash(),
    tailor_version: 1,
    ...over,
  };
  const cols = Object.keys(row);
  return as(db, "authenticated", userId, () =>
    db.query<{ id: string }>(
      `insert into public.outreach_drafts (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      cols.map((c) => row[c]),
    ),
  );
}

const update = (userId: string, id: string, sql: string, params: unknown[] = []) =>
  as(db, "authenticated", userId, () =>
    db.query(`update public.outreach_drafts set ${sql} where id = $1 returning id`, [
      id,
      ...params,
    ]),
  );

const count = (userId: string | null, role: "authenticated" | "anon" = "authenticated") =>
  as(
    db,
    role,
    userId,
    async () =>
      (await db.query<{ n: number }>("select count(*)::int as n from public.outreach_drafts"))
        .rows[0]!.n,
  );

const approve = (userId: string, id: string) =>
  update(userId, id, "status = 'approved', approved_at = now()");
const markSent = (userId: string, id: string) =>
  update(userId, id, "status = 'sent', sent_at = now()");

describe("outreach_drafts", () => {
  it("lets a user save a draft and read it back", async () => {
    await save(alice, sharedJob);
    expect(await count(alice)).toBe(1);
  });

  it("keeps drafts private", async () => {
    expect(await count(bob)).toBe(0);
    const aliceRow = (
      await as(db, "authenticated", alice, () =>
        db.query<{ id: string }>("select id from public.outreach_drafts"),
      )
    ).rows[0]!;
    expect((await approve(bob, aliceRow.id)).rows).toHaveLength(0);
    const del = await as(db, "authenticated", bob, () =>
      db.query("delete from public.outreach_drafts where id = $1 returning id", [aliceRow.id]),
    );
    expect(del.rows).toHaveLength(0);
  });

  it("denies anonymous access", async () => {
    expect(await errorOf(() => count(null, "anon"))).toMatch(/permission denied/i);
  });

  it("refuses to save as someone else or for a job the user cannot see", async () => {
    expect(await errorOf(() => save(bob, sharedJob, { user_id: alice }))).toMatch(
      /row-level security/i,
    );
    expect(await errorOf(() => save(alice, bobPrivateJob))).toMatch(/row-level security/i);
    expect(await errorOf(() => save(bob, bobPrivateJob))).toBeNull();
  });

  it.each([
    ["unknown type", { type: "spam" }],
    ["unknown channel", { channel: "sms" }],
    ["a LinkedIn note on the email channel", { type: "linkedin_note" }],
    ["an email on the LinkedIn channel", { channel: "linkedin", subject: null }],
    ["an email without a subject", { subject: null }],
    ["a LinkedIn note with a subject", { type: "linkedin_note", channel: "linkedin" }],
    [
      "a LinkedIn note over 300 characters",
      { type: "linkedin_note", channel: "linkedin", subject: null, body: "x".repeat(301) },
    ],
    ["an empty body", { body: "" }],
    ["a body over 5000 characters", { body: "x".repeat(5001) }],
    ["an over-long recipient name", { recipient_name: "x".repeat(101) }],
    ["an over-long shared context", { shared_context: "x".repeat(301) }],
    ["content that is not an object", { content: "[]" }],
    ["verification without ok", { verification: "{}" }],
    ["a malformed profile hash", { profile_hash: "nope" }],
  ])("rejects %s", async (_n, over) => {
    expect(await errorOf(() => save(alice, sharedJob, over))).toMatch(/check constraint|violates/i);
  });

  it("accepts a valid LinkedIn note", async () => {
    expect(
      await errorOf(() =>
        save(alice, sharedJob, {
          type: "linkedin_note",
          channel: "linkedin",
          subject: null,
          body: "x".repeat(300),
        }),
      ),
    ).toBeNull();
  });

  it("does not let users insert an already approved or sent draft", async () => {
    expect(await errorOf(() => save(alice, sharedJob, { status: "approved" }))).toMatch(
      /permission denied/i,
    );
    expect(await errorOf(() => save(alice, sharedJob, { status: "sent" }))).toMatch(
      /permission denied/i,
    );
  });

  it("lets a draft be edited while it is a draft, and re-checked", async () => {
    const id = (await save(alice, sharedJob)).rows[0]!.id;
    const edited = await update(alice, id, "body = $2, verification = $3", [
      "New words here.",
      BAD,
    ]);
    expect(edited.rows).toHaveLength(1);
  });

  it("approves a passing draft, then freezes its words", async () => {
    const id = (await save(alice, sharedJob)).rows[0]!.id;
    expect((await approve(alice, id)).rows).toHaveLength(1);
    for (const sql of ["body = 'changed'", "subject = 'changed'", "content = '{}'"]) {
      expect(await errorOf(() => update(alice, id, sql)), sql).toMatch(
        /approved drafts cannot be edited/,
      );
    }
    expect(await errorOf(() => update(alice, id, "status = 'draft', approved_at = null"))).toMatch(
      /approved drafts cannot be edited/,
    );
  });

  it("marks an approved draft as sent, and a sent draft never changes again", async () => {
    const id = (await save(alice, sharedJob)).rows[0]!.id;
    await approve(alice, id);
    expect((await markSent(alice, id)).rows).toHaveLength(1);
    expect(await errorOf(() => update(alice, id, "body = 'changed'"))).toMatch(
      /sent drafts cannot change/,
    );
    expect(await errorOf(() => markSent(alice, id))).toMatch(/sent drafts cannot change/);
  });

  it("can not skip approval: a draft cannot be marked sent directly", async () => {
    const id = (await save(alice, sharedJob)).rows[0]!.id;
    expect(await errorOf(() => markSent(alice, id))).toMatch(/check constraint|violates/i);
  });

  it("never approves or sends a draft whose integrity check failed", async () => {
    const id = (await save(alice, sharedJob, { verification: BAD })).rows[0]!.id;
    expect(await errorOf(() => approve(alice, id))).toMatch(/check constraint|violates/i);
    expect(await errorOf(() => markSent(alice, id))).toMatch(/check constraint|violates/i);
    // ...and a privileged writer cannot create one in that state either.
    expect(
      await errorOf(() =>
        db.query(
          `insert into public.outreach_drafts (user_id, job_id, type, channel, subject, body, content,
             verification, profile_hash, tailor_version, status, approved_at)
           values ($1, $2, 'recruiter', 'email', 's', 'b', '{}', $3, $4, 1, 'approved', now())`,
          [alice, sharedJob, BAD, hash()],
        ),
      ),
    ).toMatch(/check constraint|violates/i);
  });

  it("does not allow changing who or what a draft is for", async () => {
    const id = (await save(alice, sharedJob)).rows[0]!.id;
    for (const [col, value] of [
      ["user_id", `'${bob}'`],
      ["job_id", `'${bobPrivateJob}'`],
      ["type", "'follow_up'"],
      ["channel", "'linkedin'"],
      ["recipient_name", "'Someone else'"],
    ] as const) {
      expect(await errorOf(() => update(alice, id, `${col} = ${value}`)), col).toMatch(
        /permission denied/i,
      );
    }
  });

  it("can be deleted by its owner in any state", async () => {
    const id = (await save(alice, sharedJob)).rows[0]!.id;
    await approve(alice, id);
    await markSent(alice, id);
    const del = await as(db, "authenticated", alice, () =>
      db.query("delete from public.outreach_drafts where id = $1 returning id", [id]),
    );
    expect(del.rows).toHaveLength(1);
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
    await as(db, "authenticated", alice, () =>
      db.query("delete from public.jobs where id = $1", [jobId]),
    );
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from public.outreach_drafts where job_id = $1",
          [jobId],
        )
      ).rows[0]!.n,
    ).toBe(0);
    await db.query("delete from auth.users where id = $1", [alice]);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from public.outreach_drafts where user_id = $1",
          [alice],
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
});
