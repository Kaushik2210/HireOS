import type { MatchResult } from "@/lib/matching/types";

export interface StoredMatch {
  jobId: string;
  result: MatchResult;
  profileHash: string;
  computedAt: string;
}

export interface MatchStore {
  /** The saved match for this user and job, or null when none exists or it is unreadable. */
  get(userId: string, jobId: string): Promise<StoredMatch | null>;
  /** Saves or replaces the match for this user and job. */
  save(userId: string, jobId: string, result: MatchResult, profileHash: string): Promise<void>;
}
