// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createUser, errorOf } from "./helpers";

let db: PGlite;
let alice: string;
let bob: string;
let jobs: string[];
let bobPrivateJob: string;

const hash = () => createHash("sha256").update(randomUUID()).digest("hex");

beforeAll(async () => {
  db = await createDb({ seed: true });
  alice = await createUser(db);
  bob = await createUser(db);
  jobs = (await db.query<{ id: string }>("select id from public.jobs limit 30")).rows.map(
    (r) => r.id,
  );
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

let nextJob = 0;
const freshJob = () => jobs[nextJob++ % jobs.length]!;

async function application(userId: string) {
  return (
    await as(db, "authenticated", userId, () =>
      db.query<{ id: string }>(
        `insert into public.applications (user_id, job_id, job_title, company_name, status)
         values ($1, $2, 'Backend Engineer', 'Helix', 'applied') returning id`,
        [userId, freshJob()],
      ),
    )
  ).rows[0]!.id;
}

// "applied" needs a date; the helper above inserts through the shortlisted path instead.
async function app(userId: string) {
  return (
    await as(db, "authenticated", userId, () =>
      db.query<{ id: string }>(
        `insert into public.applications (user_id, job_id, job_title, company_name, status)
         values ($1, $2, 'Backend Engineer', 'Helix', 'shortlisted') returning id`,
        [userId, freshJob()],
      ),
    )
  ).rows[0]!.id;
}
void application;

function interview(userId: string, applicationId: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    user_id: userId,
    application_id: applicationId,
    round_label: "Phone screen",
    kind: "phone_screen",
    checklist: JSON.stringify([
      { id: "g1", text: "Re-read the posting", done: false, source: "generated" },
    ]),
    ...over,
  };
  const cols = Object.keys(row);
  return as(db, "authenticated", userId, () =>
    db.query<{ id: string }>(
      `insert into public.interviews (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      cols.map((c) => row[c]),
    ),
  );
}

const QUESTION = JSON.stringify({
  id: "q",
  kind: "behavioral",
  text: "Tell me about a challenge.",
  skill: null,
  expects: [],
  gap: false,
});
const questions = (n: number) =>
  JSON.stringify(Array.from({ length: n }, () => JSON.parse(QUESTION)));

function session(userId: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    user_id: userId,
    job_id: freshJob(),
    job_title: "Backend Engineer",
    company_name: "Helix",
    focus: "technical",
    question_count: 3,
    questions: questions(3),
    round: 0,
    ...over,
  };
  const cols = Object.keys(row);
  return as(db, "authenticated", userId, () =>
    db.query<{ id: string }>(
      `insert into public.mock_sessions (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      cols.map((c) => row[c]),
    ),
  );
}

function answer(
  userId: string,
  sessionId: string,
  position: number,
  over: Record<string, unknown> = {},
) {
  const row: Record<string, unknown> = {
    user_id: userId,
    session_id: sessionId,
    position,
    question: QUESTION,
    answer: "I fixed a slow query and it dropped from 4 seconds to 600 ms.",
    feedback: JSON.stringify({ overall: 80 }),
    overall: 80,
    ...over,
  };
  const cols = Object.keys(row);
  return as(db, "authenticated", userId, () =>
    db.query<{ id: string }>(
      `insert into public.mock_answers (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      cols.map((c) => row[c]),
    ),
  );
}

const finish = (userId: string, id: string, overall: number) =>
  as(db, "authenticated", userId, () =>
    db.query(
      "update public.mock_sessions set status = 'completed', completed_at = now(), overall = $2, dimensions = '[]' where id = $1 returning id",
      [id, overall],
    ),
  );

describe("interviews", () => {
  it("saves a round for the user's own application, and reads it back", async () => {
    const a = await app(alice);
    await interview(alice, a);
    expect(
      (await as(db, "authenticated", alice, () => db.query("select id from public.interviews")))
        .rows.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("is private, and bound to an application the user can see", async () => {
    const a = await app(alice);
    const id = (await interview(alice, a)).rows[0]!.id;
    const bobSees = await as(db, "authenticated", bob, () =>
      db.query("select id from public.interviews where id = $1", [id]),
    );
    expect(bobSees.rows).toHaveLength(0);
    expect(await errorOf(() => interview(bob, a))).toMatch(/row-level security/i);
    expect(await errorOf(async () => interview(bob, await app(bob), { user_id: alice }))).toMatch(
      /row-level security|not open for answers/i,
    );
    const upd = await as(db, "authenticated", bob, () =>
      db.query("update public.interviews set notes = 'x' where id = $1 returning id", [id]),
    );
    expect(upd.rows).toHaveLength(0);
    const del = await as(db, "authenticated", bob, () =>
      db.query("delete from public.interviews where id = $1 returning id", [id]),
    );
    expect(del.rows).toHaveLength(0);
  });

  it("denies anonymous access", async () => {
    expect(
      await errorOf(() => as(db, "anon", null, () => db.query("select * from public.interviews"))),
    ).toMatch(/permission denied/i);
  });

  it.each([
    ["an empty round name", { round_label: "" }],
    ["an over-long round name", { round_label: "x".repeat(101) }],
    ["an unknown kind", { kind: "chat" }],
    ["an unknown format", { format: "carrier pigeon" }],
    ["a time without a date", { scheduled_time: "10:00" }],
    ["over-long notes", { notes: "x".repeat(2001) }],
    ["a checklist that is not a list", { checklist: "{}" }],
    [
      "a checklist of 31 items",
      { checklist: JSON.stringify(Array.from({ length: 31 }, (_, i) => ({ id: `g${i}` }))) },
    ],
  ])("rejects %s", async (_n, over) => {
    expect(await errorOf(async () => interview(alice, await app(alice), over))).toMatch(
      /check constraint|violates/i,
    );
  });

  it("accepts a dated and timed round and edits the working fields, but never moves it", async () => {
    const a = await app(alice);
    const id = (
      await interview(alice, a, {
        scheduled_on: "2026-10-20",
        scheduled_time: "14:30",
        format: "video",
      })
    ).rows[0]!.id;
    const upd = await as(db, "authenticated", alice, () =>
      db.query(
        "update public.interviews set status = 'completed', notes = 'Went fine' where id = $1 returning status",
        [id],
      ),
    );
    expect(upd.rows[0]).toEqual({ status: "completed" });
    for (const [col, value] of [
      ["application_id", `'${await app(alice)}'`],
      ["user_id", `'${bob}'`],
    ]) {
      expect(
        await errorOf(() =>
          as(db, "authenticated", alice, () =>
            db.query(`update public.interviews set ${col} = ${value} where id = $1`, [id]),
          ),
        ),
        col,
      ).toMatch(/permission denied/i);
    }
  });

  it("goes with its application, and with the user", async () => {
    const a = await app(alice);
    const id = (await interview(alice, a)).rows[0]!.id;
    await as(db, "authenticated", alice, () =>
      db.query("delete from public.applications where id = $1", [a]),
    );
    expect(
      (await db.query("select 1 from public.interviews where id = $1", [id])).rows,
    ).toHaveLength(0);
  });

  it("stops each user at 200 rounds", async () => {
    const carol = await createUser(db);
    const a = (
      await db.query<{ id: string }>(
        "insert into public.applications (user_id, job_title, company_name) values ($1, 'R', 'C') returning id",
        [carol],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into public.interviews (user_id, application_id, round_label, kind)
       select $1, $2, 'Round ' || g, 'other' from generate_series(1, 200) g`,
      [carol, a],
    );
    expect(await errorOf(() => interview(carol, a))).toMatch(/interview limit reached/);
  }, 60_000);
});

