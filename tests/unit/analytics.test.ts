// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Application, ApplicationEvent } from "@/db/applications/store";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { DEMO_PERSONAS } from "@/db/seed/demo-personas";
import { MIN_APPLIED_FOR_ANALYSIS } from "@/lib/analytics/types";
import type { Status } from "@/lib/applications/types";
import { DEFAULT_JOB_QUERY, type Job } from "@/lib/jobs/schemas";
import type { MatchResult } from "@/lib/matching/types";
import { breakdownByResume, breakdownByStrength } from "@/services/analytics/breakdowns";
import { computeFunnel, hasApplied, reachedStatuses } from "@/services/analytics/funnel";
import { analyzeGaps } from "@/services/analytics/gaps";
import { analyzeInterviews, type InsightInput } from "@/services/analytics/insights";
import { computeReadiness } from "@/services/analytics/readiness";
import { scoreJob } from "@/services/matching/score";
import { buildCandidate } from "@/services/matching/candidate";
import { NOW, makeJob, snapshotFrom } from "../fixtures/matching";

const day = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * day).toISOString();

interface Built {
  app: Application;
  events: ApplicationEvent[];
}

/** An application with a consistent history: [status, days ago it happened], oldest first. */
function build(
  title: string,
  history: [Status, number][],
  over: Partial<Application> = {},
  extra: { kind: ApplicationEvent["kind"]; daysAgo: number }[] = [],
): Built {
  const id = randomUUID();
  const events: ApplicationEvent[] = history.map(([to, d], i) => ({
    id: randomUUID(),
    applicationId: id,
    kind: i === 0 ? "created" : "status_changed",
    fromStatus: i === 0 ? null : history[i - 1]![0],
    toStatus: to,
    note: null,
    createdAt: ago(d),
  }));
  for (const x of extra) {
    events.push({
      id: randomUUID(),
      applicationId: id,
      kind: x.kind,
      fromStatus: null,
      toStatus: null,
      note: null,
      createdAt: ago(x.daysAgo),
    });
  }
  const last = history.at(-1)!;
  const appliedStep = history.find(([s]) => s === "applied");
  return {
    events,
    app: {
      id,
      jobId: randomUUID(),
      jobTitle: title,
      companyName: "Acme",
      status: last[0],
      appliedOn: appliedStep ? ago(appliedStep[1]).slice(0, 10) : null,
      followUpOn: null,
      notes: null,
      resumeVersionId: null,
      coverLetterVersionId: null,
      statusChangedAt: ago(last[1]),
      createdAt: ago(history[0]![1]),
      updatedAt: ago(last[1]),
      isDemo: false,
      ...over,
    },
  };
}

const parts = (list: Built[]) => ({
  apps: list.map((b) => b.app),
  events: list.flatMap((b) => b.events),
});

