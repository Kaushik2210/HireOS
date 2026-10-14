// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./helpers";

// Whole-schema checks on the access rules. The per-table tests prove behaviour; these keep a
// new table or function from quietly skipping the rules the rest of the schema follows.

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

const rows = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;

// Tables that no API role may touch at all: they are reached only through service-role code
// or a security definer function.
const SERVICE_ONLY = new Set(["rate_limits"]);

describe("every table in public", () => {
  it("has Row Level Security on and forced for no one but the owner role", async () => {
    const off = await rows<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity`,
    );
    expect(off).toEqual([]);
  });

  it("is either closed to API roles or has a policy for every privilege it grants", async () => {
    const tables = (
      await rows<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
      )
    ).map((t) => t.table_name);

    const grants = await rows<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'`,
    );
    const policies = await rows<{ tablename: string; cmd: string }>(
      "select tablename, cmd from pg_policies where schemaname = 'public'",
    );

    const gaps: string[] = [];
    for (const table of tables) {
      const granted = new Set(
        grants.filter((g) => g.table_name === table).map((g) => g.privilege_type),
      );
      if (SERVICE_ONLY.has(table)) {
        if (granted.size > 0) gaps.push(`${table}: service-only table grants ${[...granted]}`);
        continue;
      }
      const cmds = policies.filter((p) => p.tablename === table).map((p) => p.cmd);
      const covers = (priv: string) => cmds.includes(priv) || cmds.includes("ALL");
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        // A grant with no policy is dead (RLS denies it), but it signals a rule that was meant
        // to exist and does not.
        if (granted.has(priv) && !covers(priv)) gaps.push(`${table}: ${priv} granted, no policy`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it("never lets a signed-in user write through a policy that is simply true", async () => {
    const open = await rows<{ tablename: string; policyname: string; cmd: string }>(
      `select tablename, policyname, cmd from pg_policies
        where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
          and (qual is null or qual = 'true') and (with_check is null or with_check = 'true')`,
    );
    expect(open).toEqual([]);
  });

  it("limits reads that are open to everyone to the shared catalogue", async () => {
    const open = await rows<{ tablename: string }>(
      `select tablename from pg_policies
        where schemaname = 'public' and cmd = 'SELECT' and qual = 'true'`,
    );
    const names = open.map((o) => o.tablename).sort();
    // Sources, companies and the table of allowed status moves are shared reference data.
    // Nothing personal belongs here.
    expect(
      names.every((n) => ["job_sources", "companies", "application_transitions"].includes(n)),
    ).toBe(true);
  });

  it("gives the anonymous role nothing, on tables and sequences alike", async () => {
    expect(
      await rows(
        "select * from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'",
      ),
    ).toEqual([]);
    expect(
      await rows(
        "select * from information_schema.role_usage_grants where object_schema = 'public' and grantee = 'anon' and object_type = 'SEQUENCE'",
      ),
    ).toEqual([]);
  });
});

describe("every function in public", () => {
  const functions = () =>
    rows<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      args: string;
      anon: boolean;
      authenticated: boolean;
      public_exec: boolean;
      ret: string;
    }>(
      `select p.proname, p.prosecdef, p.proconfig, p.prorettype::regtype::text as ret,
              pg_get_function_identity_arguments(p.oid) as args,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              (select bool_or(a.grantee = 0) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.privilege_type = 'EXECUTE') as public_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    );

  it("pins the search path when it runs with its owner's rights", async () => {
    const loose = (await functions())
      .filter((f) => f.prosecdef)
      .filter((f) => !(f.proconfig ?? []).some((c) => c.startsWith("search_path=")))
      .map((f) => f.proname);
    expect(loose).toEqual([]);
  });

  it("is not callable by the anonymous role", async () => {
    // Trigger functions cannot be called directly (Postgres refuses), so they are left out.
    const callable = (await functions())
      .filter((f) => f.ret !== "trigger" && f.anon)
      .map((f) => f.proname);
    expect(callable).toEqual([]);
  });

  it("keeps privileged helpers away from signed-in users unless they are meant for them", async () => {
    // These run with elevated rights and are deliberately callable by signed-in users: each
    // only answers questions about the caller's own data.
    const MEANT_FOR_USERS = new Set([
      "owns_document_version",
      "change_application_status",
      "add_application_event",
      "search_jobs",
    ]);
    const exposed = (await functions())
      .filter((f) => f.ret !== "trigger")
      .filter((f) => f.prosecdef && f.authenticated && !MEANT_FOR_USERS.has(f.proname))
      .map((f) => f.proname);
    expect(exposed).toEqual([]);
  });
});
