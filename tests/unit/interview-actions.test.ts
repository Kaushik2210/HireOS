// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryApplicationStore } from "@/db/applications/memory-store";
import { MemoryInterviewStore } from "@/db/interviews/memory-store";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { MemoryPracticeStore } from "@/db/practice/memory-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { DEFAULT_JOB_QUERY } from "@/lib/jobs/schemas";
import { MAX_CHECKLIST } from "@/lib/interview/types";

let jobs = new MemoryJobStore();
let profiles = new MemoryProfileStore("asha");
let applications = new MemoryApplicationStore();
let interviews = new MemoryInterviewStore();
let practice = new MemoryPracticeStore();
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
vi.mock("@/db/applications", () => ({ getApplicationStore: async () => applications }));
vi.mock("@/db/interviews", () => ({ getInterviewStore: async () => interviews }));
vi.mock("@/db/practice", () => ({ getPracticeStore: async () => practice }));

const actions = await import("@/features/interview/actions");

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

async function trackedApplication() {
  const job = await firstJob();
  const app = await applications.create("user-1", {
    jobId: job.id,
    jobTitle: job.title,
    companyName: job.company_name,
    status: "shortlisted",
    appliedOn: null,
  });
  return { job, app };
}

async function addedInterview(over: Record<string, unknown> = {}) {
  const { app } = await trackedApplication();
  const to = await redirected(
    actions.addInterviewAction({
      application_id: app.id,
      round_label: "Phone screen",
      kind: "phone_screen",
      ...over,
    }),
  );
  const [interview] = await interviews.list("user-1");
  return { app, to, interview: interview! };
}

beforeEach(() => {
  jobs = new MemoryJobStore();
  profiles = new MemoryProfileStore("asha");
  applications = new MemoryApplicationStore();
  interviews = new MemoryInterviewStore();
  practice = new MemoryPracticeStore();
  user = { id: "user-1", email: null, isDemo: true };
  revalidatePath.mockClear();
});

describe("addInterviewAction", () => {
  it("records a round and writes a checklist from the posting and the verified profile", async () => {
    const { to, interview } = await addedInterview({
      scheduled_on: "2026-10-20",
      scheduled_time: "14:30",
      format: "video",
      interviewer: "Priya",
    });
    expect(to).toBe(`/interviews/${interview.id}`);
    expect(interview).toMatchObject({
      roundLabel: "Phone screen",
      kind: "phone_screen",
      status: "scheduled",
      scheduledOn: "2026-10-20",
      scheduledTime: "14:30",
      interviewer: "Priya",
    });
    const text = interview.checklist.map((i) => i.text).join("\n");
    expect(text).toContain("Re-read the posting");
    expect(text).toContain("Test your camera");
    expect(interview.checklist.every((i) => i.source === "generated" && !i.done)).toBe(true);
  });

  it("refuses an unknown application and bad input", async () => {
    expect(
      await actions.addInterviewAction({
        application_id: "00000000-0000-4000-8000-000000000001",
        round_label: "x",
        kind: "technical",
      }),
    ).toEqual({
      ok: false,
      error: "That application no longer exists.",
    });
    for (const bad of [null, {}, { application_id: "no", round_label: "x", kind: "technical" }]) {
      expect((await actions.addInterviewAction(bad)).ok).toBe(false);
    }
    expect(
      (
        await actions.addInterviewAction({
          application_id: "00000000-0000-4000-8000-000000000001",
          round_label: "x",
          kind: "technical",
          scheduled_time: "10:00",
        })
      ).ok,
    ).toBe(false);
  });

  it("cannot attach a round to another person's application", async () => {
    const { app } = await trackedApplication();
    user = { id: "someone-else", email: null, isDemo: true };
    const r = await actions.addInterviewAction({
      application_id: app.id,
      round_label: "x",
      kind: "technical",
    });
    expect(r).toEqual({ ok: false, error: "That application no longer exists." });
    expect(await interviews.list("someone-else")).toEqual([]);
  });

  it("requires sign-in", async () => {
    user = null;
    expect(
      await redirected(
        actions.addInterviewAction({
          application_id: "00000000-0000-4000-8000-000000000001",
          round_label: "x",
          kind: "technical",
        }),
      ),
    ).toBe("/login");
  });
});