describe("the funnel", () => {
  it("counts every stage an application reached, not just where it is now", () => {
    const a = build("A", [
      ["shortlisted", 30],
      ["applied", 28],
      ["interview", 20],
      ["rejected", 10],
    ]);
    const { apps, events } = parts([a]);
    expect([...reachedStatuses(apps[0]!, events)].sort()).toEqual([
      "applied",
      "interview",
      "rejected",
      "shortlisted",
    ]);
    const f = computeFunnel(apps, events, NOW);
    expect(f.stages.map((s) => s.reached)).toEqual([1, 0, 1, 0, 0]);
    expect(f.rejected).toBe(1);
  });

  it("does not count applications that were never applied", () => {
    const a = build("A", [["shortlisted", 5]]);
    const b = build("B", [
      ["discovered", 3],
      ["shortlisted", 2],
      ["preparing", 1],
    ]);
    const { apps, events } = parts([a, b]);
    expect(hasApplied(apps[0]!, events)).toBe(false);
    expect(computeFunnel(apps, events, NOW).applied).toBe(0);
  });

  it("works out replies and interviews as 'n of m'", () => {
    const list = [
      build("Interview", [
        ["applied", 20],
        ["interview", 10],
      ]),
      build("Rejected", [
        ["applied", 20],
        ["rejected", 12],
      ]),
      build("Silent", [
        ["applied", 20],
        ["no_response", 2],
      ]),
      build("Offer", [
        ["applied", 40],
        ["interview", 30],
        ["final_round", 20],
        ["offer", 10],
      ]),
    ];
    const { apps, events } = parts(list);
    const f = computeFunnel(apps, events, NOW);
    expect(f.applied).toBe(4);
    expect(f.heardBack).toMatchObject({ n: 3, of: 4, pct: 75, small: true });
    expect(f.interviewed).toMatchObject({ n: 2, of: 4, pct: 50 });
    expect(f.offers).toMatchObject({ n: 1, of: 4 });
    expect(f.offerAfterInterview).toMatchObject({ n: 1, of: 2 });
    expect(f.noResponse).toBe(1);
  });

  it("measures the median days from applying to the first reply", () => {
    const list = [
      build("A", [
        ["applied", 20],
        ["rejected", 15],
      ]), // 5 days
      build("B", [
        ["applied", 20],
        ["interview", 10],
      ]), // 10 days
      build("C", [
        ["applied", 20],
        ["interview", 6],
      ]), // 14 days
      build("D", [["applied", 20]]), // no reply
    ];
    const { apps, events } = parts(list);
    expect(computeFunnel(apps, events, NOW).medianDaysToResponse).toBe(10);
    expect(computeFunnel([], [], NOW).medianDaysToResponse).toBeNull();
  });

  it("separates applications still waiting from those that are young", () => {
    const list = [
      build("Young", [["applied", 3]]),
      build("Old", [["applied", 25]]),
      build("Answered", [
        ["applied", 25],
        ["interview", 5],
      ]),
    ];
    const { apps, events } = parts(list);
    expect(computeFunnel(apps, events, NOW).awaiting).toEqual({ total: 2, young: 1 });
  });

  it("counts applications per week, oldest first, for the last eight weeks", () => {
    const list = [
      build("A", [["applied", 1]]),
      build("B", [["applied", 2]]),
      build("C", [["applied", 40]]),
      build("D", [["applied", 400]]),
    ];
    const { apps, events } = parts(list);
    const weekly = computeFunnel(apps, events, NOW).weekly;
    expect(weekly).toHaveLength(8);
    expect(weekly.map((w) => w.weekStart)).toEqual([...weekly.map((w) => w.weekStart)].sort());
    expect(weekly.reduce((t, w) => t + w.applied, 0)).toBe(3);
    expect(weekly.at(-1)!.applied + weekly.at(-2)!.applied).toBe(2);
  });

  it("is empty and safe with no data", () => {
    const f = computeFunnel([], [], NOW);
    expect(f.applied).toBe(0);
    expect(f.heardBack).toMatchObject({ n: 0, of: 0, pct: null });
    expect(f.stages.every((s) => s.reached === 0)).toBe(true);
  });
});

function match(over: Partial<MatchResult> = {}): MatchResult {
  return {
    scorer_version: 1,
    strength: 50,
    label: "stretch",
    cap: { applied: false, reason: null },
    components: [],
    why: [],
    gaps: [],
    keywords: { covered: [], missing: [] },
    concerns: [],
    action: { kind: "close_gaps", text: "x" },
    ...over,
  } as MatchResult;
}

const missingSkill = (name: string) => ({
  kind: "required_skill" as const,
  severity: "high" as const,
  text: `${name} is required by this job but was not found in your verified profile. If you have genuinely used it, add the experience.`,
  suggestion: null,
});

function input(list: Built[], over: Partial<InsightInput> = {}): InsightInput {
  const { apps, events } = parts(list);
  return {
    now: NOW,
    applications: apps,
    events,
    matches: new Map(),
    completeness: 90,
    outreachSent: 1,
    ...over,
  };
}

/** Eight applied applications, none replied to, spread over two months. */
const quiet = () =>
  Array.from({ length: 8 }, (_, i) =>
    build(`Role ${i}`, [["applied", 20 + i * 5]], { resumeVersionId: randomUUID() }),
  );

