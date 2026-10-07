import { z } from "zod";
import { list, requiredText, text, url } from "@/lib/schema-helpers";
import {
  ACHIEVEMENT_CATEGORIES,
  EXPERIENCE_KINDS,
  EXPERIENCE_LEVELS,
  JOB_TYPES,
  MAX_HIGHLIGHTS,
  MAX_TAGS,
  SALARY_PERIODS,
  SKILL_LEVELS,
  SKILL_TYPES,
  WORK_MODES,
} from "@/lib/profile/constants";

/* ---------- field helpers ---------- */

/** A calendar month as YYYY-MM. Stored in the database as the first day of that month. */
const month = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-(0[1-9]|1[0-2])$/.test(v), "Enter a valid month")
  .refine((v) => v === null || Number(v.slice(0, 4)) >= 1970, "Enter a year from 1970")
  .refine((v) => v === null || v <= currentMonth(120), "That month is too far in the future");

function currentMonth(plusMonths = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + plusMonths);
  return d.toISOString().slice(0, 7);
}

const highlights = list(MAX_HIGHLIGHTS, 300);
const tags = list(MAX_TAGS, 50);

/** end >= start, and a current role has no end date. */
function checkDates<
  T extends { start_date: string | null; end_date: string | null; is_current: boolean },
>(value: T, ctx: z.RefinementCtx) {
  if (value.is_current && value.end_date) {
    ctx.addIssue({
      code: "custom",
      path: ["end_date"],
      message: "Leave the end date empty for something ongoing",
    });
  }
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    ctx.addIssue({
      code: "custom",
      path: ["end_date"],
      message: "End date must be after the start date",
    });
  }
}

/* ---------- collection entities ---------- */

export const educationSchema = z
  .object({
    institution: requiredText("the institution", 150),
    degree: requiredText("the degree", 150),
    field_of_study: text(150),
    start_date: month,
    end_date: month,
    is_current: z.boolean().default(false),
    grade: text(40),
    highlights,
  })
  .superRefine(checkDates);

export const experienceSchema = z
  .object({
    kind: z.enum(EXPERIENCE_KINDS),
    organization: requiredText("the organization", 150),
    title: requiredText("the title", 150),
    location: text(150),
    start_date: month,
    end_date: month,
    is_current: z.boolean().default(false),
    highlights,
    skills: tags,
  })
  .superRefine(checkDates);

export const projectSchema = z
  .object({
    name: requiredText("the project name", 150),
    role: text(150),
    description: text(1000),
    url,
    repo_url: url,
    start_date: month,
    end_date: month,
    is_current: z.boolean().default(false),
    tech: tags,
    highlights,
  })
  .superRefine(checkDates);

export const certificationSchema = z
  .object({
    name: requiredText("the certification name", 200),
    issuer: text(150),
    issued_date: month,
    expires_date: month,
    credential_id: text(100),
    url,
  })
  .superRefine((v, ctx) => {
    if (v.issued_date && v.expires_date && v.expires_date < v.issued_date) {
      ctx.addIssue({
        code: "custom",
        path: ["expires_date"],
        message: "Expiry must be after the issue date",
      });
    }
  });

export const skillSchema = z.object({
  name: requiredText("the skill", 60),
  type: z.enum(SKILL_TYPES),
  level: z.enum(SKILL_LEVELS),
  years: z
    .number({ error: "Enter a number" })
    .min(0, "Years cannot be negative")
    .max(50, "Enter at most 50")
    .nullish()
    .transform((v) => (v === undefined ? null : v)),
});

export const achievementSchema = z.object({
  title: requiredText("the title", 200),
  category: z.enum(ACHIEVEMENT_CATEGORIES),
  description: text(1000),
  achieved_on: month,
});

/* ---------- singleton entities ---------- */

export const profileSchema = z
  .object({
    full_name: requiredText("your name", 100),
    headline: text(150),
    summary: text(1500),
    location: text(150),
    linkedin_url: url,
    github_url: url,
    website_url: url,
    experience_level: z
      .enum(EXPERIENCE_LEVELS)
      .nullish()
      .transform((v) => v ?? null),
    work_modes: z.array(z.enum(WORK_MODES)).default([]),
    job_types: z.array(z.enum(JOB_TYPES)).default([]),
    preferred_locations: list(10, 100),
    open_to_relocate: z.boolean().default(false),
    expected_salary_min: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .nullish()
      .transform((v) => v ?? null),
    expected_salary_max: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .nullish()
      .transform((v) => v ?? null),
    salary_currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. INR")
      .default("INR"),
    salary_period: z.enum(SALARY_PERIODS).default("year"),
  })
  .superRefine((v, ctx) => {
    if (
      v.expected_salary_min !== null &&
      v.expected_salary_max !== null &&
      v.expected_salary_max < v.expected_salary_min
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expected_salary_max"],
        message: "Maximum must be at least the minimum",
      });
    }
  });

export const careerGoalSchema = z.object({
  target_roles: list(5, 100),
  target_level: z
    .enum(EXPERIENCE_LEVELS)
    .nullish()
    .transform((v) => v ?? null),
  timeline_months: z
    .number({ error: "Enter a number" })
    .int()
    .min(1, "Enter at least 1 month")
    .max(120, "Enter at most 120 months")
    .nullish()
    .transform((v) => v ?? null),
  statement: text(1000),
});

/* ---------- registry ---------- */

export const COLLECTION_ENTITIES = [
  "education",
  "experiences",
  "projects",
  "certifications",
  "skills",
  "achievements",
] as const;
export type CollectionEntity = (typeof COLLECTION_ENTITIES)[number];

export const SINGLETON_ENTITIES = ["profiles", "career_goals"] as const;
export type SingletonEntity = (typeof SINGLETON_ENTITIES)[number];

export const collectionSchemas = {
  education: educationSchema,
  experiences: experienceSchema,
  projects: projectSchema,
  certifications: certificationSchema,
  skills: skillSchema,
  achievements: achievementSchema,
} as const;

export const singletonSchemas = {
  profiles: profileSchema,
  career_goals: careerGoalSchema,
} as const;

/** Columns stored as `date` but exchanged as YYYY-MM strings. */
export const MONTH_FIELDS: Record<CollectionEntity | SingletonEntity, readonly string[]> = {
  education: ["start_date", "end_date"],
  experiences: ["start_date", "end_date"],
  projects: ["start_date", "end_date"],
  certifications: ["issued_date", "expires_date"],
  skills: [],
  achievements: ["achieved_on"],
  profiles: [],
  career_goals: [],
};

export type EducationInput = z.input<typeof educationSchema>;
export type Education = z.output<typeof educationSchema>;
export type Experience = z.output<typeof experienceSchema>;
export type Project = z.output<typeof projectSchema>;
export type Certification = z.output<typeof certificationSchema>;
export type Skill = z.output<typeof skillSchema>;
export type Achievement = z.output<typeof achievementSchema>;
export type ProfileData = z.output<typeof profileSchema>;
export type CareerGoalData = z.output<typeof careerGoalSchema>;

export interface ItemMeta {
  id: string;
  /** manual = typed by the user, resume = proposed by the parser. */
  source: "manual" | "resume";
  /** Only confirmed items are verified and may back generated claims. */
  confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export type CollectionItemMap = {
  education: Education & ItemMeta;
  experiences: Experience & ItemMeta;
  projects: Project & ItemMeta;
  certifications: Certification & ItemMeta;
  skills: Skill & ItemMeta;
  achievements: Achievement & ItemMeta;
};
export type CollectionItem<E extends CollectionEntity> = CollectionItemMap[E];
