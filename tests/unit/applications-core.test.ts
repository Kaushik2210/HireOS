// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDemoApplications, DEMO_APPLICATION_SAMPLES } from "@/db/applications/demo-seed";
import { MemoryApplicationStore } from "@/db/applications/memory-store";
import {
  ApplicationStoreError,
  type Application,
  type ApplicationEvent,
} from "@/db/applications/store";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { DEFAULT_JOB_QUERY, type Job } from "@/lib/jobs/schemas";
import { describeEvent } from "@/lib/applications/format";
import {
  APPLIED_STATUSES,
  CLOSED_STATUSES,
  INITIAL_STATUSES,
  MAX_APPLICATIONS,
  STATUSES,
  TRANSITIONS,
  addEventSchema,
  canMove,
  changeStatusSchema,
  createApplicationSchema,
  updateDetailsSchema,
  type Status,
} from "@/lib/applications/types";
import { daysSince, dueFollowUps, followUpFor, summarize } from "@/services/applications/followups";

const jobs: Job[] = [];
beforeAll(async () => {
  const store = new MemoryJobStore();
  for (let page = 1; page <= 3; page++) {
    jobs.push(...(await store.search("x", { ...DEFAULT_JOB_QUERY, page })).jobs);
  }
});

let clock = new Date("2026-10-07T12:00:00Z");
const store = () => new MemoryApplicationStore({ now: () => clock });
const input = (n: number, over: Record<string, unknown> = {}) => ({
  jobId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  jobTitle: `Role ${n}`,
  companyName: "Acme",
  status: "shortlisted" as const,
  appliedOn: null,
  ...over,
});

describe("the pipeline's rules", () => {
  it("never allows a move to the same status, and treats rejected as final", () => {
    for (const s of STATUSES) expect(TRANSITIONS[s]).not.toContain(s);
    expect(TRANSITIONS.rejected).toEqual([]);
  });

  it("can reach every status from a way in", () => {
    const seen = new Set<Status>(INITIAL_STATUSES);
    const queue: Status[] = [...INITIAL_STATUSES];
    while (queue.length > 0) {
      for (const next of TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...STATUSES].sort());
  });

  it("only lists real statuses, and never skips straight to an offer from the start", () => {
    for (const s of STATUSES) for (const t of TRANSITIONS[s]) expect(STATUSES).toContain(t);
    for (const s of ["discovered", "shortlisted", "preparing"] as const) {
      expect(canMove(s, "offer")).toBe(false);
      expect(canMove(s, "interview")).toBe(false);
    }
  });

  it("lets a person only start an application early, and only reach 'applied' by saying so", () => {
    expect([...INITIAL_STATUSES]).toEqual(["discovered", "shortlisted", "preparing", "applied"]);
    for (const s of APPLIED_STATUSES) expect(STATUSES).toContain(s);
    for (const s of CLOSED_STATUSES) expect(TRANSITIONS[s].includes("offer")).toBe(false);
  });
});

