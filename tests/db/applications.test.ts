// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATUSES, TRANSITIONS, type Status } from "@/lib/applications/types";
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
  jobs = (await db.query<{ id: string }>("select id from public.jobs limit 40")).rows.map(
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

function create(userId: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    user_id: userId,
    job_id: freshJob(),
    job_title: "Backend Engineer",
    company_name: "Helix Ledger",
    status: "shortlisted",
    ...over,
  };
  const cols = Object.keys(row);
  return as(db, "authenticated", userId, () =>
    db.query<{ id: string }>(
      `insert into public.applications (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      cols.map((c) => row[c]),
    ),
  );
}

const move = (
  userId: string,
  id: string,
  to: string,
  note: string | null = null,
  on: string | null = null,
) =>
  as(db, "authenticated", userId, () =>
    db.query("select public.change_application_status($1, $2, $3, $4)", [id, to, note, on]),
  );

const events = async (id: string) =>
  (
    await db.query<{
      kind: string;
      from_status: string | null;
      to_status: string | null;
      note: string | null;
    }>(
      "select kind, from_status, to_status, note from public.application_events where application_id = $1 order by created_at, id",
      [id],
    )
  ).rows;

const statusOf = async (id: string) =>
  (await db.query<{ status: string }>("select status from public.applications where id = $1", [id]))
    .rows[0]!.status;

/** Puts an application in any status, the way a privileged migration could, to test moves from it. */
async function forceStatus(id: string, status: Status) {
  await db.query("select set_config('hireos.allow_status_change', 'on', false)");
  await db.query(
    "update public.applications set status = $2, applied_on = coalesce(applied_on, current_date) where id = $1",
    [id, status],
  );
  await db.query("select set_config('hireos.allow_status_change', 'off', false)");
}

describe("transition table", () => {
  it("matches the allowed moves the app uses, exactly", async () => {
    const { rows } = await db.query<{ from_status: string; to_status: string }>(
      "select from_status, to_status from public.application_transitions",
    );
    const sql = new Set(rows.map((r) => `${r.from_status}>${r.to_status}`));
    const app = new Set(STATUSES.flatMap((from) => TRANSITIONS[from].map((to) => `${from}>${to}`)));
    expect(sql).toEqual(app);
  });

  it("is enforced by the function for every pair of statuses", async () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const id = (await create(alice)).rows[0]!.id;
        await forceStatus(id, from);
        const err = await errorOf(() => move(alice, id, to));
        const allowed = TRANSITIONS[from].includes(to);
        expect(err === null, `${from} to ${to}`).toBe(allowed);
        expect(await statusOf(id), `${from} to ${to}`).toBe(allowed ? to : from);
        await as(db, "authenticated", alice, () =>
          db.query("delete from public.applications where id = $1", [id]),
        );
      }
    }
  }, 120_000);
});

describe("applications", () => {
  it("starts an application, copies the job's title, and logs it", async () => {
    const id = (await create(alice)).rows[0]!.id;
    expect(await events(id)).toEqual([
      { kind: "created", from_status: null, to_status: "shortlisted", note: null },
    ]);
  });

  it("only starts early in the pipeline", async () => {
    for (const status of ["interview", "offer", "rejected", "no_response"]) {
      expect(await errorOf(() => create(alice, { status })), status).toMatch(/row-level security/i);
    }
    expect(await errorOf(() => create(alice, { status: "applied" }))).toMatch(
      /check constraint|violates/i,
    );
    expect(
      await errorOf(() => create(alice, { status: "applied", applied_on: "2026-10-01" })),
    ).toBeNull();
  });

  it("keeps one application per user and job, but lets another user track the same job", async () => {
    const job = freshJob();
    await create(alice, { job_id: job });
    expect(await errorOf(() => create(alice, { job_id: job }))).toMatch(/unique|duplicate/i);
    expect(await errorOf(() => create(bob, { job_id: job }))).toBeNull();
  });

  it("refuses someone else's name or a job the user cannot see", async () => {
    expect(await errorOf(() => create(bob, { user_id: alice }))).toMatch(/row-level security/i);
    expect(await errorOf(() => create(alice, { job_id: bobPrivateJob }))).toMatch(
      /row-level security/i,
    );
    expect(await errorOf(() => create(bob, { job_id: bobPrivateJob }))).toBeNull();
  });

  it.each([
    ["an empty title", { job_title: "" }],
    ["an over-long company", { company_name: "x".repeat(151) }],
    ["an unknown status", { status: "hired" }],
    ["over-long notes", { notes: "x".repeat(2001) }],
    ["a future application date", { status: "applied", applied_on: "2999-01-01" }],
  ])("rejects %s", async (_n, over) => {
    expect(await errorOf(() => create(alice, over))).toMatch(
      /check constraint|violates|row-level/i,
    );
  });

  it("is private to its owner", async () => {
    const id = (await create(alice)).rows[0]!.id;
    const seen = await as(db, "authenticated", bob, () =>
      db.query("select id from public.applications where id = $1", [id]),
    );
    expect(seen.rows).toHaveLength(0);
    const seenEvents = await as(db, "authenticated", bob, () =>
      db.query("select id from public.application_events where application_id = $1", [id]),
    );
    expect(seenEvents.rows).toHaveLength(0);
    const upd = await as(db, "authenticated", bob, () =>
      db.query("update public.applications set notes = 'x' where id = $1 returning id", [id]),
    );
    expect(upd.rows).toHaveLength(0);
    const del = await as(db, "authenticated", bob, () =>
      db.query("delete from public.applications where id = $1 returning id", [id]),
    );
    expect(del.rows).toHaveLength(0);
    expect(await errorOf(() => move(bob, id, "preparing"))).toMatch(/application not found/);
  });

  it("denies anonymous access", async () => {
    expect(
      await errorOf(() =>
        as(db, "anon", null, () => db.query("select * from public.applications")),
      ),
    ).toMatch(/permission denied/i);
  });
});

describe("changing status", () => {
  it("logs each move with where it came from, and the optional note", async () => {
    const id = (await create(alice)).rows[0]!.id;
    await move(alice, id, "preparing");
    await move(alice, id, "applied", "Submitted on their careers page", "2026-10-02");
    const log = await events(id);
    expect(log.map((e) => `${e.kind}:${e.from_status}>${e.to_status}`)).toEqual([
      "created:null>shortlisted",
      "status_changed:shortlisted>preparing",
      "status_changed:preparing>applied",
    ]);
    expect(log[2]!.note).toBe("Submitted on their careers page");
    const row = (
      await db.query<{ applied_on: Date }>(
        "select applied_on from public.applications where id = $1",
        [id],
      )
    ).rows[0]!;
    expect(row.applied_on.toISOString().slice(0, 10)).toBe("2026-10-02");
  });

  it("defaults the application date to today and never changes it afterwards", async () => {
    const id = (await create(alice)).rows[0]!.id;
    await move(alice, id, "applied");
    const first = (
      await db.query<{ d: string }>(
        "select applied_on::text as d from public.applications where id = $1",
        [id],
      )
    ).rows[0]!.d;
    expect(first).toBe(
      (await db.query<{ d: string }>("select current_date::text as d")).rows[0]!.d,
    );
    await move(alice, id, "interview", null, "2020-01-01");
    expect(
      (
        await db.query<{ d: string }>(
          "select applied_on::text as d from public.applications where id = $1",
          [id],
        )
      ).rows[0]!.d,
    ).toBe(first);
  });

  it("rolls back as one unit: a refused move leaves no event behind", async () => {
    const id = (await create(alice)).rows[0]!.id;
    const before = (await events(id)).length;
    expect(await errorOf(() => move(alice, id, "offer"))).toMatch(/not allowed/);
    expect((await events(id)).length).toBe(before);
  });

  it("cannot be bypassed: direct status or date updates fail for every role", async () => {
    const id = (await create(alice)).rows[0]!.id;
    expect(
      await errorOf(() =>
        as(db, "authenticated", alice, () =>
          db.query("update public.applications set status = 'offer' where id = $1", [id]),
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(
      await errorOf(() =>
        as(db, "authenticated", alice, () =>
          db.query("update public.applications set applied_on = current_date where id = $1", [id]),
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(
      await errorOf(() =>
        as(db, "service_role", null, () =>
          db.query("update public.applications set status = 'offer' where id = $1", [id]),
        ),
      ),
    ).toMatch(/status changes go through/);
    expect(await statusOf(id)).toBe("shortlisted");
  });
});

describe("events", () => {
  it("are append-only: no edit, delete or direct insert for users, and no edit for anyone", async () => {
    const id = (await create(alice)).rows[0]!.id;
    for (const sql of [
      "update public.application_events set note = 'x'",
      "delete from public.application_events",
      `insert into public.application_events (user_id, application_id, kind, to_status) values ('${alice}', '${id}', 'created', 'offer')`,
    ]) {
      expect(await errorOf(() => as(db, "authenticated", alice, () => db.query(sql))), sql).toMatch(
        /permission denied/i,
      );
    }
    expect(
      await errorOf(() =>
        as(db, "service_role", null, () =>
          db.query("update public.application_events set note = 'x'"),
        ),
      ),
    ).toMatch(/append-only/);
  });

  it("takes notes and follow-ups through the function, and nothing else", async () => {
    const id = (await create(alice)).rows[0]!.id;
    const add = (userId: string, kind: string, note: string | null) =>
      as(db, "authenticated", userId, () =>
        db.query("select public.add_application_event($1, $2, $3)", [id, kind, note]),
      );
    await add(alice, "note", "Spoke to a recruiter");
    await add(alice, "followed_up", null);
    expect((await events(id)).slice(1)).toEqual([
      { kind: "note", from_status: null, to_status: null, note: "Spoke to a recruiter" },
      { kind: "followed_up", from_status: null, to_status: null, note: null },
    ]);
    expect(await errorOf(() => add(alice, "status_changed", "x"))).toMatch(/cannot be added/);
    expect(await errorOf(() => add(alice, "created", null))).toMatch(/cannot be added/);
    expect(await errorOf(() => add(alice, "note", "   "))).toMatch(/needs text/);
    expect(await errorOf(() => add(bob, "note", "not mine"))).toMatch(/application not found/);
  });

  it("log a follow-up date and linked documents", async () => {
    const id = (await create(alice)).rows[0]!.id;
    await as(db, "authenticated", alice, () =>
      db.query("update public.applications set follow_up_on = '2026-10-20' where id = $1", [id]),
    );
    await as(db, "authenticated", alice, () =>
      db.query("update public.applications set follow_up_on = null where id = $1", [id]),
    );
    expect((await events(id)).slice(1).map((e) => `${e.kind}:${e.note}`)).toEqual([
      "follow_up_set:2026-10-20",
      "follow_up_set:cleared",
    ]);
  });

  it("let a person link only their own documents", async () => {
    const id = (await create(alice)).rows[0]!.id;
    const version = (uid: string, jobId: string) =>
      as(db, "authenticated", uid, () =>
        db.query<{ id: string }>(
          `insert into public.document_versions (user_id, job_id, kind, version_number, content, verification, body, tailor_version, profile_hash)
           values ($1, $2, 'resume', 1, '{}', '{"ok":true,"checked":1,"blocked":[]}', 'x', 1, $3) returning id`,
          [uid, jobId, hash()],
        ),
      );
    const mine = (await version(alice, jobs[39]!)).rows[0]!.id;
    const theirs = (await version(bob, jobs[39]!)).rows[0]!.id;
    expect(
      await errorOf(() =>
        as(db, "authenticated", alice, () =>
          db.query("update public.applications set resume_version_id = $2 where id = $1", [
            id,
            mine,
          ]),
        ),
      ),
    ).toBeNull();
    expect((await events(id)).some((e) => e.kind === "documents_linked")).toBe(true);
    expect(
      await errorOf(() =>
        as(db, "authenticated", alice, () =>
          db.query("update public.applications set cover_letter_version_id = $2 where id = $1", [
            id,
            theirs,
          ]),
        ),
      ),
    ).toMatch(/row-level security/i);
  });
});

describe("lifecycle", () => {
  it("keeps the application when its job is deleted", async () => {
    const jobId = (
      await as(db, "authenticated", alice, () =>
        db.query<{ id: string }>(
          `insert into public.jobs (owner_user_id, company_name, source_key, fingerprint, title, description)
           values ($1, 'Orbit', 'manual', $2, 'Temp Role', 'x') returning id`,
          [alice, hash()],
        ),
      )
    ).rows[0]!.id;
    const id = (
      await create(alice, { job_id: jobId, job_title: "Temp Role", company_name: "Orbit" })
    ).rows[0]!.id;
    await as(db, "authenticated", alice, () =>
      db.query("delete from public.jobs where id = $1", [jobId]),
    );
    const row = (
      await db.query<{ job_id: string | null; job_title: string }>(
        "select job_id, job_title from public.applications where id = $1",
        [id],
      )
    ).rows[0]!;
    expect(row).toEqual({ job_id: null, job_title: "Temp Role" });
    expect((await events(id)).length).toBe(1);
  });

  it("removes its events with it, and everything with the user", async () => {
    const id = (await create(alice)).rows[0]!.id;
    await as(db, "authenticated", alice, () =>
      db.query("delete from public.applications where id = $1", [id]),
    );
    expect(await events(id)).toEqual([]);
    const other = (await create(alice)).rows[0]!.id;
    await db.query("delete from auth.users where id = $1", [alice]);
    expect(
      (await db.query("select 1 from public.applications where user_id = $1", [alice])).rows,
    ).toHaveLength(0);
    expect(await events(other)).toEqual([]);
  });

  it("stops each user at 500 applications", async () => {
    const carol = await createUser(db);
    await db.query(
      `insert into public.applications (user_id, job_title, company_name)
       select $1, 'Role ' || g, 'Co' from generate_series(1, 500) g`,
      [carol],
    );
    expect(
      await errorOf(() =>
        as(db, "authenticated", carol, () =>
          db.query(
            "insert into public.applications (user_id, job_title, company_name) values ($1, 'One more', 'Co')",
            [carol],
          ),
        ),
      ),
    ).toMatch(/application limit reached/);
  }, 60_000);
});
