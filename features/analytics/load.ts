import { getApplicationStore } from "@/db/applications";
import type { Application, ApplicationEvent } from "@/db/applications/store";
import { getJobStore } from "@/db/jobs";
import { getOutreachStore } from "@/db/outreach";
import { getPracticeStore } from "@/db/practice";
import type { PracticeSession } from "@/db/practice/store";
import { getProfileStore } from "@/db/profile";
import type { ProfileSnapshot } from "@/db/profile/store";
import { getResumeStore } from "@/db/resume";
import type { AuthUser } from "@/lib/auth/session";
import type { Job } from "@/lib/jobs/schemas";
import { MAX_GAP_JOBS } from "@/lib/analytics/types";
import type { MatchResult } from "@/lib/matching/types";
import { breakdownByResume, breakdownByStrength } from "@/services/analytics/breakdowns";
import { analyzeGaps, type GapAnalysis } from "@/services/analytics/gaps";
import { analyzeInterviews, type Insights } from "@/services/analytics/insights";
import { computeReadiness, type Readiness } from "@/services/analytics/readiness";
import { buildCandidate } from "@/services/matching/candidate";
import { listVisibleJobs, rankJobs } from "@/services/matching/rank";
import { canScore, scoreJob } from "@/services/matching/score";
import { computeCompleteness } from "@/services/profile/completeness";

/** Most tracked applications whose jobs are read back to score them. */
const MAX_TRACKED_JOBS = 150;

export interface AnalyticsData {
  now: Date;
  applications: Application[];
  events: ApplicationEvent[];
  snapshot: ProfileSnapshot;
  /** True when some of the applications are the demo sandbox's samples. */
  hasSamples: boolean;
  insights: Insights;
  byStrength: ReturnType<typeof breakdownByStrength>;
  byResume: ReturnType<typeof breakdownByResume>;
  readiness: Readiness;
  practice: PracticeSession[];
  outreachSent: number;
  /** Jobs behind the gap analysis and the readiness fit, strongest matches first. */
  rankedJobs: Job[];
  trackedJobs: Job[];
  matches: Map<string, MatchResult>;
}

/** Everything the analytics pages need, read once. Each store is read through the user's own client. */
export async function loadAnalytics(
  user: AuthUser,
  now: Date = new Date(),
): Promise<AnalyticsData> {
  const [appStore, jobStore, profileStore] = await Promise.all([
    getApplicationStore(user),
    getJobStore(user),
    getProfileStore(user),
  ]);
  const [applications, events, snapshot] = await Promise.all([
    appStore.list(user.id),
    appStore.activity(user.id),
    profileStore.getSnapshot(user.id),
  ]);

  const [practice, outreach, resumes, visible] = await Promise.all([
    getPracticeStore(user).then((s) => s.list(user.id)),
    getOutreachStore(user).then((s) => s.list(user.id)),
    getResumeStore(user).then((s) => s.list(user.id)),
    listVisibleJobs(jobStore, user.id),
  ]);

  const candidate = buildCandidate(snapshot, now);
  const scoreable = canScore(candidate);

  // Score each tracked application's job against today's profile, using the jobs already read where possible.
  const known = new Map(visible.map((j) => [j.id, j]));
  const tracked = applications.filter((a) => a.jobId).slice(0, MAX_TRACKED_JOBS);
  const missing = [...new Set(tracked.map((a) => a.jobId!).filter((id) => !known.has(id)))];
  for (const job of await Promise.all(missing.map((id) => jobStore.get(user.id, id)))) {
    if (job) known.set(job.id, job);
  }
  const matches = new Map<string, MatchResult>();
  const trackedJobs: Job[] = [];
  if (scoreable) {
    for (const a of tracked) {
      const job = known.get(a.jobId!);
      if (!job) continue;
      matches.set(a.id, scoreJob(job, candidate));
      trackedJobs.push(job);
    }
  }

  const completeness = snapshot.profile ? computeCompleteness(snapshot).score : null;
  const outreachSent = outreach.filter((d) => d.status === "sent").length;
  const rankedAll = scoreable ? rankJobs(visible, candidate) : [];
  const top = rankedAll.slice(0, 10);

  return {
    now,
    applications,
    events,
    snapshot,
    hasSamples: applications.some((a) => a.isDemo),
    insights: analyzeInterviews({ now, applications, events, matches, completeness, outreachSent }),
    byStrength: breakdownByStrength(applications, events, matches),
    byResume: breakdownByResume(applications, events),
    readiness: computeReadiness({
      completeness,
      resumeHealth: resumes[0]?.health_score ?? null,
      goodMatches:
        top.length > 0
          ? {
              n: top.filter((r) => r.match.label === "strong" || r.match.label === "good").length,
              of: top.length,
            }
          : null,
    }),
    practice,
    outreachSent,
    rankedJobs: rankedAll.map((r) => r.job),
    trackedJobs,
    matches,
  };
}

/** Which jobs the gap analysis looks at: the ones tracked, then the best matches, up to the limit. */
export function gapTargets(data: Pick<AnalyticsData, "trackedJobs" | "rankedJobs">): Job[] {
  const seen = new Set<string>();
  const out: Job[] = [];
  for (const job of [...data.trackedJobs, ...data.rankedJobs]) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    out.push(job);
    if (out.length >= MAX_GAP_JOBS) break;
  }
  return out;
}

export function loadGapAnalysis(data: AnalyticsData): GapAnalysis {
  return analyzeGaps(data.snapshot, gapTargets(data), data.now);
}