describe("input schemas", () => {
  it("accept good input and default the status", () => {
    expect(createApplicationSchema.parse({ jobId: randomUUID() })).toMatchObject({
      status: "shortlisted",
      applied_on: null,
    });
  });
  it("reject unknown statuses, late starts, bad dates and bad ids", () => {
    expect(
      createApplicationSchema.safeParse({ jobId: randomUUID(), status: "offer" }).success,
    ).toBe(false);
    expect(createApplicationSchema.safeParse({ jobId: "x" }).success).toBe(false);
    expect(
      createApplicationSchema.safeParse({
        jobId: randomUUID(),
        status: "applied",
        applied_on: "yesterday",
      }).success,
    ).toBe(false);
    expect(changeStatusSchema.safeParse({ id: randomUUID(), status: "hired" }).success).toBe(false);
    expect(
      changeStatusSchema.safeParse({ id: randomUUID(), status: "applied", on: "2026-13-45" })
        .success,
    ).toBe(false);
  });
  it("clean notes: control characters out, blanks become null, long ones rejected", () => {
    expect(
      changeStatusSchema.parse({ id: randomUUID(), status: "applied", note: "  hi\u0000 there  " })
        .note,
    ).toBe("hi there");
    expect(
      changeStatusSchema.parse({ id: randomUUID(), status: "applied", note: "   " }).note,
    ).toBeNull();
    expect(
      changeStatusSchema.safeParse({ id: randomUUID(), status: "applied", note: "x".repeat(1001) })
        .success,
    ).toBe(false);
    expect(
      updateDetailsSchema.safeParse({ id: randomUUID(), notes: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(
      addEventSchema.safeParse({ id: randomUUID(), kind: "status_changed", note: "x" }).success,
    ).toBe(false);
  });
});

describe("MemoryApplicationStore", () => {
  it("starts an application and logs it", async () => {
    const s = store();
    const app = await s.create("u", input(1));
    expect(app).toMatchObject({
      status: "shortlisted",
      appliedOn: null,
      isDemo: false,
      jobTitle: "Role 1",
    });
    const got = await s.get("u", app.id);
    expect(got!.events.map((e) => `${e.kind}:${e.fromStatus}>${e.toStatus}`)).toEqual([
      "created:null>shortlisted",
    ]);
  });

  it("keeps one application per job, per visitor", async () => {
    const s = store();
    await s.create("a", input(1));
    await expect(s.create("a", input(1))).rejects.toMatchObject({ kind: "duplicate" });
    await expect(s.create("b", input(1))).resolves.toBeTruthy();
    expect((await s.getByJob("a", input(1).jobId))?.jobTitle).toBe("Role 1");
    expect(await s.getByJob("b", "00000000-0000-4000-8000-0000000000ff")).toBeNull();
  });

  it("dates an applied start, and refuses a date far in the future", async () => {
    const s = store();
    expect((await s.create("u", input(1, { status: "applied" }))).appliedOn).toBe("2026-10-07");
    expect(
      (await s.create("u", input(2, { status: "applied", appliedOn: "2026-10-01" }))).appliedOn,
    ).toBe("2026-10-01");
    await expect(
      s.create("u", input(3, { status: "applied", appliedOn: "2999-01-01" })),
    ).rejects.toBeInstanceOf(ApplicationStoreError);
  });

  it("moves only along allowed transitions and logs each move", async () => {
    const s = store();
    const app = await s.create("u", input(1));
    expect(await s.changeStatus("u", app.id, "offer", null, null)).toBe("not_allowed");
    expect(await s.changeStatus("u", app.id, "applied", "Submitted", "2026-10-02")).toBe("moved");
    expect(await s.changeStatus("u", app.id, "interview", null, "2020-01-01")).toBe("moved");
    const got = (await s.get("u", app.id))!;
    expect(got.application).toMatchObject({ status: "interview", appliedOn: "2026-10-02" });
    expect(got.events.map((e) => `${e.kind}:${e.fromStatus}>${e.toStatus}:${e.note}`)).toEqual([
      "created:null>shortlisted:null",
      "status_changed:shortlisted>applied:Submitted",
      "status_changed:applied>interview:null",
    ]);
    expect(await s.changeStatus("u", "missing", "applied", null, null)).toBe("not_found");
  });

  it("allows every move the table allows and no other, from every status", async () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const s = store();
        const app = await s.create("u", input(1));
        // Walk to `from` by the shortest legal path.
        const path = shortestPath("shortlisted", from);
        for (const step of path) await s.changeStatus("u", app.id, step, null, null);
        expect((await s.get("u", app.id))!.application.status).toBe(from);
        const outcome = await s.changeStatus("u", app.id, to, null, null);
        expect(outcome, `${from} to ${to}`).toBe(canMove(from, to) ? "moved" : "not_allowed");
      }
    }
  });

  it("keeps notes and follow-up dates, and logs changes to the date and documents", async () => {
    const s = store();
    const app = await s.create("u", input(1));
    const base = {
      notes: "Spoke to HR",
      followUpOn: "2026-10-20",
      resumeVersionId: null,
      coverLetterVersionId: null,
    };
    expect(await s.updateDetails("u", app.id, base)).toBe("updated");
    expect(await s.updateDetails("u", app.id, { ...base, resumeVersionId: randomUUID() })).toBe(
      "updated",
    );
    expect(
      await s.updateDetails("u", app.id, { ...base, resumeVersionId: null, followUpOn: null }),
    ).toBe("updated");
    const kinds = (await s.get("u", app.id))!.events.map((e) => `${e.kind}:${e.note}`);
    expect(kinds).toEqual([
      "created:null",
      "follow_up_set:2026-10-20",
      "documents_linked:null",
      // Clearing both at once logs the date first, then the documents, as the database does.
      "follow_up_set:cleared",
      "documents_linked:null",
    ]);
    expect(await s.updateDetails("u", "missing", base)).toBe("not_found");
  });

  it("adds notes and follow-up records by hand, and nothing else", async () => {
    const s = store();
    const app = await s.create("u", input(1));
    expect(await s.addEvent("u", app.id, "note", "Called back")).toBe("added");
    expect(await s.addEvent("u", app.id, "followed_up", null)).toBe("added");
    expect(await s.addEvent("u", app.id, "note", "  ")).toBe("invalid");
    expect(await s.addEvent("u", "missing", "note", "x")).toBe("not_found");
    expect(await s.addEvent("other", app.id, "note", "x")).toBe("not_found");
  });

  it("keeps each visitor separate, and returns copies", async () => {
    const s = store();
    const app = await s.create("a", input(1));
    expect(await s.get("b", app.id)).toBeNull();
    expect(await s.changeStatus("b", app.id, "applied", null, null)).toBe("not_found");
    expect(await s.remove("b", app.id)).toBe(false);
    const copy = (await s.list("a"))[0]!;
    copy.status = "offer";
    expect((await s.list("a"))[0]!.status).toBe("shortlisted");
  });

  it("deletes an application with its events, and stops at the limit", async () => {
    const s = store();
    const app = await s.create("u", input(1));
    expect(await s.remove("u", app.id)).toBe(true);
    expect(await s.get("u", app.id)).toBeNull();
    for (let n = 0; n < MAX_APPLICATIONS; n++) await s.create("u", input(1000 + n));
    await expect(s.create("u", input(5000))).rejects.toMatchObject({ kind: "limit" });
  });

  it("orders the most recently moved first", async () => {
    const s = store();
    const a = await s.create("u", input(1));
    clock = new Date("2026-10-08T12:00:00Z");
    const b = await s.create("u", input(2));
    expect((await s.list("u")).map((x) => x.id)).toEqual([b.id, a.id]);
    clock = new Date("2026-10-09T12:00:00Z");
    await s.changeStatus("u", a.id, "applied", null, null);
    expect((await s.list("u")).map((x) => x.id)).toEqual([a.id, b.id]);
    clock = new Date("2026-10-07T12:00:00Z");
  });
});

