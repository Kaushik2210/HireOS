import { canonicalizeUrl } from "@/lib/jobs/canonical-url";
import type { AlsoListedOn } from "@/lib/jobs/schemas";
import { normalizeRawJob, type NormalizedJob } from "@/services/jobs/normalize";
import type { JobProvider, RawJob } from "@/services/jobs/providers/types";

export interface IngestStats {
  fetched: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  /** Why records were rejected, for the operator. Never includes description text. */
  rejections: { source: string; title: string; reason: string }[];
}

export interface IngestResult {
  jobs: NormalizedJob[];
  stats: IngestStats;
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * Folds a duplicate into the job we already have. The first-seen record stays primary and
 * only gains what it was missing; the other listing is remembered under `also_listed_on`.
 */
export function mergeJobs(primary: NormalizedJob, other: NormalizedJob): NormalizedJob {
  const alsoListed: AlsoListedOn[] = [
    ...primary.also_listed_on,
    { source_key: other.source_key, apply_url: other.apply_url, posted_at: other.posted_at },
    ...other.also_listed_on,
  ];
  return {
    ...primary,
    location: primary.location ?? other.location,
    work_mode: primary.work_mode ?? other.work_mode,
    job_type: primary.job_type ?? other.job_type,
    seniority: primary.seniority ?? other.seniority,
    salary_min: primary.salary_min ?? other.salary_min,
    salary_max: primary.salary_max ?? other.salary_max,
    salary_currency: primary.salary_currency ?? other.salary_currency,
    salary_period: primary.salary_period ?? other.salary_period,
    apply_url: primary.apply_url ?? other.apply_url,
    posted_at: primary.posted_at ?? other.posted_at,
    min_years: primary.min_years ?? other.min_years,
    description:
      other.description.length > primary.description.length
        ? other.description
        : primary.description,
    requirements: primary.requirements.length ? primary.requirements : other.requirements,
    responsibilities: primary.responsibilities.length
      ? primary.responsibilities
      : other.responsibilities,
    required_skills: union(primary.required_skills, other.required_skills),
    preferred_skills: union(primary.preferred_skills, other.preferred_skills).filter(
      (s) => !union(primary.required_skills, other.required_skills).includes(s),
    ),
    also_listed_on: alsoListed.filter(
      (entry, i, all) =>
        entry.source_key !== primary.source_key &&
        all.findIndex(
          (e) => e.source_key === entry.source_key && e.apply_url === entry.apply_url,
        ) === i,
    ),
  };
}

/**
 * Fetches from each provider, normalises every record, and de-duplicates across sources.
 * Pure with respect to storage: it returns what should be stored and how it got there.
 * A failing provider is skipped and reported, and never aborts the others.
 */
export async function ingestJobs(providers: JobProvider[]): Promise<IngestResult> {
  const stats: IngestStats = {
    fetched: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    rejections: [],
  };
  const jobs: NormalizedJob[] = [];
  const byFingerprint = new Map<string, number>();
  const byUrl = new Map<string, number>();

  for (const provider of providers) {
    let raws: RawJob[];
    try {
      raws = await provider.fetchJobs();
    } catch {
      stats.rejections.push({ source: provider.source.key, title: "", reason: "provider failed" });
      continue;
    }

    for (const raw of raws) {
      stats.fetched += 1;
      const result = normalizeRawJob(raw, provider.source);
      if (!result.ok) {
        stats.rejected += 1;
        stats.rejections.push({
          source: provider.source.key,
          title: String(raw.title ?? "").slice(0, 80),
          reason: result.reason,
        });
        continue;
      }

      const job = result.job;
      const url = canonicalizeUrl(job.apply_url);
      const existing = byFingerprint.get(job.fingerprint) ?? (url ? byUrl.get(url) : undefined);

      if (existing !== undefined) {
        jobs[existing] = mergeJobs(jobs[existing]!, job);
        stats.duplicates += 1;
        continue;
      }
      jobs.push(job);
      byFingerprint.set(job.fingerprint, jobs.length - 1);
      if (url) byUrl.set(url, jobs.length - 1);
      stats.accepted += 1;
    }
  }
  return { jobs, stats };
}
