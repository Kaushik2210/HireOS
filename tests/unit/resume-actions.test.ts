// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { MemoryResumeStore } from "@/db/resume/memory-store";
import { resetActionLimits } from "@/lib/security/action-limits";
import { processResumeUpload } from "@/services/resume/upload";
import { makePdf } from "../fixtures/files";
import { CLASSIC } from "../fixtures/resume-texts";

type TestUser = { id: string; email: string | null; isDemo: boolean };
let user: TestUser | null = null;
let resumes = new MemoryResumeStore();
let profiles = new MemoryProfileStore(null);
const revalidatePath = vi.fn();

class RedirectSignal extends Error {}

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => user,
  requireUser: async () => {
    if (!user) throw new RedirectSignal("/login");
    return user;
  },
}));
vi.mock("@/db/resume", () => ({ getResumeStore: async () => resumes }));
vi.mock("@/db/profile", () => ({ getProfileStore: async () => profiles }));

const actions = await import("@/features/resume/actions");
const { GET: download } = await import("@/app/api/resumes/[id]/file/route");

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

async function storeOne(userId: string) {
  const outcome = await processResumeUpload({
    userId,
    bytes: await makePdf(CLASSIC),
    fileName: "cv.pdf",
    store: resumes,
  });
  if (!outcome.ok) throw new Error("upload failed");
  return outcome.resume.id;
}

beforeEach(() => {
  user = { id: "user-1", email: null, isDemo: true };
  resumes = new MemoryResumeStore();
  profiles = new MemoryProfileStore(null);
  revalidatePath.mockClear();
  resetActionLimits();
});

describe("deleteResumeAction", () => {
  it("deletes the person's own resume and refreshes the list", async () => {
    const id = await storeOne("user-1");
    expect(await actions.deleteResumeAction(id)).toEqual({ ok: true });
    expect(await resumes.get("user-1", id)).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/resume");
  });

  it("rejects anything that is not an id, and an id that is not theirs", async () => {
    expect((await actions.deleteResumeAction("../../etc/passwd")).ok).toBe(false);
    expect((await actions.deleteResumeAction(UNKNOWN)).ok).toBe(false);

    const mine = await storeOne("user-1");
    user = { id: "intruder", email: null, isDemo: true };
    expect((await actions.deleteResumeAction(mine)).ok).toBe(false);
    user = { id: "user-1", email: null, isDemo: true };
    expect(await resumes.get("user-1", mine)).not.toBeNull();
  });

  it("reports a failing store without leaking why", async () => {
    vi.spyOn(resumes, "delete").mockRejectedValueOnce(new Error("connection string: secret"));
    const result = await actions.deleteResumeAction(UNKNOWN);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Could not delete") });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("importResumeAction", () => {
  it("adds what the parser found to the profile as unconfirmed proposals", async () => {
    const id = await storeOne("user-1");
    const result = await actions.importResumeAction(id);
    expect(result.ok).toBe(true);
    expect(result.ok && result.message).toMatch(/Added \d+ items? for your review/);

    const snapshot = await profiles.getSnapshot("user-1");
    expect(snapshot.skills.length).toBeGreaterThan(0);
    // Nothing from a resume is verified until the person confirms it.
    expect(snapshot.skills.every((s) => s.confirmed === false)).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/profile");
  });

  it("says so when everything is already there", async () => {
    const id = await storeOne("user-1");
    await actions.importResumeAction(id);
    const again = await actions.importResumeAction(id);
    expect(again).toEqual({
      ok: true,
      message: expect.stringMatching(/already in your profile|Nothing new/),
    });
  });

  it("refuses ids that are malformed, unknown or someone else's", async () => {
    expect((await actions.importResumeAction("nope")).ok).toBe(false);
    expect((await actions.importResumeAction(UNKNOWN)).ok).toBe(false);

    const mine = await storeOne("user-1");
    user = { id: "intruder", email: null, isDemo: true };
    expect((await actions.importResumeAction(mine)).ok).toBe(false);
    expect((await profiles.getSnapshot("intruder")).skills).toEqual([]);
  });

  it("answers a store failure with a plain message", async () => {
    vi.spyOn(resumes, "get").mockRejectedValueOnce(new Error("boom"));
    const result = await actions.importResumeAction(UNKNOWN);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Could not") });
  });
});

describe("GET /api/resumes/[id]/file", () => {
  const call = (id: string) =>
    download(new NextRequest(`https://app.test/api/resumes/${id}/file`), {
      params: Promise.resolve({ id }),
    });

  it("is closed to signed-out callers and to malformed ids", async () => {
    user = null;
    expect((await call(UNKNOWN)).status).toBe(401);
    user = { id: "user-1", email: null, isDemo: true };
    expect((await call("not-a-uuid")).status).toBe(404);
  });

  it("never redirects to a file that does not exist for this person", async () => {
    const id = await storeOne("user-1");
    // The demo store keeps no original, so there is no link to give.
    const res = await call(id);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an owner to a signed link, never serving the bytes itself", async () => {
    const id = await storeOne("user-1");
    vi.spyOn(resumes, "signedUrl").mockResolvedValueOnce("https://files.example/signed?token=abc");
    const res = await call(id);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://files.example/signed?token=abc");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
