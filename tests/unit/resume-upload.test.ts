// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { MemoryResumeStore } from "@/db/resume/memory-store";
import { ResumeStoreError, type ResumeStore } from "@/db/resume/store";
import { MAX_RESUMES_PER_USER } from "@/lib/resume/constants";
import { isSameOrigin } from "@/lib/security/origin";
import { processResumeUpload } from "@/services/resume/upload";
import { CLASSIC } from "../fixtures/resume-texts";
import { makeDocx, makePdf, pdfEncrypted, pdfWithJavaScript, zipBomb } from "../fixtures/files";

const run = (store: ResumeStore, bytes: Uint8Array, fileName: string, userId = "u1") =>
  processResumeUpload({ userId, bytes, fileName, store });

describe("processResumeUpload", () => {
  it("stores a parsed, scored resume for a good PDF", async () => {
    const store = new MemoryResumeStore();
    const r = await run(store, await makePdf(CLASSIC), "Priya Menon (final).pdf");
    expect(r).toMatchObject({ ok: true, duplicate: false });
    if (!r.ok) return;
    expect(r.resume).toMatchObject({
      file_name: "Priya Menon (final).pdf",
      kind: "pdf",
      page_count: 1,
    });
    const record = await store.get("u1", r.resume.id);
    expect(record?.parsed.contact.email).toBe("priya.menon@example.com");
    expect(record?.health.score).toBeGreaterThan(0);
    expect(record?.extracted_text).toContain("Brightleaf Software");
  });

  it("accepts a DOCX too", async () => {
    const r = await run(new MemoryResumeStore(), await makeDocx(CLASSIC), "cv.docx");
    expect(r).toMatchObject({ ok: true });
  });

  it("recognises a re-upload of the same file and does not store it twice", async () => {
    const store = new MemoryResumeStore();
    const bytes = await makePdf(CLASSIC);
    const first = await run(store, bytes, "a.pdf");
    const second = await run(store, bytes, "renamed.pdf");
    expect(second).toMatchObject({ ok: true, duplicate: true });
    if (first.ok && second.ok) expect(second.resume.id).toBe(first.resume.id);
    expect(await store.count("u1")).toBe(1);
  });

  it("keeps each user's resumes separate, so identical files do not collide across users", async () => {
    const store = new MemoryResumeStore();
    const bytes = await makePdf(CLASSIC);
    const a = await run(store, bytes, "a.pdf", "user-a");
    const b = await run(store, bytes, "a.pdf", "user-b");
    expect(a).toMatchObject({ ok: true, duplicate: false });
    expect(b).toMatchObject({ ok: true, duplicate: false });
  });

  it("enforces the per-user limit", async () => {
    const store = new MemoryResumeStore();
    for (let i = 0; i < MAX_RESUMES_PER_USER; i++) {
      const r = await run(
        store,
        await makePdf(`Person ${i}\n\nSKILLS\nLanguages: Python`),
        `r${i}.pdf`,
      );
      expect(r.ok).toBe(true);
    }
    const over = await run(store, await makePdf("One more\n\nSKILLS\nLanguages: Go"), "x.pdf");
    expect(over).toMatchObject({ ok: false, status: 409, code: "limit" });
  });

  it.each([
    ["a script-bearing PDF", () => pdfWithJavaScript(), "a.pdf", 422, "active_content"],
    ["an encrypted PDF", () => pdfEncrypted(), "a.pdf", 422, "encrypted"],
    ["a decompression bomb", () => zipBomb(), "a.docx", 422, "zip_bomb"],
    [
      "an executable named .pdf",
      () => new Uint8Array([0x4d, 0x5a, 0, 0, ...new Array(64).fill(1)]),
      "a.pdf",
      415,
      "bad_type",
    ],
    ["an empty file", () => new Uint8Array(0), "a.pdf", 400, "empty"],
    ["a .doc file", () => new Uint8Array([1, 2, 3]), "a.doc", 415, "legacy_format"],
  ] as const)(
    "rejects %s without storing anything",
    async (_name, make, fileName, status, code) => {
      const store = new MemoryResumeStore();
      const r = await run(store, make(), fileName);
      expect(r).toMatchObject({ ok: false, status, code });
      expect(await store.count("u1")).toBe(0);
    },
  );

  it("rejects a damaged PDF as unreadable, storing nothing", async () => {
    const store = new MemoryResumeStore();
    const r = await run(store, new TextEncoder().encode("%PDF-1.4\nnot a real document"), "a.pdf");
    expect(r).toMatchObject({ ok: false, status: 422, code: "extract" });
    expect(await store.count("u1")).toBe(0);
  });

  it("sanitises the stored file name", async () => {
    const store = new MemoryResumeStore();
    const r = await run(store, await makePdf(CLASSIC), "../../etc/<b>passwd</b>.pdf");
    expect(r.ok && r.resume.file_name).toBe("b_.pdf");
  });

  it("reports a concurrent duplicate insert as the existing resume, not an error", async () => {
    const real = new MemoryResumeStore();
    const bytes = await makePdf(CLASSIC);
    const winner = await run(real, bytes, "a.pdf");
    const racing: ResumeStore = {
      ...bindAll(real),
      findByHash: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(winner.ok ? winner.resume : null),
      create: vi.fn().mockRejectedValue(new ResumeStoreError("duplicate")),
    };
    const r = await run(racing, bytes, "a.pdf");
    expect(r).toMatchObject({ ok: true, duplicate: true });
  });

  it("returns a generic error when storage fails, without leaking details", async () => {
    const failing: ResumeStore = {
      ...bindAll(new MemoryResumeStore()),
      create: vi.fn().mockRejectedValue(new Error("connection string postgres://secret@host")),
    };
    const r = await run(failing, await makePdf(CLASSIC), "a.pdf");
    expect(r).toMatchObject({ ok: false, status: 500, code: "storage" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});

function bindAll(store: ResumeStore): ResumeStore {
  return {
    list: store.list.bind(store),
    get: store.get.bind(store),
    findByHash: store.findByHash.bind(store),
    count: store.count.bind(store),
    create: store.create.bind(store),
    delete: store.delete.bind(store),
    signedUrl: store.signedUrl.bind(store),
  };
}

describe("MemoryResumeStore", () => {
  it("never keeps the original file and offers no download", async () => {
    const store = new MemoryResumeStore();
    const r = await run(store, await makePdf(CLASSIC), "a.pdf");
    if (!r.ok) throw new Error("setup failed");
    expect((await store.get("u1", r.resume.id))?.has_file).toBe(false);
    expect(await store.signedUrl()).toBeNull();
  });

  it("scopes reads and deletes to the owner", async () => {
    const store = new MemoryResumeStore();
    const r = await run(store, await makePdf(CLASSIC), "a.pdf", "owner");
    if (!r.ok) throw new Error("setup failed");
    expect(await store.get("intruder", r.resume.id)).toBeNull();
    expect(await store.delete("intruder", r.resume.id)).toBe(false);
    expect(await store.list("intruder")).toEqual([]);
    expect(await store.delete("owner", r.resume.id)).toBe(true);
  });

  it("lists newest first and returns copies", async () => {
    const store = new MemoryResumeStore();
    const a = await run(store, await makePdf("A Person\n\nSKILLS\nLanguages: Python"), "a.pdf");
    await new Promise((r) => setTimeout(r, 5));
    const b = await run(store, await makePdf("B Person\n\nSKILLS\nLanguages: Go"), "b.pdf");
    if (!a.ok || !b.ok) throw new Error("setup failed");
    expect((await store.list("u1")).map((r) => r.file_name)).toEqual(["b.pdf", "a.pdf"]);
    const got = await store.get("u1", a.resume.id);
    got!.parsed.contact.full_name = "Tampered";
    expect((await store.get("u1", a.resume.id))?.parsed.contact.full_name).not.toBe("Tampered");
  });
});

describe("isSameOrigin", () => {
  const req = (url: string, headers: Record<string, string> = {}) => ({
    url,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  });

  it("accepts a matching Origin and rejects a different one", () => {
    expect(isSameOrigin(req("https://app.test/api/resumes", { origin: "https://app.test" }))).toBe(
      true,
    );
    expect(isSameOrigin(req("https://app.test/api/resumes", { origin: "https://evil.test" }))).toBe(
      false,
    );
    expect(
      isSameOrigin(req("https://app.test/api/resumes", { origin: "https://app.test.evil.test" })),
    ).toBe(false);
    expect(isSameOrigin(req("https://app.test/api/resumes", { origin: "null" }))).toBe(false);
  });

  it("falls back to Sec-Fetch-Site when there is no Origin", () => {
    expect(isSameOrigin(req("https://app.test/x", { "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(req("https://app.test/x", { "sec-fetch-site": "none" }))).toBe(true);
    expect(isSameOrigin(req("https://app.test/x", { "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("refuses a request that identifies itself in neither way", () => {
    expect(isSameOrigin(req("https://app.test/x"))).toBe(false);
  });
});
