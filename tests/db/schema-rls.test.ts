// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createUser, errorOf, migrationFiles } from "./helpers";

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("migrations on a fresh database", () => {
  it("apply cleanly and in a stable order", async () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    expect([...files].sort()).toEqual(files);

    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(["users", "audit_logs"]));
  });

  it("enable Row Level Security on every table in public", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("give anon no access to any public table", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(rows).toEqual([]);
  });
});

describe("public.users", () => {
  it("is created automatically when an auth user is created", async () => {
    const id = await createUser(db);
    const { rows } = await db.query("select id from public.users where id = $1", [id]);
    expect(rows).toHaveLength(1);
  });

  it("lets a user read only their own row", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const rows = await as(db, "authenticated", a, async () =>
      (await db.query<{ id: string }>("select id from public.users")).rows.map((r) => r.id),
    );
    expect(rows).toContain(a);
    expect(rows).not.toContain(b);
  });

  it("lets a user update their own profile fields", async () => {
    const a = await createUser(db);
    await as(db, "authenticated", a, () =>
      db.query("update public.users set display_name = 'Asha' where id = $1", [a]),
    );
    const { rows } = await db.query<{ display_name: string; updated_at: Date; created_at: Date }>(
      "select display_name, updated_at, created_at from public.users where id = $1",
      [a],
    );
    expect(rows[0]?.display_name).toBe("Asha");
    expect(rows[0]!.updated_at.getTime()).toBeGreaterThan(rows[0]!.created_at.getTime());
  });

  it("does not let a user update another user's row (zero rows affected)", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const result = await as(db, "authenticated", a, () =>
      db.query("update public.users set display_name = 'hijacked' where id = $1", [b]),
    );
    expect(result.affectedRows).toBe(0);
    const { rows } = await db.query<{ display_name: string | null }>(
      "select display_name from public.users where id = $1",
      [b],
    );
    expect(rows[0]?.display_name).toBeNull();
  });

  it("blocks changing id or is_demo (column-level grants)", async () => {
    const a = await createUser(db);
    const other = await createUser(db);
    const idErr = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query("update public.users set id = $2 where id = $1", [a, other]),
      ),
    );
    const demoErr = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query("update public.users set is_demo = true where id = $1", [a]),
      ),
    );
    expect(idErr).toMatch(/permission denied/i);
    expect(demoErr).toMatch(/permission denied/i);
  });

  it("blocks users from inserting or deleting rows", async () => {
    const a = await createUser(db);
    const insertErr = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query("insert into public.users (id) values (gen_random_uuid())"),
      ),
    );
    const deleteErr = await errorOf(() =>
      as(db, "authenticated", a, () => db.query("delete from public.users where id = $1", [a])),
    );
    expect(insertErr).toMatch(/permission denied/i);
    expect(deleteErr).toMatch(/permission denied/i);
  });

  it("denies anon entirely", async () => {
    const err = await errorOf(() =>
      as(db, "anon", null, () => db.query("select * from public.users")),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("returns nothing when there is no signed-in user id", async () => {
    await createUser(db);
    const rows = await as(
      db,
      "authenticated",
      null,
      async () => (await db.query("select id from public.users")).rows,
    );
    expect(rows).toEqual([]);
  });

  it("is removed when the auth user is deleted", async () => {
    const id = await createUser(db);
    await db.query("delete from auth.users where id = $1", [id]);
    const { rows } = await db.query("select id from public.users where id = $1", [id]);
    expect(rows).toHaveLength(0);
  });

  it("rejects non-object settings", async () => {
    const id = await createUser(db);
    const err = await errorOf(() =>
      db.query(`update public.users set settings = '[]'::jsonb where id = $1`, [id]),
    );
    expect(err).toMatch(/check constraint/i);
  });
});

describe("public.audit_logs", () => {
  async function seed(userId: string | null, action = "auth.sign_in") {
    await as(db, "service_role", null, () =>
      db.query("insert into public.audit_logs (user_id, action) values ($1, $2)", [userId, action]),
    );
  }

  it("lets the service role append and users read only their own trail", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    await seed(a, "auth.sign_in");
    await seed(b, "auth.sign_out");

    const rows = await as(
      db,
      "authenticated",
      a,
      async () =>
        (await db.query<{ user_id: string }>("select user_id from public.audit_logs")).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === a)).toBe(true);
  });

  it("does not let signed-in users write", async () => {
    const a = await createUser(db);
    const err = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query("insert into public.audit_logs (user_id, action) values ($1, 'forged')", [a]),
      ),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("denies anon entirely", async () => {
    const err = await errorOf(() =>
      as(db, "anon", null, () => db.query("select * from public.audit_logs")),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("is append-only even for the service role and the table owner", async () => {
    const a = await createUser(db);
    await seed(a, "auth.sign_in");

    const updateErr = await errorOf(() =>
      as(db, "service_role", null, () =>
        db.query("update public.audit_logs set action = 'tampered' where user_id = $1", [a]),
      ),
    );
    const deleteErr = await errorOf(() =>
      db.query("delete from public.audit_logs where user_id = $1", [a]),
    );
    expect(updateErr).toMatch(/permission denied|append-only/i);
    expect(deleteErr).toMatch(/append-only/i);
  });

  it("keeps rows, detached from the user, when an account is deleted", async () => {
    const a = await createUser(db);
    await seed(a, "auth.sign_in");
    await db.query("delete from auth.users where id = $1", [a]);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.audit_logs where action = 'auth.sign_in' and user_id is null",
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });

  it("rejects an empty action and non-object metadata", async () => {
    const emptyAction = await errorOf(() =>
      db.query("insert into public.audit_logs (action) values ('')"),
    );
    const badMetadata = await errorOf(() =>
      db.query(`insert into public.audit_logs (action, metadata) values ('x', '[1]'::jsonb)`),
    );
    expect(emptyAction).toMatch(/check constraint/i);
    expect(badMetadata).toMatch(/check constraint/i);
  });
});