function shortestPath(from: Status, to: Status): Status[] {
  if (from === to) return [];
  const prev = new Map<Status, Status>();
  const queue: Status[] = [from];
  const seen = new Set<Status>([from]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of TRANSITIONS[cur]) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      if (next === to) {
        const path: Status[] = [];
        for (let at: Status | undefined = to; at && at !== from; at = prev.get(at))
          path.unshift(at);
        return path;
      }
      queue.push(next);
    }
  }
  throw new Error(`no path ${from} to ${to}`);
}

describe("sample applications", () => {
  const now = new Date("2026-10-07T12:00:00Z");

  it("attach to real demo jobs, and every path is a legal run through the pipeline", () => {
    const built = buildDemoApplications(jobs, now, randomUUID);
    expect(built).toHaveLength(DEMO_APPLICATION_SAMPLES.length);
    for (const { application, events } of built) {
      expect(application.isDemo).toBe(true);
      let status: Status | null = null;
      for (const e of events) {
        if (e.kind === "created") status = e.toStatus;
        else if (e.kind === "status_changed") {
          expect(
            canMove(e.fromStatus!, e.toStatus!),
            `${application.jobTitle}: ${e.fromStatus} to ${e.toStatus}`,
          ).toBe(true);
          expect(e.fromStatus).toBe(status);
          status = e.toStatus;
        }
      }
      expect(status).toBe(application.status);
      const times = events.map((e) => e.createdAt);
      expect([...times].sort()).toEqual(times);
      if (APPLIED_STATUSES.includes(application.status) || application.appliedOn) {
        expect(application.appliedOn).not.toBeNull();
      }
    }
  });

  it("show the whole pipeline's range, including one that is due for a follow-up", () => {
    const built = buildDemoApplications(jobs, now, randomUUID);
    expect(new Set(built.map((b) => b.application.status)).size).toBeGreaterThanOrEqual(4);
    const due = dueFollowUps(
      built.map((b) => b.application),
      built.flatMap((b) => b.events),
      now,
    );
    expect(
      due.map((d) => built.find((b) => b.application.id === d.applicationId)!.application.jobTitle),
    ).toEqual(["Backend Engineer"]);
  });

  it("are listed first in demo mode, can be cleared, and leave a visitor's own alone", async () => {
    const s = new MemoryApplicationStore({ loadDemoJobs: async () => jobs, now: () => now });
    const first = await s.list("u");
    expect(first.every((a) => a.isDemo)).toBe(true);
    expect(await s.hasDemo("u")).toBe(true);
    const own = await s.create("u", input(1));
    expect(await s.wipeDemo("u")).toBe(first.length);
    expect((await s.list("u")).map((a) => a.id)).toEqual([own.id]);
    expect(await s.hasDemo("u")).toBe(false);
    // Samples do not come back after a wipe, and other visitors still get their own.
    expect((await s.list("u")).every((a) => !a.isDemo)).toBe(true);
    expect((await s.list("other")).length).toBe(first.length);
  });

  it("block adding a duplicate of a sample job, so a person is told it is already tracked", async () => {
    const s = new MemoryApplicationStore({ loadDemoJobs: async () => jobs, now: () => now });
    const sample = (await s.list("u"))[0]!;
    await expect(s.create("u", input(1, { jobId: sample.jobId }))).rejects.toMatchObject({
      kind: "duplicate",
    });
  });
});

