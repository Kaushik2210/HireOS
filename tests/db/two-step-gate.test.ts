// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createUser, errorOf } from "./helpers";

// The second step, enforced by the database: an account with a confirmed authenticator gets
// nothing from a first-level token, whichever way it asks (this is what stops someone who
// holds only the password from querying Supabase directly).

let db: PGlite;
let guarded: string; // has a confirmed authenticator
let plain: string; // has none
let half: string; // started setting one up, never confirmed

const factor = (userId: string, status: "verified" | "unverified", type = "totp") =>
  db.query("insert into auth.mfa_factors (user_id, factor_type, status) values ($1, $2, $3)", [
    userId,
    type,
    status,
  ]);

beforeAll(async () => {
  db = await createDb();
  guarded = await createUser(db);
  plain = await createUser(db);
  half = await createUser(db);
  await factor(guarded, "verified");
  await factor(half, "unverified");
  for (const id of [guarded, plain, half]) {
    await db.query("insert into public.profiles (user_id, full_name) values ($1, 'Test Person')", [
      id,
    ]);
  }
}, 90_000);

afterAll(async () => {
  await db.close();
});

const rowsOf = (userId: string, aal: "aal1" | "aal2", sql: string) =>
  as(db, "authenticated", userId, async () => (await db.query(sql)).rows, { aal });

describe("an account with a confirmed authenticator", () => {
  it("sees nothing at the first level, in any gated table it owns rows in", async () => {
    expect(await rowsOf(guarded, "aal1", "select id from public.users")).toEqual([]);
    expect(await rowsOf(guarded, "aal1", "select user_id from public.profiles")).toEqual([]);
  });

  it("sees its own data once the session has proved the second step", async () => {
    expect(await rowsOf(guarded, "aal2", "select id from public.users")).toHaveLength(1);
    expect(await rowsOf(guarded, "aal2", "select user_id from public.profiles")).toHaveLength(1);
  });

  it("cannot write at the first level, and a refused change leaves the row alone", async () => {
    const insert = await errorOf(() =>
      as(
        db,
        "authenticated",
        guarded,
        () =>
          db.query(
            "insert into public.career_goals (user_id, target_roles, target_level) values ($1, '{}', 'entry')",
            [guarded],
          ),
        { aal: "aal1" },
      ),
    );
    expect(insert).toMatch(/row-level security/i);

    const update = await as(
      db,
      "authenticated",
      guarded,
      () =>
        db.query("update public.profiles set full_name = 'Changed' where user_id = $1", [guarded]),
      { aal: "aal1" },
    );
    expect(update.affectedRows).toBe(0);
    const after = (
      await db.query<{ full_name: string }>(
        "select full_name from public.profiles where user_id = $1",
        [guarded],
      )
    ).rows[0]!;
    expect(after.full_name).toBe("Test Person");

    const del = await as(
      db,
      "authenticated",
      guarded,
      () => db.query("delete from public.profiles where user_id = $1", [guarded]),
      { aal: "aal1" },
    );
    expect(del.affectedRows).toBe(0);
  });

  it("can write once the second step has been proved", async () => {
    const result = await as(
      db,
      "authenticated",
      guarded,
      () => db.query("update public.profiles set headline = 'Hello' where user_id = $1", [guarded]),
      { aal: "aal2" },
    );
    expect(result.affectedRows).toBe(1);
  });

  it("cannot use the two functions that skip row level security at the first level", async () => {
    // A real application row, made by the service role.
    const app = (
      await db.query<{ id: string }>(
        `insert into public.applications (user_id, job_title, company_name, status)
         values ($1, 'Engineer', 'Acme', 'shortlisted') returning id`,
        [guarded],
      )
    ).rows[0]!.id;

    const call = (aal: "aal1" | "aal2", sql: string, params: unknown[]) =>
      errorOf(() => as(db, "authenticated", guarded, () => db.query(sql, params), { aal }));

    expect(
      await call("aal1", "select public.change_application_status($1, 'applied')", [app]),
    ).toMatch(/second step required/);
    expect(
      await call("aal1", "select public.add_application_event($1, 'note', 'hello')", [app]),
    ).toMatch(/second step required/);

    expect(
      await call("aal2", "select public.change_application_status($1, 'applied')", [app]),
    ).toBeNull();
    expect(
      await call("aal2", "select public.add_application_event($1, 'note', 'hello')", [app]),
    ).toBeNull();
  });

  it("is shut out of its private resume files at the first level", async () => {
    const path = `${guarded}/${randomUUID()}.pdf`;
    const insert = (aal: "aal1" | "aal2") =>
      errorOf(() =>
        as(
          db,
          "authenticated",
          guarded,
          () =>
            db.query(
              "insert into storage.objects (bucket_id, name, owner) values ('resumes', $1, $2)",
              [path, guarded],
            ),
          { aal },
        ),
      );
    expect(await insert("aal1")).toMatch(/row-level security/i);
    expect(await insert("aal2")).toBeNull();

    const listed = (aal: "aal1" | "aal2") =>
      rowsOf(guarded, aal, "select name from storage.objects where bucket_id = 'resumes'");
    expect(await listed("aal1")).toEqual([]);
    expect(await listed("aal2")).toHaveLength(1);
  });
});

