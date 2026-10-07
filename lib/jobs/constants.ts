import { EXPERIENCE_LEVELS, JOB_TYPES, WORK_MODES } from "@/lib/profile/constants";

export { EXPERIENCE_LEVELS as SENIORITY_LEVELS, JOB_TYPES, WORK_MODES };

export const JOB_SORTS = ["newest", "oldest", "title"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

export const JOB_SORT_LABELS: Record<JobSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  title: "Title A to Z",
};

export const JOBS_PAGE_SIZE = 20;

/** Jobs a user can add by hand. Bounds storage and keeps lists usable. */
export const MAX_PRIVATE_JOBS = 100;

export const MAX_JOB_DESCRIPTION = 20_000;

/** Reserved source for jobs a user pastes in themselves. */
export const MANUAL_SOURCE_KEY = "manual";
