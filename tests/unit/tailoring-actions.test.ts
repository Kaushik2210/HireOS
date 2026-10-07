// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDocumentStore } from "@/db/documents/memory-store";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { DEFAULT_JOB_QUERY } from "@/lib/jobs/schemas";

let jobs = new MemoryJobStore();
let profiles = new MemoryProfileStore("asha");
let documents = new MemoryDocumentStore();
let user: { id: string; email: string | null; isDemo: boolean } | null = null;
const revalidatePath = vi.fn();

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!user) throw new RedirectSignal("/login");
    return user;
  },
}));
vi.mock("@/db/jobs", () => ({ getJobStore: async () => jobs }));
vi.mock("@/db/profile", () => ({ getProfileStore: async () => profiles }));
vi.mock("@/db/documents", () => ({ getDocumentStore: async () => documents }));

const actions = await import("@/features/tailoring/actions");

async function firstJob() {
  return (await jobs.search("user-1", DEFAULT_JOB_QUERY)).jobs[0]!;
}

async function redirected(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
}

beforeEach(() => {
  jobs = new MemoryJobStore();
  profiles = new MemoryProfileStore("asha");
  documents = new MemoryDocumentStore();
  user = { id: "user-1", email: null, isDemo: true };
  revalidatePath.mockClear();
});

describe("saveResumeVersionAction", () => {
  it("saves a numbered draft and sends the user to it", async () => {
    const job = await firstJob();
    const to = await redirected(actions.saveResumeVersionAction({ jobId: job.id, exclude: [] }));
    const [saved] = await documents.list("user-1");
    expect(saved).toMatchObject({ kind: "resume", versionNumber: 1, status: "draft" });
    expect(to).toBe(`/jobs/${job.id}/documents/${saved!.id}`);
    expect(saved!.verification.ok).toBe(true);
  });

  it("builds the content on the server: nothing from the browser becomes document text", async () => {
    const job = await firstJob();
    await redirected(
      actions.saveResumeVersionAction({
        jobId: job.id,
        exclude: [],
        body: "I know Kubernetes",
        content: { evil: true },
      }),
    );
    const [saved] = await documents.list("user-1");
    expect(saved!.body).not.toContain("Kubernetes");
    expect(saved!.content.kind).toBe("resume");
  });

  it("leaves out what the user chose, and ignores keys that match nothing", async () => {
    const job = await firstJob();
    const snap = await profiles.getSnapshot("user-1");
    const project = snap.projects[0]!;
    await redirected(
      actions.saveResumeVersionAction({
        jobId: job.id,
        exclude: [project.id, "00000000-0000-4000-8000-000000000000#h3"],
      }),
    );
    const [saved] = await documents.list("user-1");
    expect(saved!.body).not.toContain(project.name);
  });

  it("numbers later saves after earlier ones and links the parent", async () => {
    const job = await firstJob();
    await redirected(actions.saveResumeVersionAction({ jobId: job.id }));
    const [first] = await documents.list("user-1");
    await redirected(actions.saveResumeVersionAction({ jobId: job.id, parentId: first!.id }));
    const list = await documents.list("user-1");
    expect(list.map((v) => v.versionNumber).sort()).toEqual([1, 2]);
    expect(list.find((v) => v.versionNumber === 2)!.parentId).toBe(first!.id);
  });

  it("rejects malformed input before touching anything", async () => {
    for (const bad of [
      null,
      {},
      { jobId: "nope" },
      { jobId: "00000000-0000-4000-8000-000000000001", exclude: ["../../etc/passwd"] },
      { jobId: "00000000-0000-4000-8000-000000000001", exclude: "x" },
    ]) {
      expect(await actions.saveResumeVersionAction(bad)).toEqual({
        ok: false,
        error: "Invalid request.",
      });
    }
    expect(await documents.list("user-1")).toEqual([]);
  });

  it("refuses an unknown job", async () => {
    expect(
      await actions.saveResumeVersionAction({ jobId: "00000000-0000-4000-8000-000000000001" }),
    ).toEqual({ ok: false, error: "That job no longer exists." });
  });

  it("says what is missing when nothing is verified", async () => {
    await profiles.wipe("user-1");
    const job = await firstJob();
    const result = await actions.saveResumeVersionAction({ jobId: job.id });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/profile|verified/i);
    expect(await documents.list("user-1")).toEqual([]);
  });

  it("requires a signed-in user", async () => {
    user = null;
    const job = await firstJob();
    expect(await redirected(actions.saveResumeVersionAction({ jobId: job.id }))).toBe("/login");
  });
});

describe("saveLetterVersionAction", () => {
  it("saves a generated letter, and an edited one flagged when it adds a skill", async () => {
    const job = await firstJob();
    await redirected(actions.saveLetterVersionAction({ jobId: job.id }));
    const [generated] = await documents.list("user-1");
    expect(generated!.verification.ok).toBe(true);

    await redirected(
      actions.saveLetterVersionAction({
        jobId: job.id,
        text: `${generated!.body}\n\nI am an expert in Kubernetes.`,
        parentId: generated!.id,
      }),
    );
    const edited = (await documents.list("user-1")).find((v) => v.versionNumber === 2)!;
    expect(edited.verification.ok).toBe(false);
    expect(edited.content.kind === "cover_letter" && edited.content.doc.edited).toBe(true);
    expect(await documents.approve("user-1", edited.id)).toBe("blocked");
  });

  it("rejects empty and oversized text", async () => {
    const job = await firstJob();
    expect(await actions.saveLetterVersionAction({ jobId: job.id, text: "   " })).toEqual({
      ok: false,
      error: "The text is empty.",
    });
    expect(
      await actions.saveLetterVersionAction({ jobId: job.id, text: "x".repeat(20001) }),
    ).toEqual({ ok: false, error: "Invalid request." });
  });
});

describe("approveVersionAction and deleteVersionAction", () => {
  it("approves a passing version once", async () => {
    const job = await firstJob();
    await redirected(actions.saveResumeVersionAction({ jobId: job.id }));
    const [v] = await documents.list("user-1");
    expect(await actions.approveVersionAction(v!.id)).toEqual({ ok: true, message: "Approved." });
    expect((await documents.get("user-1", v!.id))?.status).toBe("approved");
    expect(revalidatePath).toHaveBeenCalledWith("/documents");
  });

  it("refuses a blocked version with an explanation, and unknown ids", async () => {
    const job = await firstJob();
    await redirected(
      actions.saveLetterVersionAction({ jobId: job.id, text: "I use Kubernetes daily." }),
    );
    const [v] = await documents.list("user-1");
    const blocked = await actions.approveVersionAction(v!.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.error).toMatch(/could not be traced/);
    expect(await actions.approveVersionAction("not-a-uuid")).toEqual({
      ok: false,
      error: "Unknown document.",
    });
    expect(await actions.approveVersionAction("00000000-0000-4000-8000-000000000001")).toEqual({
      ok: false,
      error: "That document no longer exists.",
    });
  });

  it("deletes only the caller's version", async () => {
    const job = await firstJob();
    await redirected(actions.saveResumeVersionAction({ jobId: job.id }));
    const [v] = await documents.list("user-1");
    user = { id: "someone-else", email: null, isDemo: true };
    expect((await actions.deleteVersionAction(v!.id)).ok).toBe(false);
    expect(await documents.get("user-1", v!.id)).not.toBeNull();
    user = { id: "user-1", email: null, isDemo: true };
    expect(await actions.deleteVersionAction(v!.id)).toEqual({ ok: true });
    expect(await documents.get("user-1", v!.id)).toBeNull();
  });
});
