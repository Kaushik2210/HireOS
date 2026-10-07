import { z } from "zod";
import {
  JOBS_PAGE_SIZE,
  JOB_SORTS,
  JOB_TYPES,
  MAX_JOB_DESCRIPTION,
  SENIORITY_LEVELS,
  WORK_MODES,
  type JobSort,
} from "@/lib/jobs/constants";
import { list, requiredText, text, url } from "@/lib/schema-helpers";

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((v) => v ?? null) as z.ZodType<z.output<T> | null>;

const posted = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date")
  .refine(
    (v) => v === null || (v >= "2000-01-01" && v <= futureDate(366)),
    "Enter a believable date",
  );

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const salaryNumber = nullable(z.number().int().min(0).max(1_000_000_000));

/**
 * A job in normalised form: what every provider, and the manual form, is reduced to.
 * Lists hold short plain-text strings; nothing here is markup.
 */
export const newJobSchema = z
  .object({
    company_name: requiredText("the company name", 150),
    title: requiredText("the job title", 200),
    location: text(150),
    work_mode: nullable(z.enum(WORK_MODES)),
    job_type: nullable(z.enum(JOB_TYPES)),
    seniority: nullable(z.enum(SENIORITY_LEVELS)),
    salary_min: salaryNumber,
    salary_max: salaryNumber,
    salary_currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. INR")
      .nullish()
      .transform((v) => v ?? null),
    salary_period: nullable(z.enum(["year", "month"])),
    description: requiredText("a description", MAX_JOB_DESCRIPTION),
    requirements: list(30, 400),
    responsibilities: list(30, 400),
    required_skills: list(40, 60),
    preferred_skills: list(40, 60),
    min_years: nullable(z.number().min(0).max(40)),
    apply_url: url,
    posted_at: posted,
    external_id: text(200),
  })
  .superRefine((job, ctx) => {
    const hasSalary = job.salary_min !== null || job.salary_max !== null;
    if (hasSalary && !job.salary_currency) {
      ctx.addIssue({
        code: "custom",
        path: ["salary_currency"],
        message: "Add a currency for the salary",
      });
    }
    if (job.salary_min !== null && job.salary_max !== null && job.salary_max < job.salary_min) {
      ctx.addIssue({
        code: "custom",
        path: ["salary_max"],
        message: "Maximum must be at least the minimum",
      });
    }
  });

export type NewJob = z.output<typeof newJobSchema>;

export const alsoListedOnSchema = z.object({
  source_key: z.string(),
  apply_url: z.string().nullable(),
  posted_at: z.string().nullable(),
});
export type AlsoListedOn = z.output<typeof alsoListedOnSchema>;

/** A job as stored and returned to the UI. */
export const storedJobSchema = newJobSchema.safeExtend({
  id: z.string(),
  source_key: z.string(),
  fingerprint: z.string(),
  /** Null for the shared catalogue, the owner's id for a job they added themselves. */
  owner_user_id: z.string().nullable(),
  is_demo: z.boolean(),
  also_listed_on: z.array(alsoListedOnSchema),
  discovered_at: z.string(),
});
export type Job = z.output<typeof storedJobSchema>;

/* ---------- search ---------- */

export interface JobQuery {
  q?: string;
  work_modes: (typeof WORK_MODES)[number][];
  job_types: (typeof JOB_TYPES)[number][];
  seniority: (typeof SENIORITY_LEVELS)[number][];
  company?: string;
  has_salary: boolean;
  sort: JobSort;
  page: number;
}

export const DEFAULT_JOB_QUERY: JobQuery = {
  work_modes: [],
  job_types: [],
  seniority: [],
  has_salary: false,
  sort: "newest",
  page: 1,
};

/**
 * Free text from a URL. Control characters (including NUL, which Postgres text cannot hold)
 * are removed first, then the text is trimmed, so hostile input degrades to a plain search.
 */
const searchText = (max: number) =>
  z
    .string()
    .transform((v) =>
      v
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .pipe(z.string().min(1).max(max));

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Reads filters from URL search params. Never throws: each invalid or unknown value is
 * ignored on its own, so a hand-edited link degrades to the default view instead of an error.
 */
export function parseJobQuery(params: Record<string, string | string[] | undefined>): JobQuery {
  const one = <T extends z.ZodType>(schema: T, key: string) => {
    const parsed = schema.safeParse(first(params[key]));
    return parsed.success ? (parsed.data as z.output<T>) : undefined;
  };

  const q = one(searchText(100), "q");
  const company = one(searchText(150), "company");
  const mode = one(z.enum(WORK_MODES), "work_mode");
  const type = one(z.enum(JOB_TYPES), "job_type");
  const level = one(z.enum(SENIORITY_LEVELS), "seniority");
  const sort = one(z.enum(JOB_SORTS), "sort");
  const page = one(z.coerce.number().int().min(1).max(500), "page");

  return {
    ...(q ? { q } : {}),
    ...(company ? { company } : {}),
    work_modes: mode ? [mode] : [],
    job_types: type ? [type] : [],
    seniority: level ? [level] : [],
    has_salary: first(params.has_salary) === "1",
    sort: sort ?? "newest",
    page: page ?? 1,
  };
}

/** The inverse of parseJobQuery, for building links that keep the current filters. */
export function jobQueryToParams(
  query: JobQuery,
  overrides: Partial<{ page: number }> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.company) params.set("company", query.company);
  if (query.work_modes[0]) params.set("work_mode", query.work_modes[0]);
  if (query.job_types[0]) params.set("job_type", query.job_types[0]);
  if (query.seniority[0]) params.set("seniority", query.seniority[0]);
  if (query.has_salary) params.set("has_salary", "1");
  if (query.sort !== "newest") params.set("sort", query.sort);
  const page = overrides.page ?? query.page;
  if (page > 1) params.set("page", String(page));
  return params;
}

export interface JobSearchResult {
  jobs: Job[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export const emptyResult = (page = 1): JobSearchResult => ({
  jobs: [],
  total: 0,
  page,
  pageSize: JOBS_PAGE_SIZE,
  pageCount: 0,
});