function app(over: Partial<Application> = {}): Application {
  return {
    id: "a1",
    jobId: "j1",
    jobTitle: "Role",
    companyName: "Acme",
    status: "applied",
    appliedOn: "2026-09-25",
    followUpOn: null,
    notes: null,
    resumeVersionId: null,
    coverLetterVersionId: null,
    statusChangedAt: "2026-09-30T09:00:00Z",
    createdAt: "2026-09-20T09:00:00Z",
    updatedAt: "2026-09-30T09:00:00Z",
    isDemo: false,
    ...over,
  };
}
const ev = (
  kind: ApplicationEvent["kind"],
  at: string,
  over: Partial<ApplicationEvent> = {},
): ApplicationEvent => ({
  id: randomUUID(),
  applicationId: "a1",
  kind,
  fromStatus: null,
  toStatus: kind === "created" || kind === "status_changed" ? "applied" : null,
  note: null,
  createdAt: at,
  ...over,
});
const NOW = new Date("2026-10-07T10:00:00Z");

describe("the follow-up engine", () => {
  it("measures whole days between dates, never negative", () => {
    expect(daysSince("2026-10-07T23:59:00Z", NOW)).toBe(0);
    expect(daysSince("2026-10-06T00:01:00Z", NOW)).toBe(1);
    expect(daysSince("2026-10-20T00:00:00Z", NOW)).toBe(0);
  });

  it("flags an awaited application after a quiet week", () => {
    const f = followUpFor(app(), [ev("status_changed", "2026-09-30T09:00:00Z")], NOW);
    expect(f).toMatchObject({ reason: "quiet", quietDays: 7, dueOn: "2026-10-07" });
  });

  it("does not flag it sooner, or once the person has followed up", () => {
    expect(
      followUpFor(
        app({ statusChangedAt: "2026-10-02T09:00:00Z" }),
        [ev("status_changed", "2026-10-02T09:00:00Z")],
        NOW,
      ),
    ).toBeNull();
    expect(
      followUpFor(
        app(),
        [ev("status_changed", "2026-09-30T09:00:00Z"), ev("followed_up", "2026-10-05T09:00:00Z")],
        NOW,
      ),
    ).toBeNull();
  });

  it("does not count the person's own notes as activity", () => {
    const f = followUpFor(
      app(),
      [ev("status_changed", "2026-09-30T09:00:00Z"), ev("note", "2026-10-06T09:00:00Z")],
      NOW,
    );
    expect(f?.reason).toBe("quiet");
  });

  it("ignores applications that are not awaiting a reply", () => {
    for (const status of [
      "discovered",
      "shortlisted",
      "preparing",
      "final_round",
      "offer",
      "rejected",
      "withdrawn",
      "no_response",
    ] as const) {
      expect(
        followUpFor(app({ status }), [ev("status_changed", "2026-09-01T09:00:00Z")], NOW),
        status,
      ).toBeNull();
    }
    for (const status of ["applied", "assessment", "interview"] as const) {
      expect(
        followUpFor(app({ status }), [ev("status_changed", "2026-09-01T09:00:00Z")], NOW),
        status,
      ).not.toBeNull();
    }
  });

  it("uses the person's own date when one is set", () => {
    const events = [ev("status_changed", "2026-09-30T09:00:00Z")];
    expect(followUpFor(app({ followUpOn: "2026-10-20" }), events, NOW)).toBeNull();
    expect(followUpFor(app({ followUpOn: "2026-10-05" }), events, NOW)).toMatchObject({
      reason: "scheduled",
      dueOn: "2026-10-05",
    });
    expect(
      followUpFor(
        app({ followUpOn: "2026-10-05" }),
        [...events, ev("followed_up", "2026-10-06T09:00:00Z")],
        NOW,
      ),
    ).toBeNull();
    // A follow-up recorded before the date does not satisfy it.
    expect(
      followUpFor(
        app({ followUpOn: "2026-10-05" }),
        [...events, ev("followed_up", "2026-10-01T09:00:00Z")],
        NOW,
      ),
    ).not.toBeNull();
  });

  it("honours a different quiet period and orders by how long things have been quiet", () => {
    const quiet = app({ id: "q", statusChangedAt: "2026-09-20T00:00:00Z" });
    const recent = app({ id: "r", statusChangedAt: "2026-10-01T00:00:00Z" });
    const events = [
      ev("status_changed", "2026-09-20T00:00:00Z", { applicationId: "q" }),
      ev("status_changed", "2026-10-01T00:00:00Z", { applicationId: "r" }),
    ];
    expect(dueFollowUps([recent, quiet], events, NOW).map((d) => d.applicationId)).toEqual(["q"]);
    expect(dueFollowUps([recent, quiet], events, NOW, 3).map((d) => d.applicationId)).toEqual([
      "q",
      "r",
    ]);
  });
});