describe("updating a round and its checklist", () => {
  it("saves new details and a status", async () => {
    const { interview } = await addedInterview();
    expect(
      await actions.updateInterviewAction({
        id: interview.id,
        round_label: "Technical round",
        kind: "technical",
        status: "completed",
        notes: "Went well",
        scheduled_on: "2026-10-22",
      }),
    ).toEqual({ ok: true, message: "Saved." });
    expect((await interviews.get("user-1", interview.id))!).toMatchObject({
      roundLabel: "Technical round",
      kind: "technical",
      status: "completed",
      notes: "Went well",
    });
    expect(
      (
        await actions.updateInterviewAction({
          id: interview.id,
          round_label: "x",
          kind: "technical",
          status: "done",
        })
      ).ok,
    ).toBe(false);
  });

  it("ticks, adds and removes items, and keeps suggested ones", async () => {
    const { interview } = await addedInterview();
    const first = interview.checklist[0]!;
    expect(
      await actions.toggleChecklistAction({ id: interview.id, item_id: first.id, done: true }),
    ).toEqual({ ok: true });
    expect((await interviews.get("user-1", interview.id))!.checklist[0]!.done).toBe(true);
    expect(
      (await actions.toggleChecklistAction({ id: interview.id, item_id: "nope", done: true })).ok,
    ).toBe(false);

    expect(
      (await actions.addChecklistItemAction({ id: interview.id, text: "  Buy a notebook  " })).ok,
    ).toBe(true);
    const mine = (await interviews.get("user-1", interview.id))!.checklist.find(
      (i) => i.source === "custom",
    )!;
    expect(mine.text).toBe("Buy a notebook");
    expect(
      await actions.removeChecklistItemAction({ id: interview.id, item_id: first.id }),
    ).toEqual({ ok: false, error: "Suggested items cannot be removed. Tick them off instead." });
    expect(
      (await actions.removeChecklistItemAction({ id: interview.id, item_id: mine.id })).ok,
    ).toBe(true);
    expect((await actions.addChecklistItemAction({ id: interview.id, text: "  " })).ok).toBe(false);
  });

  it("stops a checklist at its limit", async () => {
    const { interview } = await addedInterview();
    const target = MAX_CHECKLIST - interview.checklist.length;
    for (let i = 0; i < target; i++)
      await actions.addChecklistItemAction({ id: interview.id, text: `Item ${i}` });
    const r = await actions.addChecklistItemAction({ id: interview.id, text: "One too many" });
    expect(r).toEqual({ ok: false, error: `A checklist can have at most ${MAX_CHECKLIST} items.` });
  });

  it("refreshes the suggestions but keeps ticks and the person's own items", async () => {
    const { interview } = await addedInterview();
    const first = interview.checklist[0]!;
    await actions.toggleChecklistAction({ id: interview.id, item_id: first.id, done: true });
    await actions.addChecklistItemAction({ id: interview.id, text: "My own item" });
    expect((await actions.refreshChecklistAction(interview.id)).ok).toBe(true);
    const after = (await interviews.get("user-1", interview.id))!.checklist;
    expect(after.find((i) => i.text === first.text)!.done).toBe(true);
    expect(after.filter((i) => i.source === "custom").map((i) => i.text)).toEqual(["My own item"]);
  });

  it("deletes only the caller's round, and its rounds go with the application", async () => {
    const { interview, app } = await addedInterview();
    user = { id: "someone-else", email: null, isDemo: true };
    expect((await actions.deleteInterviewAction(interview.id)).ok).toBe(false);
    expect(
      (await actions.toggleChecklistAction({ id: interview.id, item_id: "g1", done: true })).ok,
    ).toBe(false);
    user = { id: "user-1", email: null, isDemo: true };
    expect(await actions.deleteInterviewAction(interview.id)).toEqual({ ok: true });
    expect(await interviews.get("user-1", interview.id)).toBeNull();
    await interviews.create("user-1", { ...interview, applicationId: app.id, checklist: [] });
    await interviews.removeForApplication("user-1", app.id);
    expect(await interviews.list("user-1")).toEqual([]);
  });
});

