import type { ApplicationStore } from "@/db/applications/store";
import type { DocumentStore } from "@/db/documents/store";
import type { InterviewStore } from "@/db/interviews/store";
import type { JobStore } from "@/db/jobs/store";
import type { OutreachStore } from "@/db/outreach/store";
import type { PracticeStore } from "@/db/practice/store";
import type { ProfileStore } from "@/db/profile/store";
import type { ResumeStore } from "@/db/resume/store";
import { DEFAULT_JOB_QUERY } from "@/lib/jobs/schemas";

export interface ExportStores {
  profile: ProfileStore;
  resumes: ResumeStore;
  jobs: JobStore;
  documents: DocumentStore;
  outreach: OutreachStore;
  applications: ApplicationStore;
  interviews: InterviewStore;
  practice: PracticeStore;
}

export interface AccountExport {
  exported_at: string;
  format: "hireos-export-1";
  notes: string[];
  account: { id: string; email: string | null; demo: boolean };
  profile: unknown;
  resumes: unknown[];
  jobs_added_by_you: unknown[];
  documents: unknown[];
  outreach_drafts: unknown[];
  applications: unknown[];
  application_events: unknown[];
  interviews: unknown[];
  practice_sessions: unknown[];
  security_events: unknown[];
}

const NOTES = [
  "This file holds the data HireOS stores for this account.",
  "Original resume files are not inside it: download each one from the Resume page.",
  "Shared sample jobs, match scores and analytics are not included. They are shared or can be recomputed from the data here.",
];

/** Pages through the user's own jobs: the shared catalogue is not theirs to export. */
async function ownJobs(jobs: JobStore, userId: string) {
  const found: unknown[] = [];
  for (let page = 1; page <= 20; page++) {
    const result = await jobs.search(userId, { ...DEFAULT_JOB_QUERY, page });
    for (const job of result.jobs) if (job.owner_user_id === userId) found.push(job);
    if (page * result.pageSize >= result.total) break;
  }
  return found;
}

/**
 * Collects everything the person has stored, through their own stores, so the same Row Level
 * Security that limits every other read limits this one. Nothing is read with the service role.
 */
export async function buildAccountExport(
  user: { id: string; email: string | null; isDemo: boolean },
  stores: ExportStores,
  securityEvents: unknown[] = [],
  now: () => Date = () => new Date(),
): Promise<AccountExport> {
  const id = user.id;
  const [
    profile,
    resumes,
    jobs,
    documents,
    outreach,
    applications,
    events,
    interviews,
    practiceList,
  ] = await Promise.all([
    stores.profile.getSnapshot(id),
    stores.resumes.list(id),
    ownJobs(stores.jobs, id),
    stores.documents.list(id),
    stores.outreach.list(id),
    stores.applications.list(id),
    stores.applications.activity(id),
    stores.interviews.list(id),
    stores.practice.list(id),
  ]);

  const resumeRecords = (
    await Promise.all(resumes.map((r) => stores.resumes.get(id, r.id)))
  ).filter((r) => r !== null);
  const practice = (await Promise.all(practiceList.map((s) => stores.practice.get(id, s.id))))
    .filter((p) => p !== null)
    .map((p) => ({ ...p.session, answers: p.answers }));

  return {
    exported_at: now().toISOString(),
    format: "hireos-export-1",
    notes: user.isDemo
      ? [...NOTES, "This is demo data from a temporary sandbox, not a real account."]
      : NOTES,
    account: { id, email: user.email, demo: user.isDemo },
    profile,
    resumes: resumeRecords,
    jobs_added_by_you: jobs,
    documents,
    outreach_drafts: outreach,
    applications,
    application_events: events,
    interviews,
    practice_sessions: practice,
    security_events: securityEvents,
  };
}