describe("summaries and wording", () => {
  it("counts the pipeline by status", () => {
    const s = summarize([
      app(),
      app({ id: "b", status: "offer" }),
      app({ id: "c", status: "rejected" }),
      app({ id: "d", status: "shortlisted" }),
    ]);
    expect(s).toMatchObject({ total: 4, active: 2, closed: 1 });
    expect(s.counts.applied).toBe(1);
    expect(Object.keys(s.counts)).toEqual([...STATUSES]);
  });

  it("describes every kind of event", () => {
    const base = { fromStatus: null, toStatus: null, note: null } as const;
    expect(describeEvent({ kind: "created", ...base, toStatus: "shortlisted" })).toBe(
      "Added to your pipeline as Shortlisted.",
    );
    expect(
      describeEvent({
        kind: "status_changed",
        ...base,
        fromStatus: "applied",
        toStatus: "interview",
      }),
    ).toBe("Moved from Applied to Interview.");
    expect(describeEvent({ kind: "note", ...base })).toBe("You added a note.");
    expect(describeEvent({ kind: "followed_up", ...base })).toBe(
      "You recorded that you followed up.",
    );
    expect(describeEvent({ kind: "follow_up_set", ...base, note: "2026-10-20" })).toBe(
      "You set a follow-up date for 2026-10-20.",
    );
    expect(describeEvent({ kind: "follow_up_set", ...base, note: "cleared" })).toBe(
      "You cleared the follow-up date.",
    );
    expect(describeEvent({ kind: "documents_linked", ...base })).toContain("documents");
  });
});
