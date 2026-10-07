import type { JOB_TYPES, WORK_MODES } from "@/lib/jobs/constants";

/** What a provider hands back: loosely shaped, possibly HTML, never trusted. */
export interface RawJob {
  external_id?: string | null;
  company_name: string;
  title: string;
  location?: string | null;
  /** Plain text or HTML. Cleaned and analysed during normalisation. */
  description: string;
  apply_url?: string | null;
  /** YYYY-MM-DD */
  posted_at?: string | null;
  work_mode?: (typeof WORK_MODES)[number] | null;
  job_type?: (typeof JOB_TYPES)[number] | null;
  salary?: {
    min: number | null;
    max: number | null;
    currency: string;
    period: "year" | "month";
  } | null;
}

export type SourceKind = "demo" | "feed" | "manual";

export interface JobSourceInfo {
  /** Stable key stored on every job from this source. */
  key: string;
  name: string;
  kind: SourceKind;
  /**
   * Why fetching from this source is permitted. A real provider must state its basis
   * (documented public API, licence, user-supplied data); it is shown to the operator.
   */
  termsNote: string;
}

/**
 * A source of jobs. Implementations fetch only where the source's terms allow it and never
 * evade rate limits, log in, or scrape pages that forbid it. Adding one is a small adapter:
 * map the source's records to RawJob and let normalisation do the rest.
 */
export interface JobProvider {
  source: JobSourceInfo;
  fetchJobs(): Promise<RawJob[]>;
}
