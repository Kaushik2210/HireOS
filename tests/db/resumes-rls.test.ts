// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createUser, errorOf } from "./helpers";

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

const PDF = "application/pdf";
const sha = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

interface Opts {
  id?: string;
  contentType?: string;
  storagePath?: string;
  sha256?: string;
  size?: number;
  asUser?: string;
}

async function insertResume(owner: string, o: Opts = {}) {
  const id = o.id ?? randomUUID();
  const type = o.contentType ?? PDF;
  const ext = type === PDF ? "pdf" : "docx";
  const path = o.storagePath ?? `${owner}/${id}.${ext}`;
  return as(db, "authenticated", o.asUser ?? owner, () =>
    db.query<{ id: string }>(
      `insert into public.resumes
         (id, user_id, file_name, content_type, size_bytes, sha256, storage_path, parsed, health)
       values ($1, $2, 'cv.pdf', $3, $4, $5, $6, '{}'::jsonb, '{}'::jsonb) returning id`,
      [id, owner, type, o.size ?? 1000, o.sha256 ?? sha(), path],
    ),
  );
}

describe("public.resumes", () => {
  it("lets a user create and read their own resume, and nobody else's", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const mine = await insertResume(a);
    await insertResume(b);
    const seen = await as(db, "authenticated", a, async () =>
      (await db.query<{ id: string }>("select id from public.resumes")).rows.map((r) => r.id),
    );
    expect(seen).toEqual([mine.rows[0]!.id]);
  });

  it("blocks creating a resume for another user", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const err = await errorOf(() => insertResume(b, { asUser: a }));
    expect(err).toMatch(/row-level security/i);
  });

  it("is immutable: no user can update a resume", async () => {
    const a = await createUser(db);
    const r = await insertResume(a);
    const err = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query("update public.resumes set file_name = 'x.pdf' where id = $1", [r.rows[0]!.id]),
      ),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("only lets owners delete their own, and cascades on account deletion", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const mine = await insertResume(a);
    const theirs = await insertResume(b);
    const denied = await as(db, "authenticated", a, () =>
      db.query("delete from public.resumes where id = $1", [theirs.rows[0]!.id]),
    );
    expect(denied.affectedRows).toBe(0);
    const ok = await as(db, "authenticated", a, () =>
      db.query("delete from public.resumes where id = $1", [mine.rows[0]!.id]),
    );
    expect(ok.affectedRows).toBe(1);

    await db.query("delete from auth.users where id = $1", [b]);
    const left = await db.query("select id from public.resumes where id = $1", [
      theirs.rows[0]!.id,
    ]);
    expect(left.rows).toHaveLength(0);
  });

  it("denies anon entirely", async () => {
    const err = await errorOf(() =>
      as(db, "anon", null, () => db.query("select * from public.resumes")),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("does not let a user set is_demo or created_at", async () => {
    const a = await createUser(db);
    const err = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query(
          `insert into public.resumes (user_id, file_name, content_type, size_bytes, sha256, storage_path, parsed, health, is_demo)
           values ($1, 'a.pdf', $2, 1, $3, $4, '{}', '{}', true)`,
          [a, PDF, sha(), `${a}/${randomUUID()}.pdf`],
        ),
      ),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("forces storage_path to be the owner's own {user_id}/{id}.ext", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const id = randomUUID();
    const pointsAtOther = await errorOf(() =>
      insertResume(a, { id, storagePath: `${b}/${id}.pdf` }),
    );
    const traversal = await errorOf(() => insertResume(a, { storagePath: `../../etc/passwd` }));
    const wrongExt = await errorOf(() =>
      insertResume(a, { id: randomUUID(), storagePath: `${a}/${id}.exe` }),
    );
    expect(pointsAtOther).toMatch(/check constraint/i);
    expect(traversal).toMatch(/check constraint/i);
    expect(wrongExt).toMatch(/check constraint/i);
  });

  it("rejects the wrong content type, oversize files and malformed hashes", async () => {
    const a = await createUser(db);
    expect(await errorOf(() => insertResume(a, { contentType: "text/html" }))).toMatch(
      /check constraint/i,
    );
    expect(await errorOf(() => insertResume(a, { size: 5 * 1024 * 1024 }))).toMatch(
      /check constraint/i,
    );
    expect(await errorOf(() => insertResume(a, { sha256: "nothex" }))).toMatch(/check constraint/i);
  });

  it("recognises the same file uploaded twice by one user, but not across users", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const hash = sha();
    await insertResume(a, { sha256: hash });
    expect(await errorOf(() => insertResume(a, { sha256: hash }))).toMatch(/duplicate key|unique/i);
    expect(await errorOf(() => insertResume(b, { sha256: hash }))).toBeNull();
  });

  it("requires structured parse results", async () => {
    const a = await createUser(db);
    const err = await errorOf(() =>
      db.query(
        `insert into public.resumes (user_id, file_name, content_type, size_bytes, sha256, storage_path, parsed, health)
         values ($1, 'a.pdf', $2, 1, $3, $4, '[]', '{}')`,
        [a, PDF, sha(), `${a}/${randomUUID()}.pdf`],
      ),
    );
    expect(err).toMatch(/check constraint/i);
  });
});

