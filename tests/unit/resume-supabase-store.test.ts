// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ResumeStoreError } from "@/db/resume/store";
import { SupabaseResumeStore, storagePathFor } from "@/db/resume/supabase-store";
import { CONTENT_TYPES } from "@/lib/resume/constants";
import { parseResumeText } from "@/services/resume/parse";
import { computeResumeHealth } from "@/services/resume/health";
import { CLASSIC } from "../fixtures/resume-texts";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

const { text, parsed } = parseResumeText({ rawText: CLASSIC, pages: 1 });
const health = computeResumeHealth({ text, parsed });

const newResume = {
  id: ID,
  file_name: "cv.pdf",
  kind: "pdf" as const,
  size_bytes: 1234,
  sha256: "a".repeat(64),
  page_count: 1,
  extracted_text: text,
  parsed,
  health,
};

interface Plan {
  table?: { data?: unknown; error?: { code?: string } | null; count?: number };
  upload?: { error: unknown };
  remove?: { error: unknown };
  signed?: { data: { signedUrl: string } | null; error: unknown };
}

function fake(plan: Plan = {}) {
  const ops: [string, unknown[]][] = [];
  const storageCalls: [string, unknown[]][] = [];
  const result = {
    data: plan.table?.data ?? null,
    error: plan.table?.error ?? null,
    count: plan.table?.count ?? 0,
  };

  const client = {
    from(table: string) {
      ops.push(["from", [table]]);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "insert", "delete", "order"]) {
        chain[op] = (...args: unknown[]) => {
          ops.push([op, args]);
          return chain;
        };
      }
      chain.maybeSingle = () => Promise.resolve(result);
      chain.single = () => Promise.resolve(result);
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({ ...result, data: result.data ?? [] });
      return chain;
    },
    storage: {
      from(bucket: string) {
        storageCalls.push(["from", [bucket]]);
        return {
          upload: (...args: unknown[]) => {
            storageCalls.push(["upload", args]);
            return Promise.resolve(plan.upload ?? { error: null });
          },
          remove: (...args: unknown[]) => {
            storageCalls.push(["remove", args]);
            return Promise.resolve(plan.remove ?? { error: null });
          },
          createSignedUrl: (...args: unknown[]) => {
            storageCalls.push(["createSignedUrl", args]);
            return Promise.resolve(
              plan.signed ?? { data: { signedUrl: "https://signed.test/x" }, error: null },
            );
          },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, ops, storageCalls };
}

const row = {
  id: ID,
  file_name: "cv.pdf",
  content_type: CONTENT_TYPES.pdf,
  size_bytes: 1234,
  page_count: 1,
  health,
  created_at: "2026-01-01T00:00:00Z",
};

describe("SupabaseResumeStore.create", () => {
  it("uploads to the owner's folder in the private bucket first, then records the row", async () => {
    const { client, ops, storageCalls } = fake({ table: { data: row } });
    const summary = await new SupabaseResumeStore(client).create(
      USER,
      newResume,
      new Uint8Array([1, 2, 3]),
    );

    expect(storageCalls[0]).toEqual(["from", ["resumes"]]);
    const [, uploadArgs] = storageCalls.find(([op]) => op === "upload")!;
    expect(uploadArgs[0]).toBe(`${USER}/${ID}.pdf`);
    expect(uploadArgs[2]).toMatchObject({ contentType: "application/pdf", upsert: false });

    const insert = ops.find(([op]) => op === "insert")!;
    expect(insert[1][0]).toMatchObject({
      user_id: USER,
      storage_path: `${USER}/${ID}.pdf`,
      content_type: CONTENT_TYPES.pdf,
    });
    expect(summary).toMatchObject({ id: ID, kind: "pdf", health_score: health.score });
  });

  it("removes the uploaded file when the row insert fails, so no orphan is left", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, storageCalls } = fake({ table: { error: { code: "XX000" } } });
    await expect(
      new SupabaseResumeStore(client).create(USER, newResume, new Uint8Array([1])),
    ).rejects.toBeInstanceOf(ResumeStoreError);
    expect(storageCalls).toContainEqual(["remove", [[`${USER}/${ID}.pdf`]]]);
    spy.mockRestore();
  });

  it("maps a duplicate hash to a duplicate error (and still cleans up the file)", async () => {
    const { client, storageCalls } = fake({ table: { error: { code: "23505" } } });
    await expect(
      new SupabaseResumeStore(client).create(USER, newResume, new Uint8Array([1])),
    ).rejects.toMatchObject({
      kind: "duplicate",
    });
    expect(storageCalls.some(([op]) => op === "remove")).toBe(true);
  });

  it("does not write a row when the upload itself fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, ops } = fake({ upload: { error: { message: "denied" } } });
    await expect(
      new SupabaseResumeStore(client).create(USER, newResume, new Uint8Array([1])),
    ).rejects.toBeInstanceOf(ResumeStoreError);
    expect(ops.some(([op]) => op === "insert")).toBe(false);
    spy.mockRestore();
  });
});

