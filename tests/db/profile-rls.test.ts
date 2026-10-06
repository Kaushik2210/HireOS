// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createUser, errorOf } from "./helpers";

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** Minimal valid insert (columns after user_id) for every profile table. */
const MINIMAL: Record<string, { columns: string; values: string; editColumn: string }> = {
  profiles: { columns: "full_name", values: "'Asha Raman'", editColumn: "headline" },
  career_goals: {
    columns: "target_roles",
    values: "array['Backend Engineer']",
    editColumn: "statement",
  },
  education: { columns: "institution, degree", values: "'NIT', 'MCA'", editColumn: "grade" },
  experiences: {
    columns: "kind, organization, title",
    values: "'work', 'Acme', 'Intern'",
    editColumn: "location",
  },
  projects: { columns: "name", values: "'HireOS'", editColumn: "role" },
  certifications: { columns: "name", values: "'AWS CCP'", editColumn: "issuer" },
  skills: {
    columns: "name, type, level",
    values: "'Docker', 'cloud_devops', 'beginner'",
    editColumn: "years",
  },
  achievements: {
    columns: "title, category",
    values: "'Winner', 'award'",
    editColumn: "description",
  },
};
const TABLES = Object.keys(MINIMAL);

async function insertAs(userId: string, table: string, extraCols = "", extraVals = "") {
  const m = MINIMAL[table]!;
  return as(db, "authenticated", userId, () =>
    db.query<{ id: string }>(
      `insert into public.${table} (user_id, ${m.columns}${extraCols}) values ($1, ${m.values}${extraVals}) returning id`,
      [userId],
    ),
  );
}