describe("storage bucket and object policies", () => {
  const put = (asUser: string, name: string) =>
    as(db, "authenticated", asUser, () =>
      db.query("insert into storage.objects (bucket_id, name, owner) values ('resumes', $1, $2)", [
        name,
        asUser,
      ]),
    );

  it("creates a private bucket with size and type limits", async () => {
    const { rows } = await db.query<{
      public: boolean;
      file_size_limit: string;
      allowed_mime_types: string[];
    }>(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resumes'",
    );
    expect(rows[0]!.public).toBe(false);
    expect(Number(rows[0]!.file_size_limit)).toBe(4 * 1024 * 1024);
    expect(rows[0]!.allowed_mime_types).toEqual(expect.arrayContaining(["application/pdf"]));
    expect(rows[0]!.allowed_mime_types).not.toContain("text/html");
  });

  it("lets a user store and read an object in their own folder", async () => {
    const a = await createUser(db);
    const name = `${a}/${randomUUID()}.pdf`;
    await put(a, name);
    const rows = await as(
      db,
      "authenticated",
      a,
      async () =>
        (
          await db.query<{ name: string }>(
            "select name from storage.objects where bucket_id = 'resumes'",
          )
        ).rows,
    );
    expect(rows.map((r) => r.name)).toContain(name);
  });

  it("blocks writing into someone else's folder", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const err = await errorOf(() => put(a, `${b}/${randomUUID()}.pdf`));
    expect(err).toMatch(/row-level security/i);
  });

  it("hides one user's objects from another", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const name = `${a}/${randomUUID()}.pdf`;
    await put(a, name);
    const seenByB = await as(
      db,
      "authenticated",
      b,
      async () => (await db.query<{ name: string }>("select name from storage.objects")).rows,
    );
    expect(seenByB.map((r) => r.name)).not.toContain(name);
  });

  it("only accepts names of the exact {uuid}/{uuid}.pdf|docx shape", async () => {
    const a = await createUser(db);
    for (const bad of [
      `${a}/resume.pdf`,
      `${a}/${randomUUID()}.exe`,
      `${a}/${randomUUID()}.pdf.html`,
      `${a}/../${randomUUID()}/${randomUUID()}.pdf`,
      `${a}/sub/${randomUUID()}.pdf`,
    ]) {
      expect(await errorOf(() => put(a, bad)), bad).toMatch(/row-level security/i);
    }
    expect(await errorOf(() => put(a, `${a}/${randomUUID()}.docx`))).toBeNull();
  });

  it("allows deleting one's own objects but not others'", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const name = `${b}/${randomUUID()}.pdf`;
    await put(b, name);
    const denied = await as(db, "authenticated", a, () =>
      db.query("delete from storage.objects where name = $1", [name]),
    );
    expect(denied.affectedRows).toBe(0);
    const ok = await as(db, "authenticated", b, () =>
      db.query("delete from storage.objects where name = $1", [name]),
    );
    expect(ok.affectedRows).toBe(1);
  });

  it("makes objects immutable (no update policy) and invisible to other buckets' rules", async () => {
    const a = await createUser(db);
    const name = `${a}/${randomUUID()}.pdf`;
    await put(a, name);
    const updated = await as(db, "authenticated", a, () =>
      db.query("update storage.objects set name = $2 where name = $1", [
        name,
        `${a}/${randomUUID()}.pdf`,
      ]),
    );
    expect(updated.affectedRows).toBe(0);

    await db.query("insert into storage.buckets (id, name) values ('other', 'other')");
    const err = await errorOf(() =>
      as(db, "authenticated", a, () =>
        db.query("insert into storage.objects (bucket_id, name) values ('other', $1)", [
          `${a}/x.pdf`,
        ]),
      ),
    );
    expect(err).toMatch(/row-level security/i);
  });

  it("gives anon no access", async () => {
    const rows = await as(
      db,
      "anon",
      null,
      async () => (await db.query("select * from storage.objects")).rows,
    );
    expect(rows).toEqual([]);
    const err = await errorOf(() =>
      as(db, "anon", null, () =>
        db.query("insert into storage.objects (bucket_id, name) values ('resumes', 'x/y.pdf')"),
      ),
    );
    expect(err).toMatch(/row-level security/i);
  });
});