describe("SupabaseResumeStore reads and deletes", () => {
  it("scopes every lookup by id and user id", async () => {
    const { client, ops } = fake({
      table: { data: { ...row, parsed, health, sha256: "a".repeat(64), extracted_text: text } },
    });
    const record = await new SupabaseResumeStore(client).get(USER, ID);
    expect(ops).toContainEqual(["eq", ["id", ID]]);
    expect(ops).toContainEqual(["eq", ["user_id", USER]]);
    expect(record?.parsed.contact.full_name).toBe("Priya Menon");
  });

  it("refuses to return a row whose stored JSON no longer validates", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fake({
      table: { data: { ...row, parsed: { nonsense: true }, sha256: "a".repeat(64) } },
    });
    await expect(new SupabaseResumeStore(client).get(USER, ID)).rejects.toBeInstanceOf(
      ResumeStoreError,
    );
    spy.mockRestore();
  });

  it("returns null when the row is not visible", async () => {
    const { client } = fake({ table: { data: null } });
    expect(await new SupabaseResumeStore(client).get(USER, ID)).toBeNull();
  });

  it("deletes the file before the row, and keeps the row if file removal fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = fake({ table: { data: { storage_path: `${USER}/${ID}.pdf` } } });
    await new SupabaseResumeStore(ok.client).delete(USER, ID);
    expect(ok.storageCalls).toContainEqual(["remove", [[`${USER}/${ID}.pdf`]]]);

    const bad = fake({
      table: { data: { storage_path: `${USER}/${ID}.pdf` } },
      remove: { error: { message: "x" } },
    });
    await expect(new SupabaseResumeStore(bad.client).delete(USER, ID)).rejects.toBeInstanceOf(
      ResumeStoreError,
    );
    expect(bad.ops.some(([op]) => op === "delete")).toBe(false);
    spy.mockRestore();
  });

  it("returns false when deleting something that is not there", async () => {
    const { client } = fake({ table: { data: null } });
    expect(await new SupabaseResumeStore(client).delete(USER, ID)).toBe(false);
  });
});

describe("SupabaseResumeStore.signedUrl", () => {
  it("issues a 60 second link that downloads under the display name", async () => {
    const { client, storageCalls } = fake({
      table: { data: { storage_path: `${USER}/${ID}.pdf`, file_name: "cv.pdf" } },
    });
    expect(await new SupabaseResumeStore(client).signedUrl(USER, ID)).toBe("https://signed.test/x");
    expect(storageCalls).toContainEqual([
      "createSignedUrl",
      [`${USER}/${ID}.pdf`, 60, { download: "cv.pdf" }],
    ]);
  });

  it("returns null when the resume is not the caller's or signing fails", async () => {
    expect(
      await new SupabaseResumeStore(fake({ table: { data: null } }).client).signedUrl(USER, ID),
    ).toBeNull();
    const failing = fake({
      table: { data: { storage_path: "x", file_name: "cv.pdf" } },
      signed: { data: null, error: { message: "no" } },
    });
    expect(await new SupabaseResumeStore(failing.client).signedUrl(USER, ID)).toBeNull();
  });
});

describe("storagePathFor", () => {
  it("always builds {user}/{id}.{ext} and nothing else", () => {
    expect(storagePathFor(USER, ID, "docx")).toBe(`${USER}/${ID}.docx`);
  });
});