describe.each(TABLES)("public.%s", (table) => {
  it("lets a user create and read their own row", async () => {
    const a = await createUser(db);
    const created = await insertAs(a, table);
    expect(created.rows).toHaveLength(1);
    const rows = await as(
      db,
      "authenticated",
      a,
      async () => (await db.query<{ id: string }>(`select id from public.${table}`)).rows,
    );
    expect(rows.map((r) => r.id)).toContain(created.rows[0]!.id);
  });

  it("hides one user's rows from another", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const mine = await insertAs(a, table);
    const seenByB = await as(
      db,
      "authenticated",
      b,
      async () => (await db.query<{ id: string }>(`select id from public.${table}`)).rows,
    );
    expect(seenByB.map((r) => r.id)).not.toContain(mine.rows[0]!.id);
  });

  it("blocks writing a row owned by someone else", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const m = MINIMAL[table]!;
    const err = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query(`insert into public.${table} (user_id, ${m.columns}) values ($1, ${m.values})`, [
          b,
        ]),
      ),
    );
    expect(err).toMatch(/row-level security/i);
  });

  it("does not let a user update or delete another user's row", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const theirs = await insertAs(b, table);
    const id = theirs.rows[0]!.id;
    const m = MINIMAL[table]!;
    const value = m.editColumn === "years" ? "5" : "'hijacked'";

    const updated = await as(db, "authenticated", a, () =>
      db.query(`update public.${table} set ${m.editColumn} = ${value} where id = $1`, [id]),
    );
    const deleted = await as(db, "authenticated", a, () =>
      db.query(`delete from public.${table} where id = $1`, [id]),
    );
    expect(updated.affectedRows).toBe(0);
    expect(deleted.affectedRows).toBe(0);
    const { rows } = await db.query(`select id from public.${table} where id = $1`, [id]);
    expect(rows).toHaveLength(1);
  });

  it("does not let a user reassign a row to another user", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const mine = await insertAs(a, table);
    const err = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query(`update public.${table} set user_id = $2 where id = $1`, [mine.rows[0]!.id, b]),
      ),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("does not let a user set is_demo", async () => {
    const a = await createUser(db);
    const err = await errorOf(() => insertAs(a, table, ", is_demo", ", true"));
    expect(err).toMatch(/permission denied/i);
  });

  it("denies anon entirely", async () => {
    const err = await errorOf(() =>
      as(db, "anon", null, () => db.query(`select * from public.${table}`)),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("is removed when the account is deleted", async () => {
    const a = await createUser(db);
    const created = await insertAs(a, table);
    await db.query("delete from auth.users where id = $1", [a]);
    const { rows } = await db.query(`select id from public.${table} where id = $1`, [
      created.rows[0]!.id,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("keeps updated_at current", async () => {
    const a = await createUser(db);
    const created = await insertAs(a, table);
    const m = MINIMAL[table]!;
    const value = m.editColumn === "years" ? "2" : "'edited'";
    await as(db, "authenticated", a, () =>
      db.query(`update public.${table} set ${m.editColumn} = ${value} where id = $1`, [
        created.rows[0]!.id,
      ]),
    );
    const { rows } = await db.query<{ ok: boolean }>(
      `select updated_at > created_at as ok from public.${table} where id = $1`,
      [created.rows[0]!.id],
    );
    expect(rows[0]?.ok).toBe(true);
  });
});

describe("singleton tables", () => {
  it.each(["profiles", "career_goals"])("%s allows only one row per user", async (table) => {
    const a = await createUser(db);
    await insertAs(a, table);
    const err = await errorOf(() => insertAs(a, table));
    expect(err).toMatch(/duplicate key|unique/i);
  });
});

describe("collection tables: source and confirmed", () => {
  it.each(TABLES.filter((t) => !["profiles", "career_goals"].includes(t)))(
    "%s defaults to a manual, confirmed item",
    async (table) => {
      const a = await createUser(db);
      const created = await insertAs(a, table);
      const { rows } = await db.query<{ source: string; confirmed: boolean }>(
        `select source, confirmed from public.${table} where id = $1`,
        [created.rows[0]!.id],
      );
      expect(rows[0]).toEqual({ source: "manual", confirmed: true });
    },
  );

  it("accepts an unconfirmed resume-sourced item and lets the user confirm it", async () => {
    const a = await createUser(db);
    const created = await insertAs(a, "skills", ", source, confirmed", ", 'resume', false");
    const id = created.rows[0]!.id;
    await as(db, "authenticated", a, () =>
      db.query("update public.skills set confirmed = true where id = $1", [id]),
    );
    const { rows } = await db.query<{ confirmed: boolean }>(
      "select confirmed from public.skills where id = $1",
      [id],
    );
    expect(rows[0]?.confirmed).toBe(true);
  });

  it("does not let a user rewrite the source of an existing item", async () => {
    const a = await createUser(db);
    const created = await insertAs(a, "skills");
    const err = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query("update public.skills set source = 'resume' where id = $1", [created.rows[0]!.id]),
      ),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("rejects an unknown source", async () => {
    const a = await createUser(db);
    const err = await errorOf(() => insertAs(a, "skills", ", source", ", 'telepathy'"));
    expect(err).toMatch(/check constraint/i);
  });
});

describe("constraints", () => {
  const run = (sql: string, params: unknown[] = []) => errorOf(() => db.query(sql, params));

  it("rejects an end date before the start date, and an end date on a current item", async () => {
    const a = await createUser(db);
    const backwards = await run(
      "insert into public.education (user_id, institution, degree, start_date, end_date) values ($1, 'X', 'Y', '2024-06-01', '2024-01-01')",
      [a],
    );
    const currentWithEnd = await run(
      "insert into public.experiences (user_id, kind, organization, title, is_current, end_date) values ($1, 'work', 'X', 'Y', true, '2024-01-01')",
      [a],
    );
    expect(backwards).toMatch(/check constraint/i);
    expect(currentWithEnd).toMatch(/check constraint/i);
  });

  it("rejects javascript: and other non-http links", async () => {
    const a = await createUser(db);
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://x.test",
      "http://has space.test",
    ]) {
      const err = await run(
        "insert into public.projects (user_id, name, url) values ($1, 'P', $2)",
        [a, bad],
      );
      expect(err, bad).toMatch(/check constraint/i);
    }
    const ok = await run(
      "insert into public.projects (user_id, name, url) values ($1, 'P', 'https://example.com/a?b=1')",
      [a],
    );
    expect(ok).toBeNull();
  });

  it("caps array sizes", async () => {
    const a = await createUser(db);
    const eleven = `array[${Array.from({ length: 11 }, (_, i) => `'b${i}'`).join(",")}]`;
    const err = await run(
      `insert into public.projects (user_id, name, highlights) values ($1, 'P', ${eleven})`,
      [a],
    );
    expect(err).toMatch(/check constraint/i);
  });

  it("enforces salary ordering and currency format", async () => {
    const a = await createUser(db);
    const inverted = await run(
      "insert into public.profiles (user_id, full_name, expected_salary_min, expected_salary_max) values ($1, 'A', 500, 100)",
      [a],
    );
    const b = await createUser(db);
    const currency = await run(
      "insert into public.profiles (user_id, full_name, salary_currency) values ($1, 'A', 'rupees')",
      [b],
    );
    expect(inverted).toMatch(/check constraint/i);
    expect(currency).toMatch(/check constraint/i);
  });

  it("rejects work modes outside the allowed set", async () => {
    const a = await createUser(db);
    const err = await run(
      "insert into public.profiles (user_id, full_name, work_modes) values ($1, 'A', array['teleport'])",
      [a],
    );
    expect(err).toMatch(/check constraint/i);
  });

  it("treats skill names as unique per user, ignoring case, but not across users", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    await insertAs(a, "skills");
    const dup = await run(
      "insert into public.skills (user_id, name, type, level) values ($1, 'DOCKER', 'tool', 'expert')",
      [a],
    );
    const otherUser = await run(
      "insert into public.skills (user_id, name, type, level) values ($1, 'Docker', 'tool', 'expert')",
      [b],
    );
    expect(dup).toMatch(/duplicate key|unique/i);
    expect(otherUser).toBeNull();
  });

  it("rejects empty required text and over-long text", async () => {
    const a = await createUser(db);
    const empty = await run("insert into public.projects (user_id, name) values ($1, '')", [a]);
    const long = await run("insert into public.projects (user_id, name) values ($1, $2)", [
      a,
      "x".repeat(151),
    ]);
    expect(empty).toMatch(/check constraint/i);
    expect(long).toMatch(/check constraint/i);
  });
});