describe("mock sessions", () => {
  it("starts a session with the questions chosen, private to its owner", async () => {
    const id = (await session(alice)).rows[0]!.id;
    expect(
      (
        await as(db, "authenticated", bob, () =>
          db.query("select id from public.mock_sessions where id = $1", [id]),
        )
      ).rows,
    ).toHaveLength(0);
    expect(await errorOf(() => session(bob, { user_id: alice }))).toMatch(/row-level security/i);
    expect(await errorOf(() => session(alice, { job_id: bobPrivateJob }))).toMatch(
      /row-level security/i,
    );
    expect(await errorOf(() => session(bob, { job_id: bobPrivateJob }))).toBeNull();
  });

  it.each([
    ["fewer than three questions", { question_count: 2, questions: questions(2) }],
    ["more than ten questions", { question_count: 11, questions: questions(11) }],
    ["a count that does not match the questions", { question_count: 5 }],
    ["an unknown focus", { focus: "trivia" }],
    ["questions that are not a list", { questions: "{}" }],
    ["a negative round", { round: -1 }],
    ["an already finished session", { status: "completed" }],
  ])("rejects %s", async (_n, over) => {
    expect(await errorOf(() => session(alice, over))).toMatch(
      /check constraint|violates|permission denied|row-level|non-array/i,
    );
  });

  it("takes answers in order, and only while the session is open", async () => {
    const s = (await session(alice)).rows[0]!.id;
    expect(await errorOf(() => answer(alice, s, 1))).toMatch(/in order/);
    await answer(alice, s, 0);
    expect(await errorOf(() => answer(alice, s, 0))).toMatch(/in order|unique|duplicate/i);
    await answer(alice, s, 1);
    await answer(alice, s, 2);
    expect(await errorOf(() => answer(alice, s, 3))).toMatch(/in order/);
  });

  it("refuses answers to someone else's session", async () => {
    const s = (await session(alice)).rows[0]!.id;
    expect(await errorOf(() => answer(bob, s, 0))).toMatch(
      /row-level security|not open for answers/i,
    );
    expect(await errorOf(() => answer(bob, s, 0, { user_id: alice }))).toMatch(
      /row-level security|not open for answers/i,
    );
  });

  it.each([
    ["an empty answer", { answer: "" }],
    ["an answer over 3000 characters", { answer: "x".repeat(3001) }],
    ["a score over 100", { overall: 101 }],
    ["feedback that is not an object", { feedback: "[]" }],
    ["a question that is not an object", { question: "[]" }],
  ])("rejects %s", async (_n, over) => {
    const s = (await session(alice)).rows[0]!.id;
    expect(await errorOf(() => answer(alice, s, 0, over))).toMatch(/check constraint|violates/i);
  });

  it("finishes only when every question is answered, with the true average", async () => {
    const s = (await session(alice)).rows[0]!.id;
    await answer(alice, s, 0, { overall: 60 });
    expect(await errorOf(() => finish(alice, s, 60))).toMatch(/answer every question/);
    await answer(alice, s, 1, { overall: 70 });
    await answer(alice, s, 2, { overall: 90 });
    expect(await errorOf(() => finish(alice, s, 100))).toMatch(/average of the answers/);
    expect((await finish(alice, s, 73)).rows).toHaveLength(1);
  });

  it("is final once finished: no more answers, no changes, and answers can never be edited", async () => {
    const s = (await session(alice, { question_count: 3 })).rows[0]!.id;
    for (let i = 0; i < 3; i++) await answer(alice, s, i);
    await finish(alice, s, 80);
    expect(await errorOf(() => finish(alice, s, 80))).toMatch(/finished sessions cannot change/);
    expect(await errorOf(() => answer(alice, s, 3))).toMatch(/not open|in order/);
    for (const sql of [
      "update public.mock_answers set answer = 'changed'",
      "delete from public.mock_answers",
    ]) {
      expect(
        await errorOf(() =>
          as(db, "authenticated", alice, () => db.query(`${sql} where session_id = $1`, [s])),
        ),
        sql,
      ).toMatch(/permission denied/i);
    }
    expect(
      await errorOf(() =>
        as(db, "service_role", null, () =>
          db.query("update public.mock_answers set answer = 'changed' where session_id = $1", [s]),
        ),
      ),
    ).toMatch(/cannot be changed/);
  });

  it("does not let a person edit what was asked or who owns it", async () => {
    const s = (await session(alice)).rows[0]!.id;
    for (const [col, value] of [
      ["questions", "'[]'"],
      ["focus", "'final'"],
      ["user_id", `'${bob}'`],
      ["job_title", "'x'"],
    ]) {
      expect(
        await errorOf(() =>
          as(db, "authenticated", alice, () =>
            db.query(`update public.mock_sessions set ${col} = ${value} where id = $1`, [s]),
          ),
        ),
        col,
      ).toMatch(/permission denied/i);
    }
  });

  it("keeps a session when its job is deleted, and removes answers with the session", async () => {
    const jobId = (
      await as(db, "authenticated", alice, () =>
        db.query<{ id: string }>(
          `insert into public.jobs (owner_user_id, company_name, source_key, fingerprint, title, description)
           values ($1, 'Orbit', 'manual', $2, 'Temp', 'x') returning id`,
          [alice, hash()],
        ),
      )
    ).rows[0]!.id;
    const s = (await session(alice, { job_id: jobId, job_title: "Temp" })).rows[0]!.id;
    await answer(alice, s, 0);
    await as(db, "authenticated", alice, () =>
      db.query("delete from public.jobs where id = $1", [jobId]),
    );
    expect(
      (
        await db.query<{ job_id: string | null }>(
          "select job_id from public.mock_sessions where id = $1",
          [s],
        )
      ).rows[0],
    ).toEqual({ job_id: null });
    await as(db, "authenticated", alice, () =>
      db.query("delete from public.mock_sessions where id = $1", [s]),
    );
    expect(
      (await db.query("select 1 from public.mock_answers where session_id = $1", [s])).rows,
    ).toHaveLength(0);
  });

  it("stops each user at 200 sessions", async () => {
    const dan = await createUser(db);
    await db.query(
      `insert into public.mock_sessions (user_id, job_title, company_name, focus, question_count, questions)
       select $1, 'R', 'C', 'technical', 3, $2::jsonb from generate_series(1, 200)`,
      [dan, questions(3)],
    );
    expect(await errorOf(() => session(dan, { job_id: null }))).toMatch(
      /practice session limit reached/,
    );
  }, 60_000);
});
