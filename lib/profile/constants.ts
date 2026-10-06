export const SKILL_TYPES = [
  "language",
  "framework",
  "database",
  "cloud_devops",
  "data_ml",
  "tool",
  "soft",
  "domain",
] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

export const SKILL_TYPE_LABELS: Record<SkillType, string> = {
  language: "Languages",
  framework: "Frameworks and libraries",
  database: "Databases",
  cloud_devops: "Cloud and DevOps",
  data_ml: "Data and ML",
  tool: "Tools",
  soft: "Professional skills",
  domain: "Domain knowledge",
};

export const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "expert"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const EXPERIENCE_KINDS = ["work", "internship", "leadership", "volunteer"] as const;
export type ExperienceKind = (typeof EXPERIENCE_KINDS)[number];

export const ACHIEVEMENT_CATEGORIES = ["award", "competition", "publication", "other"] as const;

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export const JOB_TYPES = ["full_time", "internship", "contract", "part_time"] as const;
export const EXPERIENCE_LEVELS = ["student", "entry", "junior", "mid", "senior", "lead"] as const;
export const SALARY_PERIODS = ["year", "month"] as const;

/** Where an item came from. Resume-parsed items must be confirmed before they count as verified. */
export const ITEM_SOURCES = ["manual", "resume"] as const;

/** Upper bound per collection, to keep storage and prompts bounded. */
export const MAX_ITEMS_PER_COLLECTION = 50;
export const MAX_HIGHLIGHTS = 10;
export const MAX_TAGS = 30;
