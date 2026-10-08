/**
 * Career analytics. Everything is derived on read from what the person has recorded
 * (applications and their history, documents, outreach, practice) and from the same
 * deterministic matching used elsewhere. Nothing predicts an outcome: findings describe what
 * the stored data shows in hedged words, and small samples are labelled as such.
 */

/** Applications needed before the "why no interviews" analysis says more than a few observations. */
export const MIN_APPLIED_FOR_ANALYSIS = 5;

/** Below this many applications a rate is shown with a caution rather than as a finding. */
export const SMALL_SAMPLE = 10;

/** An application younger than this has had little time to be answered. */
export const TOO_EARLY_DAYS = 14;

/** Jobs considered when working out which skills to learn. */
export const MAX_GAP_JOBS = 30;

export interface Rate {
  /** How many of `of` had the outcome. */
  n: number;
  of: number;
  /** 0 to 100, rounded. Null when `of` is 0. */
  pct: number | null;
  /** True when `of` is too small for the percentage to mean much. */
  small: boolean;
}

export const rate = (n: number, of: number): Rate => ({
  n,
  of,
  pct: of === 0 ? null : Math.round((n / of) * 100),
  small: of < SMALL_SAMPLE,
});