describe("everyone else", () => {
  it("is not affected: no authenticator, or one that was never confirmed", async () => {
    for (const id of [plain, half]) {
      expect(await rowsOf(id, "aal1", "select id from public.users")).toHaveLength(1);
      expect(await rowsOf(id, "aal1", "select user_id from public.profiles")).toHaveLength(1);
    }
  });

  it("is not affected when the authenticator is a different kind of factor", async () => {
    const phoneOnly = await createUser(db);
    await factor(phoneOnly, "verified", "phone");
    expect(await rowsOf(phoneOnly, "aal1", "select id from public.users")).toHaveLength(1);
  });

  it("cannot read the guarded account's rows at any level", async () => {
    for (const aal of ["aal1", "aal2"] as const) {
      expect(
        await rowsOf(
          plain,
          aal,
          `select user_id from public.profiles where user_id = '${guarded}'`,
        ),
      ).toEqual([]);
    }
  });

  it("includes the service role, which is not an end user", async () => {
    const rows = (await db.query("select user_id from public.profiles")).rows;
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the gate itself", () => {
  const protectedTables = async () =>
    (
      await db.query<{ table_name: string }>(
        `select distinct c.table_name
           from information_schema.columns c
           join information_schema.tables t
             on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
            and c.column_name in ('user_id', 'owner_user_id')`,
      )
    ).rows.map((r) => r.table_name);

  it("covers every table that holds a person's data, so a new one cannot skip it", async () => {
    const gated = new Set(
      (
        await db.query<{ tablename: string }>(
          "select tablename from pg_policies where schemaname = 'public' and policyname = 'two_step_gate' and permissive = 'RESTRICTIVE'",
        )
      ).rows.map((r) => r.tablename),
    );
    // Shared reference data and the API-closed counters hold nothing personal.
    const EXEMPT = new Set(["rate_limits"]);
    const missing = (await protectedTables()).filter((t) => !gated.has(t) && !EXEMPT.has(t));
    expect(missing).toEqual([]);
  });

  it("answers false only for the one case it is for", async () => {
    const ask = (userId: string | null, aal: "aal1" | "aal2") =>
      as(
        db,
        "authenticated",
        userId,
        async () =>
          (await db.query<{ ok: boolean }>("select public.second_step_satisfied() as ok")).rows[0]!
            .ok,
        { aal },
      );
    expect(await ask(guarded, "aal1")).toBe(false);
    expect(await ask(guarded, "aal2")).toBe(true);
    expect(await ask(plain, "aal1")).toBe(true);
    expect(await ask(half, "aal1")).toBe(true);
  });

  it("is not callable by the anonymous role", async () => {
    const error = await errorOf(() =>
      as(db, "anon", null, () => db.query("select public.second_step_satisfied()")),
    );
    expect(error).toMatch(/permission denied/);
  });
});
