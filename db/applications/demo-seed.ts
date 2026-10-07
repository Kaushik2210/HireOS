import type { Application, ApplicationEvent } from "@/db/applications/store";
import type { Job } from "@/lib/jobs/schemas";
import type { EventKind, Status } from "@/lib/applications/types";

/**
 * Sample applications for demo mode, tied to fictional jobs in the demo catalogue and dated
 * relative to now. Every path is a legal run through the pipeline (a test checks this), and
 * one application is old enough to show the follow-up flag.
 */
interface Step {
  /** Days before now. */
  ago: number;
  to?: Status;
  kind?: EventKind;
  note?: string;
}

interface Sample {
  title: string;
  company: string;
  notes?: string;
  steps: Step[];
}

export const DEMO_APPLICATION_SAMPLES: readonly Sample[] = [
  {
    title: "Python Developer Intern",
    company: "Aurora Freight Tech",
    notes: "Mentioned in the posting: a short Python and SQL assessment.",
    steps: [
      { ago: 24, to: "shortlisted" },
      { ago: 23, to: "preparing" },
      { ago: 21, to: "applied" },
      { ago: 14, to: "assessment", note: "Online assessment link received." },
      { ago: 13, kind: "note", note: "Finished the assessment in about 50 minutes." },
      { ago: 6, to: "interview", note: "Phone screen booked." },
    ],
  },
  {
    title: "Backend Engineer",
    company: "Helix Ledger",
    steps: [
      { ago: 12, to: "discovered" },
      { ago: 11, to: "shortlisted" },
      { ago: 10, to: "preparing" },
      { ago: 9, to: "applied" },
    ],
  },
  {
    title: "Data Engineering Intern",
    company: "Helix Ledger",
    steps: [{ ago: 2, to: "shortlisted" }],
  },
  {
    title: "Full-Stack Developer",
    company: "Quillstone Software",
    steps: [
      { ago: 35, to: "shortlisted" },
      { ago: 33, to: "applied" },
      { ago: 18, to: "rejected", note: "Closed after the first screen." },
    ],
  },
  {
    title: "Junior Data Analyst",
    company: "Marlow & Finch",
    steps: [{ ago: 1, to: "discovered" }],
  },
];

const day = 86_400_000;

/** Builds the sample applications and their event logs for the jobs that exist. */
export function buildDemoApplications(
  jobs: readonly Job[],
  now: Date,
  newId: () => string,
): { application: Application; events: ApplicationEvent[] }[] {
  const out: { application: Application; events: ApplicationEvent[] }[] = [];
  for (const sample of DEMO_APPLICATION_SAMPLES) {
    const job = jobs.find((j) => j.title === sample.title && j.company_name === sample.company);
    if (!job) continue;
    const id = newId();
    const at = (ago: number) => new Date(now.getTime() - ago * day).toISOString();
    const events: ApplicationEvent[] = [];
    let status: Status | null = null;
    let appliedOn: string | null = null;
    let lastAt = at(sample.steps[0]!.ago);
    for (const [i, step] of sample.steps.entries()) {
      lastAt = at(step.ago);
      if (step.kind === "note") {
        events.push({
          id: newId(),
          applicationId: id,
          kind: "note",
          fromStatus: null,
          toStatus: null,
          note: step.note ?? null,
          createdAt: lastAt,
        });
        continue;
      }
      const to = step.to!;
      events.push({
        id: newId(),
        applicationId: id,
        kind: i === 0 ? "created" : "status_changed",
        fromStatus: i === 0 ? null : status,
        toStatus: to,
        note: step.note ?? null,
        createdAt: lastAt,
      });
      if (to === "applied") appliedOn = lastAt.slice(0, 10);
      status = to;
    }
    out.push({
      events,
      application: {
        id,
        jobId: job.id,
        jobTitle: job.title,
        companyName: job.company_name,
        status: status!,
        appliedOn,
        followUpOn: null,
        notes: sample.notes ?? null,
        resumeVersionId: null,
        coverLetterVersionId: null,
        statusChangedAt: events.filter((e) => e.kind !== "note").at(-1)!.createdAt,
        createdAt: at(sample.steps[0]!.ago),
        updatedAt: lastAt,
        isDemo: true,
      },
    });
  }
  return out;
}
