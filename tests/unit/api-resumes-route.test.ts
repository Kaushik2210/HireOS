// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryResumeStore } from "@/db/resume/memory-store";
import { uploadByIp, uploadByUser } from "@/features/resume/limiters";
import { CLASSIC } from "../fixtures/resume-texts";
import { makePdf } from "../fixtures/files";

let user: { id: string; email: string | null; isDemo: boolean } | null = null;
let store = new MemoryResumeStore();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => user }));
vi.mock("@/db/resume", () => ({ getResumeStore: async () => store }));

const { POST } = await import("@/app/api/resumes/route");

const ORIGIN = "https://app.test";

function formRequest(
  file: { name: string; bytes: Uint8Array; type?: string } | null,
  headers: Record<string, string> = { origin: ORIGIN },
) {
  const form = new FormData();
  if (file) {
    form.set(
      "file",
      new File([file.bytes as BlobPart], file.name, { type: file.type ?? "application/pdf" }),
    );
  }
  return new NextRequest(`${ORIGIN}/api/resumes`, { method: "POST", body: form, headers });
}

beforeEach(() => {
  user = { id: "user-1", email: null, isDemo: true };
  store = new MemoryResumeStore();
  uploadByUser.reset();
  uploadByIp.reset();
});

describe("POST /api/resumes", () => {
  it("stores a valid upload and returns its id", async () => {
    const res = await POST(formRequest({ name: "cv.pdf", bytes: await makePdf(CLASSIC) }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; duplicate: boolean };
    expect(body.duplicate).toBe(false);
    expect(await store.get("user-1", body.id)).not.toBeNull();
  });

  it("marks responses as uncacheable and not sniffable", async () => {
    const res = await POST(formRequest({ name: "cv.pdf", bytes: await makePdf(CLASSIC) }));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers a repeat of the same file with 200 and the existing id", async () => {
    const bytes = await makePdf(CLASSIC);
    const first = (await (await POST(formRequest({ name: "a.pdf", bytes }))).json()) as {
      id: string;
    };
    const second = await POST(formRequest({ name: "b.pdf", bytes }));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ id: first.id, duplicate: true });
  });

  it("refuses cross-site requests and requests with no origin information", async () => {
    const bytes = await makePdf(CLASSIC);
    expect(
      (await POST(formRequest({ name: "a.pdf", bytes }, { origin: "https://evil.example" })))
        .status,
    ).toBe(403);
    expect((await POST(formRequest({ name: "a.pdf", bytes }, {}))).status).toBe(403);
    expect(await store.count("user-1")).toBe(0);
  });

  it("requires a signed-in user", async () => {
    user = null;
    const res = await POST(formRequest({ name: "a.pdf", bytes: await makePdf(CLASSIC) }));
    expect(res.status).toBe(401);
  });

  it("rejects a body that is not multipart, a missing file, and an oversized declared body", async () => {
    const notMultipart = new NextRequest(`${ORIGIN}/api/resumes`, {
      method: "POST",
      body: JSON.stringify({ file: "x" }),
      headers: { origin: ORIGIN, "content-type": "application/json" },
    });
    expect((await POST(notMultipart)).status).toBe(415);
    expect((await POST(formRequest(null))).status).toBe(400);

    const huge = new NextRequest(`${ORIGIN}/api/resumes`, {
      method: "POST",
      body: "x",
      headers: {
        origin: ORIGIN,
        "content-length": String(50 * 1024 * 1024),
        "content-type": "multipart/form-data; boundary=x",
      },
    });
    expect((await POST(huge)).status).toBe(413);
  });

  it("maps content rejections to the right status without storing anything", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    expect((await POST(formRequest({ name: "cv.pdf", bytes: exe }))).status).toBe(415);
    expect((await POST(formRequest({ name: "cv.pdf", bytes: new Uint8Array(0) }))).status).toBe(
      400,
    );
    expect(await store.count("user-1")).toBe(0);
  });

  it("rate limits a user, with Retry-After, and keeps other users unaffected", async () => {
    const garbage = new Uint8Array([1, 2, 3]);
    for (let i = 0; i < 15; i++) await POST(formRequest({ name: "a.pdf", bytes: garbage }));
    const blocked = await POST(formRequest({ name: "a.pdf", bytes: garbage }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ code: "rate_limit" });

    user = { id: "user-2", email: null, isDemo: true };
    expect((await POST(formRequest({ name: "a.pdf", bytes: garbage }))).status).not.toBe(429);
  });

  it("applies the per-address limit when a forwarded address is present", async () => {
    const garbage = new Uint8Array([1, 2, 3]);
    const headers = { origin: ORIGIN, "x-forwarded-for": "203.0.113.7, 10.0.0.1" };
    for (let i = 0; i < 40; i++) {
      user = { id: `visitor-${i}`, email: null, isDemo: true };
      await POST(formRequest({ name: "a.pdf", bytes: garbage }, headers));
    }
    user = { id: "visitor-new", email: null, isDemo: true };
    expect((await POST(formRequest({ name: "a.pdf", bytes: garbage }, headers))).status).toBe(429);
  });
});
