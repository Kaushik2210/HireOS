import type { Job, JobQuery, JobSearchResult } from "@/lib/jobs/schemas";
import type { NormalizedJob } from "@/services/jobs/normalize";

export type JobStoreErrorKind = "duplicate" | "limit" | "unknown";

export class JobStoreError extends Error {
  constructor(
    public readonly kind: JobStoreErrorKind,
    cause?: unknown,
  ) {
    super(`Job store error: ${kind}`, cause === undefined ? undefined : { cause });
    this.name = "JobStoreError";
  }
}

export interface DemoState {
  /** Whether any demo jobs exist for this user to show or hide. */
  available: boolean;
  hidden: boolean;
}

/** A job the user pasted in: normalised like any other, but always private and manual. */
export type PrivateJobInput = NormalizedJob;

export interface JobStore {
  /** Shared catalogue jobs plus the user's own, filtered, sorted and paged. */
  search(userId: string, query: JobQuery): Promise<JobSearchResult>;
  /** Null when the job does not exist or is not visible to this user. */
  get(userId: string, id: string): Promise<Job | null>;
  /** Distinct company names visible to this user, for the filter. */
  companies(userId: string): Promise<string[]>;
  createPrivate(userId: string, job: PrivateJobInput): Promise<Job>;
  /** Only the user's own jobs can be deleted. Returns false when nothing matched. */
  deletePrivate(userId: string, id: string): Promise<boolean>;
  countPrivate(userId: string): Promise<number>;
  demo(userId: string): Promise<DemoState>;
  setDemoHidden(userId: string, hidden: boolean): Promise<void>;
}
