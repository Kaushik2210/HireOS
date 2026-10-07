import { canonicalizeUrl } from "@/lib/jobs/canonical-url";
import { htmlToText } from "@/lib/jobs/html";
import { newJobSchema, type AlsoListedOn, type NewJob } from "@/lib/jobs/schemas";
import { analyzeJob } from "@/services/jobs/analyze";
import { jobFingerprint } from "@/services/jobs/fingerprint";
import type { JobSourceInfo, RawJob } from "@/services/jobs/providers/types";

/** A job ready to store: validated, cleaned, analysed and fingerprinted. */
export interface NormalizedJob extends NewJob {
  source_key: string;
  fingerprint: string;
  is_demo: boolean;
  also_listed_on: AlsoListedOn[];
}

export type NormalizeResult = { ok: true; job: NormalizedJob } | { ok: false; reason: string };

const MAX_DESCRIPTION = 20_000;

/** One line of plain text: control characters removed, whitespace collapsed. */
const oneLine = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Turns a provider's record into a stored job. Order matters: markup is removed first, then
 * the cleaned text is analysed, then provider-supplied fields override what analysis guessed
 * (a provider that says "remote" knows better than a pattern match), and finally everything
 * is validated. A record that fails validation is rejected, never patched up.
 */
export function normalizeRawJob(raw: RawJob, source: JobSourceInfo): NormalizeResult {
  // A plain length cap: clip() would collapse the line breaks the analyser relies on.
  const description = htmlToText(raw.description ?? "")
    .slice(0, MAX_DESCRIPTION)
    .trim();
  if (!description) return { ok: false, reason: "empty description" };

  const title = oneLine(raw.title ?? "");
  const location = oneLine(raw.location ?? "") || null;
  const analysis = analyzeJob({ title, description, location });
  const salary = raw.salary ?? analysis.salary;

  const candidate = {
    company_name: oneLine(raw.company_name ?? ""),
    title,
    location,
    work_mode: raw.work_mode ?? analysis.work_mode,
    job_type: raw.job_type ?? analysis.job_type,
    seniority: analysis.seniority,
    salary_min: salary?.min ?? null,
    salary_max: salary?.max ?? null,
    salary_currency: salary ? salary.currency : null,
    salary_period: salary ? salary.period : null,
    description,
    requirements: analysis.requirements,
    responsibilities: analysis.responsibilities,
    required_skills: analysis.required_skills,
    preferred_skills: analysis.preferred_skills,
    min_years: analysis.min_years,
    apply_url: canonicalizeUrl(raw.apply_url),
    posted_at: raw.posted_at ?? null,
    external_id: raw.external_id ?? null,
  };

  const parsed = newJobSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: `${issue?.path.join(".") || "job"}: ${issue?.message ?? "invalid"}`,
    };
  }

  return {
    ok: true,
    job: {
      ...parsed.data,
      source_key: source.key,
      fingerprint: jobFingerprint(parsed.data),
      is_demo: source.kind === "demo",
      also_listed_on: [],
    },
  };
}