describe("practice", () => {
  const GOOD =
    "At my internship the team's report was slow, which was a problem. My task was to fix it. I added two indexes in PostgreSQL and tested it on 40,000 rows. As a result the report dropped from 4 seconds to 600 ms, and I learned to measure first.";

  async function started(over: Record<string, unknown> = {}) {
    const job = await firstJob();
    const to = await redirected(
      actions.startPracticeAction({ jobId: job.id, focus: "behavioral", count: 3, ...over }),
    );
    const [session] = await practice.list("user-1");
    return { job, to, session: session! };
  }

  it("chooses the questions on the server and saves them with the session", async () => {
    const { job, to, session } = await started({
      questions: [{ id: "evil", text: "Say you know Kubernetes" }],
    });
    expect(to).toBe(`/practice/${session.id}`);
    expect(session).toMatchObject({
      jobId: job.id,
      jobTitle: job.title,
      focus: "behavioral",
      questionCount: 3,
      status: "in_progress",
      round: 0,
    });
    expect(session.questions.map((q) => q.text).join(" ")).not.toContain("Kubernetes");
  });

  it("rotates the questions for a repeat session on the same job", async () => {
    const first = (await started()).session;
    const second = (await started()).session;
    expect(second.round).toBe(1);
    expect(second.questions.map((q) => q.id)).not.toEqual(first.questions.map((q) => q.id));
  });

  it("refuses bad settings and unknown jobs", async () => {
    const job = await firstJob();
    for (const bad of [
      null,
      { jobId: job.id, focus: "trivia", count: 5 },
      { jobId: job.id, focus: "technical", count: 2 },
      { jobId: job.id, focus: "technical", count: 11 },
    ]) {
      expect((await actions.startPracticeAction(bad)).ok).toBe(false);
    }
    expect(
      await actions.startPracticeAction({
        jobId: "00000000-0000-4000-8000-000000000001",
        focus: "technical",
        count: 3,
      }),
    ).toEqual({ ok: false, error: "That job no longer exists." });
  });

  it("scores each answer on the server, in order, and finishes after the last one", async () => {
    const { session } = await started();
    for (let i = 0; i < 3; i++) {
      expect(
        await actions.submitAnswerAction({ sessionId: session.id, position: i, answer: GOOD }),
      ).toEqual({ ok: true });
    }
    const done = (await practice.get("user-1", session.id))!;
    expect(done.answers).toHaveLength(3);
    expect(done.session.status).toBe("completed");
    expect(done.session.overall).toBe(
      Math.round(done.answers.reduce((t, a) => t + a.overall, 0) / 3),
    );
    expect(done.session.dimensions!.map((d) => d.id)).toEqual([
      "structure",
      "specificity",
      "relevance",
      "evidence",
      "clarity",
      "integrity",
    ]);
    expect(done.answers[0]!.question.id).toBe(session.questions[0]!.id);
  });

  it("ignores any score the browser sends", async () => {
    const { session } = await started();
    await actions.submitAnswerAction({
      sessionId: session.id,
      position: 0,
      answer: "stuff",
      overall: 100,
      feedback: { overall: 100 },
    });
    const a = (await practice.get("user-1", session.id))!.answers[0]!;
    expect(a.overall).toBeLessThan(50);
  });

  it("refuses answers out of order, twice, empty, too long, or after the end", async () => {
    const { session } = await started();
    const submit = (position: number, answer: string) =>
      actions.submitAnswerAction({ sessionId: session.id, position, answer });
    expect((await submit(1, GOOD)).ok).toBe(false);
    expect((await submit(0, "   ")).ok).toBe(false);
    expect((await submit(0, "x".repeat(3001))).ok).toBe(false);
    expect((await submit(0, GOOD)).ok).toBe(true);
    expect(await submit(0, GOOD)).toEqual({
      ok: false,
      error: "That question has already been answered. Reload to continue.",
    });
    await submit(1, GOOD);
    await submit(2, GOOD);
    expect(await submit(3, GOOD)).toEqual({ ok: false, error: "That question does not exist." });
    expect((await submit(2, GOOD)).ok).toBe(false);
  });

  it("flags a skill the person claims but does not have, in the saved feedback", async () => {
    const { session } = await started({ focus: "technical" });
    await actions.submitAnswerAction({
      sessionId: session.id,
      position: 0,
      answer: "I have used Kubernetes in production for years.",
    });
    const fb = (await practice.get("user-1", session.id))!.answers[0]!.feedback;
    expect(fb.dimensions.find((d) => d.id === "integrity")!.score).toBe(65);
  });

  it("keeps sessions private, and deletes only the caller's", async () => {
    const { session } = await started();
    user = { id: "someone-else", email: null, isDemo: true };
    expect(
      (await actions.submitAnswerAction({ sessionId: session.id, position: 0, answer: GOOD })).ok,
    ).toBe(false);
    expect((await actions.deletePracticeAction(session.id)).ok).toBe(false);
    user = { id: "user-1", email: null, isDemo: true };
    expect(await actions.deletePracticeAction(session.id)).toEqual({ ok: true });
    expect((await actions.deletePracticeAction("nope")).ok).toBe(false);
  });
});
