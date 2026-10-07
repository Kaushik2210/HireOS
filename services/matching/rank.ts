import type { JobStore } from "@/db/jobs/store";
import { DEFAULT_JOB_QUERY, type Job } from "@/lib/jobs/schemas";
import type { MatchResult } from "@/lib/matching/types";
import type { Candidate } from "@/services/matching/candidate";
import { scoreJob } from "@/services/matching/score";

/** Most jobs ranked at once. Scoring is cheap, but the list a person can act on is not long. */
export const MAX_RANKED_JOBS = 500;

export interface RankedJob {
  job: Job;
  match: MatchResult;
}

/** Every job visible to the user, up to the cap, read page by page from the store. */
export async function listVisibleJobs(
  store: JobStore,
  userId: string,
  limit = MAX_RANKED_JOBS,
): Promise<Job[]> {
  const jobs: Job[] = [];
  for (let page = 1; jobs.length < limit; page++) {
    const result = await store.search(userId, { ...DEFAULT_JOB_QUERY, page });
    jobs.push(...result.jobs);
    if (page >= result.pageCount) break;
  }
  return jobs.slice(0, limit);
}

/** Scores every job and orders them best first; ties break by title so the order is stable. */
export function rankJobs(jobs: Job[], candidate: Candidate): RankedJob[] {
  return jobs
    .map((job) => ({ job, match: scoreJob(job, candidate) }))
    .sort(
      (a, b) =>
        b.match.strength - a.match.strength ||
        a.job.title.localeCompare(b.job.title) ||
        a.job.id.localeCompare(b.job.id),
    );
}
