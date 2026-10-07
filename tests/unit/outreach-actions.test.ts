// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { MemoryOutreachStore } from "@/db/outreach/memory-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { DEFAULT_JOB_QUERY } from "@/lib/jobs/schemas";

let jobs = new MemoryJobStore();
let profiles = new MemoryProfileStore("asha");
let outreach = new MemoryOutreachStore();
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
vi.mock("@/db/outreach", () => ({ getOutreachStore: async () => outreach }));

const actions = await import("@/features/outreach/actions");

const firstJob = async () => (await jobs.search("user-1", DEFAULT_JOB_QUERY)).jobs[0]!;

async function redirected(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
}

async function created(extra: Record<string, unknown> = {}) {
  const job = await firstJob();
  const to = await redirected(
    actions.createDraftAction({
      jobId: job.id,
      type: "recruiter",
      recipient_name: "Priya",
      ...extra,
    }),
  );
  const [draft] = await outreach.list("user-1");
  return { job, to, draft: draft! };
}

beforeEach(() => {
  jobs = new MemoryJobStore();
  profiles = new MemoryProfileStore("asha");
  outreach = new MemoryOutreachStore();
  user = { id: "user-1", email: null, isDemo: true };
  revalidatePath.mockClear();
});

describe("createDraftAction", () => {
  it("writes a draft from stored data and sends the user to it", async () => {
    const { job, to, draft } = await created();
    expect(to).toBe(`/jobs/${job.id}/outreach/${draft.id}`);
    expect(draft).toMatchObject({ type: "recruiter", status: "draft", recipientName: "Priya" });
    expect(draft.verification.ok).toBe(true);
    expect(draft.body).toContain("Dear Priya,");
  });

  it("accepts only the form fields: extra content from the browser is ignored", async () => {
    const { draft } = await created({
      body: "I know Kubernetes",
      content: { evil: true },
      status: "sent",
    });
    expect(draft.body).not.toContain("Kubernetes");
    expect(draft.status).toBe("draft");
  });

  it("needs a confirmation before saying the person applied or spoke", async () => {
    const job = await firstJob();
    const r = await actions.createDraftAction({ jobId: job.id, type: "follow_up" });
    expect(r).toEqual({
      ok: false,
      error: "Tick the box to confirm it first: the draft only says what you confirm.",
    });
    expect(await outreach.list("user-1")).toEqual([]);
    expect(
      await redirected(
        actions.createDraftAction({ jobId: job.id, type: "follow_up", confirm_applied: true }),
      ),
    ).toMatch(/\/outreach\//);
  });

  it("needs context for an alumni note", async () => {
    const job = await firstJob();
    const r = await actions.createDraftAction({ jobId: job.id, type: "alumni" });
    expect(r.ok === false && r.error).toMatch(/how you know this person/);
  });

  it("rejects malformed input and unknown jobs", async () => {
    for (const bad of [
      null,
      {},
      { jobId: "nope", type: "recruiter" },
      { jobId: "00000000-0000-4000-8000-000000000001", type: "spam" },
    ]) {
      expect((await actions.createDraftAction(bad)).ok).toBe(false);
    }
    expect(
      await actions.createDraftAction({
        jobId: "00000000-0000-4000-8000-000000000001",
        type: "recruiter",
      }),
    ).toEqual({ ok: false, error: "That job no longer exists." });
  });

  it("explains an empty profile, and requires sign-in", async () => {
    await profiles.wipe("user-1");
    const job = await firstJob();
    const r = await actions.createDraftAction({ jobId: job.id, type: "recruiter" });
    expect(r.ok === false && r.error).toMatch(/profile|verified/i);
    user = null;
    expect(await redirected(actions.createDraftAction({ jobId: job.id, type: "recruiter" }))).toBe(
      "/login",
    );
  });
});

describe("saveDraftEditAction", () => {
  it("saves edits and flags a skill the profile does not have", async () => {
    const { draft } = await created();
    expect(
      await actions.saveDraftEditAction({
        id: draft.id,
        text: "Hello Priya, I build REST APIs with Python.",
        subject: "Hello",
      }),
    ).toEqual({ ok: true, message: "Saved." });
    expect((await outreach.get("user-1", draft.id))?.verification.ok).toBe(true);
    await actions.saveDraftEditAction({ id: draft.id, text: "I run Kubernetes clusters." });
    const flagged = (await outreach.get("user-1", draft.id))!;
    expect(flagged.verification.ok).toBe(false);
    expect(flagged.doc.edited).toBe(true);
  });

  it("refuses edits once approved, and bad input", async () => {
    const { draft } = await created();
    await actions.approveDraftAction(draft.id);
    expect(await actions.saveDraftEditAction({ id: draft.id, text: "Changed" })).toEqual({
      ok: false,
      error: "Approved drafts cannot be edited. Write a new draft instead.",
    });
    expect((await outreach.get("user-1", draft.id))?.body).toBe(draft.body);
    expect((await actions.saveDraftEditAction({ id: "nope", text: "x" })).ok).toBe(false);
    expect((await actions.saveDraftEditAction({ id: draft.id, text: "x".repeat(5001) })).ok).toBe(
      false,
    );
  });
});

describe("review actions", () => {
  it("goes draft, approved, sent, in order", async () => {
    const { draft } = await created();
    expect(await actions.markSentAction(draft.id)).toEqual({
      ok: false,
      error: "Approve the draft first.",
    });
    expect(await actions.approveDraftAction(draft.id)).toEqual({ ok: true, message: "Approved." });
    expect(await actions.markSentAction(draft.id)).toEqual({ ok: true, message: "Recorded." });
    expect((await outreach.get("user-1", draft.id))?.status).toBe("sent");
  });

  it("will not approve a flagged draft", async () => {
    const { draft } = await created();
    await actions.saveDraftEditAction({ id: draft.id, text: "I run Kubernetes clusters." });
    const r = await actions.approveDraftAction(draft.id);
    expect(r.ok === false && r.error).toMatch(/could not be traced/);
    expect((await outreach.get("user-1", draft.id))?.status).toBe("draft");
  });

  it("deletes only the caller's draft, and rejects unknown ids", async () => {
    const { draft } = await created();
    user = { id: "someone-else", email: null, isDemo: true };
    expect((await actions.deleteDraftAction(draft.id)).ok).toBe(false);
    expect(await outreach.get("user-1", draft.id)).not.toBeNull();
    user = { id: "user-1", email: null, isDemo: true };
    expect(await actions.deleteDraftAction(draft.id)).toEqual({ ok: true });
    for (const fn of [
      actions.approveDraftAction,
      actions.markSentAction,
      actions.deleteDraftAction,
    ]) {
      expect((await fn("not-a-uuid")).ok).toBe(false);
      expect((await fn("00000000-0000-4000-8000-000000000001")).ok).toBe(false);
    }
  });
});