describe("why am I not getting interviews", () => {
  it("says there is not enough to go on, and what can be said, below five applications", () => {
    const list = [
      build("A", [["applied", 10]]),
      build("B", [
        ["applied", 9],
        ["rejected", 2],
      ]),
      build("C", [["applied", 8]]),
    ];
    const out = analyzeInterviews(input(list));
    expect(out.state).toBe("not_enough_data");
    expect(out.headline).toBe("Not enough applications yet");
    expect(out.findings).toEqual([]);
    expect(out.observations[0]).toContain(`at least ${MIN_APPLIED_FOR_ANALYSIS} applications`);
    expect(out.observations.join(" ")).toContain("applied to 3 jobs");
  });

  it("offers a partial observation about a repeated gap even with few applications", () => {
    const list = [
      build("A", [["applied", 10]]),
      build("B", [["applied", 9]]),
      build("C", [["applied", 8]]),
    ];
    const matches = new Map(list.map((b) => [b.app.id, match({ gaps: [missingSkill("Docker")] })]));
    const out = analyzeInterviews(input(list, { matches }));
    expect(out.observations.join(" ")).toContain("So far, Docker was asked for by 3 of 3");
  });

  it("finds nothing to say about a person with no applications", () => {
    const out = analyzeInterviews(input([]));
    expect(out.state).toBe("not_enough_data");
    expect(out.funnel.applied).toBe(0);
  });

  it("reports jobs that were a stretch on paper, with the evidence and a caveat about when strength was measured", () => {
    const list = quiet();
    const matches = new Map(
      list.map((b, i) => [
        b.app.id,
        match({ strength: 40 + i, label: i < 6 ? "stretch" : "good" }),
      ]),
    );
    const out = analyzeInterviews(input(list, { matches }));
    const f = out.findings.find((x) => x.id === "low_strength")!;
    expect(f.statement).toContain("6 of 8");
    expect(f.evidence.join(" ")).toContain("Median Application Strength");
    expect(f.evidence.join(" ")).toContain("as it is today");
    expect(f.href).toBe("/matches");
  });

  it("does not report a stretch when most jobs were a good fit", () => {
    const list = quiet();
    const matches = new Map(list.map((b) => [b.app.id, match({ strength: 80, label: "strong" })]));
    expect(analyzeInterviews(input(list, { matches })).findings.map((f) => f.id)).not.toContain(
      "low_strength",
    );
  });

  it("names a required skill missing across many applications, but not a one-off", () => {
    const list = quiet();
    const matches = new Map(
      list.map((b, i) => [
        b.app.id,
        match({
          label: "good",
          gaps: [
            ...(i < 5 ? [missingSkill("Docker")] : []),
            ...(i === 0 ? [missingSkill("Rust")] : []),
          ],
        }),
      ]),
    );
    const f = analyzeInterviews(input(list, { matches })).findings.find(
      (x) => x.id === "repeated_gap",
    )!;
    expect(f.statement).toContain("Docker");
    expect(f.statement).not.toContain("Rust");
    expect(f.evidence[0]).toBe("Docker: required by 5 of 8 of the jobs you applied to.");
    expect(f.evidence.join(" ")).toContain(
      "If you have genuinely used one of these, add the experience",
    );
  });

  it("reads a skill that is only in an unconfirmed item as still missing", () => {
    const list = quiet();
    const pending = {
      kind: "required_skill" as const,
      severity: "high" as const,
      text: "Docker appears in an unconfirmed item from your resume. Review and confirm it to count it.",
      suggestion: null,
    };
    const matches = new Map(list.map((b) => [b.app.id, match({ label: "good", gaps: [pending] })]));
    expect(
      analyzeInterviews(input(list, { matches })).findings.find((x) => x.id === "repeated_gap")!
        .statement,
    ).toContain("Docker");
  });

  it("flags roles that asked for more experience or a higher level", () => {
    const list = quiet();
    const gap = {
      kind: "experience" as const,
      severity: "high" as const,
      text: "The job asks for about 3 years; your verified roles add up to about 0.3 years.",
      suggestion: null,
    };
    const matches = new Map(
      list.map((b, i) => [b.app.id, match({ label: "good", gaps: i < 4 ? [gap] : [] })]),
    );
    const f = analyzeInterviews(input(list, { matches })).findings.find(
      (x) => x.id === "level_stretch",
    )!;
    expect(f.statement).toContain("4 of 8");
  });

  it("notices when few applications carry a tailored resume, and when most do", () => {
    const untailored = Array.from({ length: 6 }, (_, i) => build(`R${i}`, [["applied", 20 + i]]));
    expect(analyzeInterviews(input(untailored)).findings.map((f) => f.id)).toContain(
      "no_tailoring",
    );
    expect(analyzeInterviews(input(quiet())).findings.map((f) => f.id)).not.toContain(
      "no_tailoring",
    );
  });

  it("notices a low number of recent applications", () => {
    const f = analyzeInterviews(input(quiet())).findings.find((x) => x.id === "low_volume")!;
    expect(f.statement).toContain("3 applications in the last 30 days");
  });

  it("notices a thin profile and missing outreach, and stays quiet when both are fine", () => {
    const list = quiet();
    const ids = (o: Partial<InsightInput>) =>
      analyzeInterviews(input(list, o)).findings.map((f) => f.id);
    expect(ids({ completeness: 40, outreachSent: 0 })).toEqual(
      expect.arrayContaining(["profile_incomplete", "no_outreach"]),
    );
    expect(ids({ completeness: 90, outreachSent: 2 })).not.toEqual(
      expect.arrayContaining(["profile_incomplete", "no_outreach"]),
    );
    expect(ids({ completeness: null })).not.toContain("profile_incomplete");
  });

  it("notices waiting applications nobody followed up on, but not ones that were", () => {
    const followed = quiet().map((b) => ({
      ...b,
      events: [
        ...b.events,
        {
          id: randomUUID(),
          applicationId: b.app.id,
          kind: "followed_up" as const,
          fromStatus: null,
          toStatus: null,
          note: null,
          createdAt: ago(3),
        },
      ],
    }));
    expect(analyzeInterviews(input(quiet())).findings.map((f) => f.id)).toContain("no_follow_up");
    expect(analyzeInterviews(input(followed)).findings.map((f) => f.id)).not.toContain(
      "no_follow_up",
    );
  });

  it("tempers the findings when waiting applications are too new to judge", () => {
    const young = Array.from({ length: 6 }, (_, i) => build(`Y${i}`, [["applied", 2 + i]]));
    const out = analyzeInterviews(input(young));
    expect(out.caveats.join(" ")).toContain("sent less than 14 days ago");
  });

  it("recognises healthy results and keeps its suggestions short", () => {
    const list = [
      ...Array.from({ length: 3 }, (_, i) =>
        build(
          `I${i}`,
          [
            ["applied", 30],
            ["interview", 15 - i],
          ],
          { resumeVersionId: null },
        ),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        build(`S${i}`, [["applied", 30]], { resumeVersionId: null }),
      ),
    ];
    const out = analyzeInterviews(input(list, { outreachSent: 0, completeness: 30 }));
    expect(out.state).toBe("ready");
    expect(out.headline).toContain("You are getting interviews");
    expect(out.findings.length).toBeLessThanOrEqual(2);
  });

  it("has a different headline when no interview has come yet, and orders findings by signal", () => {
    const list = quiet();
    const matches = new Map(
      list.map((b) => [
        b.app.id,
        match({ label: "low", strength: 30, gaps: [missingSkill("Docker")] }),
      ]),
    );
    const out = analyzeInterviews(input(list, { matches, completeness: 40, outreachSent: 0 }));
    expect(out.headline).toBe("No interviews from your applications yet");
    const weights = out.findings.map((f) => f.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it("only ever uses hedged wording, never a prediction, cause or odds", () => {
    const list = quiet();
    const matches = new Map(
      list.map((b) => [
        b.app.id,
        match({
          label: "low",
          strength: 30,
          gaps: [
            missingSkill("Docker"),
            { kind: "seniority", severity: "high", text: "x", suggestion: null },
          ],
        }),
      ]),
    );
    const out = analyzeInterviews(input(list, { matches, completeness: 40, outreachSent: 0 }));
    expect(out.findings.length).toBeGreaterThanOrEqual(6);
    for (const f of out.findings) {
      expect(f.statement, f.id).toMatch(/\b(may|might|could|likely contributing|sometimes)\b/);
      expect(f.evidence.length, f.id).toBeGreaterThan(0);
      expect(f.suggestion.length, f.id).toBeGreaterThan(0);
    }
    const all = JSON.stringify(out);
    expect(all).not.toMatch(
      /probab|odds of|you will (get|be)|guarantee(d)? (an |to )|definitely|because of this you/i,
    );
    expect(out.caveats.at(-1)).toContain("patterns in what you recorded, not causes");
  });

  it("is deterministic", () => {
    const list = quiet();
    expect(analyzeInterviews(input(list))).toEqual(analyzeInterviews(input(list)));
  });
});

describe("breakdowns", () => {
  it("compares replies by how well the job fitted, and by resume", () => {
    const list = [
      build(
        "A",
        [
          ["applied", 20],
          ["interview", 10],
        ],
        { resumeVersionId: randomUUID() },
      ),
      build("B", [["applied", 20]], { resumeVersionId: randomUUID() }),
      build("C", [
        ["applied", 20],
        ["rejected", 9],
      ]),
      build("D", [["applied", 20]]),
      build("E", [["shortlisted", 20]]),
    ];
    const { apps, events } = parts(list);
    const matches = new Map([
      [apps[0]!.id, match({ label: "strong" })],
      [apps[1]!.id, match({ label: "strong" })],
      [apps[2]!.id, match({ label: "low" })],
      [apps[3]!.id, match({ label: "low" })],
      [apps[4]!.id, match({ label: "strong" })],
    ]);
    expect(breakdownByStrength(apps, events, matches)).toEqual([
      { id: "strong", label: "Strong", applied: 2, heardBack: 1, interviewed: 1 },
      { id: "low", label: "Low", applied: 2, heardBack: 1, interviewed: 0 },
    ]);
    expect(breakdownByResume(apps, events)).toEqual([
      { id: "tailored", label: "Resume version linked", applied: 2, heardBack: 1, interviewed: 1 },
      { id: "none", label: "No resume linked", applied: 2, heardBack: 1, interviewed: 0 },
    ]);
  });
});

describe("readiness", () => {
  it("combines what can be measured and shows the evidence for each part", () => {
    const r = computeReadiness({
      completeness: 80,
      resumeHealth: 60,
      goodMatches: { n: 5, of: 10 },
    });
    expect(r.score).toBe(Math.round((40 * 80 + 30 * 60 + 30 * 50) / 100));
    expect(r.parts.map((p) => p.id)).toEqual(["profile", "resume", "matches"]);
    for (const p of r.parts) expect(p.evidence.length).toBeGreaterThan(0);
  });
  it("leaves out a part it cannot measure instead of guessing", () => {
    const r = computeReadiness({ completeness: 80, resumeHealth: null, goodMatches: null });
    expect(r.score).toBe(80);
    expect(r.parts.find((p) => p.id === "resume")!.value).toBeNull();
    expect(
      computeReadiness({ completeness: null, resumeHealth: null, goodMatches: { n: 0, of: 0 } })
        .score,
    ).toBeNull();
  });
});

describe("career gaps", () => {
  const jobs: Job[] = [];
  beforeAll(async () => {
    const store = new MemoryJobStore();
    for (let page = 1; page <= 3; page++)
      jobs.push(...(await store.search("x", { ...DEFAULT_JOB_QUERY, page })).jobs);
  });
  const persona = (id: string) => new MemoryProfileStore(id).getSnapshot("u");

  it("asks for a profile before it can say anything, and says when there are no jobs", async () => {
    expect(analyzeGaps(await snapshotFrom({}), jobs, NOW).state).toBe("needs_profile");
    expect(analyzeGaps(await persona("asha"), [], NOW).state).toBe("no_jobs");
  });

  it("ranks the skills by the Application Strength they would add, and shows which jobs gain", async () => {
    const out = analyzeGaps(await persona("asha"), jobs, NOW);
    expect(out.state).toBe("ready");
    expect(out.priorities.length).toBeGreaterThan(0);
    const gains = out.priorities.map((p) => p.totalGain);
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);
    for (const p of out.priorities) {
      expect(p.jobs.length).toBeGreaterThan(0);
      expect(p.jobs.every((j) => j.gain > 0)).toBe(true);
      expect(p.totalGain).toBe(p.jobs.reduce((t, j) => t + j.gain, 0));
      expect(p.requiredIn + p.preferredIn).toBeGreaterThanOrEqual(p.jobs.length);
    }
    expect(out.priorities.map((p) => p.skill)).toContain("Docker");
  });

  it("measures the gain truthfully: re-scoring the real profile with the skill added gives the stated gain", async () => {
    const snap = await persona("asha");
    const out = analyzeGaps(snap, jobs, NOW);
    const top = out.priorities[0]!;
    const withSkill = {
      ...snap,
      skills: [
        ...snap.skills,
        {
          ...snap.skills[0]!,
          id: "x",
          name: top.skill,
          level: "intermediate" as const,
          confirmed: true,
          source: "manual" as const,
        },
      ],
    };
    const before = buildCandidate(snap, NOW);
    const after = buildCandidate(withSkill, NOW);
    const job = jobs.find((j) => j.id === top.jobs[0]!.id)!;
    expect(scoreJob(job, after).strength - scoreJob(job, before).strength).toBe(top.jobs[0]!.gain);
  });

  it("never changes the profile it was given", async () => {
    const snap = await persona("asha");
    const copy = structuredClone(snap);
    analyzeGaps(snap, jobs, NOW);
    expect(snap).toEqual(copy);
  });

  it("does not count a skill that is only in an unconfirmed item as owned", async () => {
    const snap = await snapshotFrom({
      skills: [
        ["Python", "advanced"],
        ["Docker", "advanced", false],
      ],
    });
    const out = analyzeGaps(snap, [makeJob({ required_skills: ["Python", "Docker", "SQL"] })], NOW);
    expect(out.priorities.map((p) => p.skill)).toContain("Docker");
  });

  it("does not suggest a skill the person already has", async () => {
    const snap = await snapshotFrom({
      skills: [
        ["Python", "advanced"],
        ["Docker", "advanced"],
      ],
    });
    const out = analyzeGaps(snap, [makeJob({ required_skills: ["Python", "Docker", "SQL"] })], NOW);
    expect(out.priorities.map((p) => p.skill)).toEqual(["SQL"]);
  });

  it("lists weak skills, strengths and the experience asked for", async () => {
    const snap = await snapshotFrom({
      skills: [
        ["Python", "beginner"],
        ["SQL", "advanced"],
      ],
    });
    const many = [1, 2, 3].map((n) =>
      makeJob({ title: `Role ${n}`, required_skills: ["Python", "SQL"], min_years: 3 }),
    );
    const out = analyzeGaps(snap, many, NOW);
    expect(out.weak).toEqual([{ skill: "Python", requiredIn: 3 }]);
    expect(out.strengths.map((s) => s.skill)).toEqual(expect.arrayContaining(["SQL", "Python"]));
    expect(out.experience).toMatchObject({ jobsAskingMore: 3, typicalYears: 3 });
  });

  it("looks at no more than 30 jobs, and is deterministic for every persona", async () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      makeJob({ title: `Role ${i}`, required_skills: ["Python", "Docker"] }),
    );
    expect(analyzeGaps(await persona("asha"), many, NOW).jobCount).toBe(30);
    for (const p of DEMO_PERSONAS) {
      const snap = await persona(p.id);
      expect(analyzeGaps(snap, jobs, NOW)).toEqual(analyzeGaps(snap, jobs, NOW));
    }
  });

  it("marks the skills it has practice questions for", async () => {
    const out = analyzeGaps(await persona("asha"), jobs, NOW);
    expect(out.priorities.find((p) => p.skill === "Docker")?.canPractise).toBe(true);
  });
});
