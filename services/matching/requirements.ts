import type { Job } from "@/lib/jobs/schemas";
import { degreeLevel } from "@/services/matching/candidate";

export interface EducationRequirement {
  /** 1 diploma, 2 bachelor, 3 master, 4 doctorate */
  level: number;
  /** The sentence it was read from, shown to the user. */
  text: string;
  /** "Currently pursuing" or similar: someone still studying meets it. */
  allowsOngoing: boolean;
  /** "or equivalent experience": being a level short is less of a problem. */
  flexible: boolean;
}

const DEGREE_WORDS =
  /\b(degree|bachelor|master|ph\.?\s?d|doctorate|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|m\.?\s?sc|bca|mca|mba|diploma|graduate)\b/i;

/** The highest degree level the posting asks for, or null when it asks for none. */
export function educationRequirement(
  job: Pick<Job, "requirements" | "description">,
): EducationRequirement | null {
  const lines =
    job.requirements.length > 0
      ? job.requirements
      : job.description.split("\n").filter((l) => /require|must|qualif|degree/i.test(l));

  let best: EducationRequirement | null = null;
  for (const line of lines) {
    if (!DEGREE_WORDS.test(line)) continue;
    // "recent graduate" and "graduate-level" alone are too vague to count as a degree rule.
    if (
      !/\bdegree|bachelor|master|ph\.?\s?d|doctorate|b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|bca|mca|mba|diploma\b/i.test(
        line,
      )
    )
      continue;
    let level = degreeLevel(line);
    if (level === 0 && /\bdegree\b/i.test(line)) level = 2;
    if (level === 0) continue;
    const candidate: EducationRequirement = {
      level,
      text: line,
      allowsOngoing:
        /pursuing|studying|currently|final[- ]year|recent(ly)? (graduate|completed)/i.test(line),
      flexible: /or equivalent|or related|equivalent experience/i.test(line),
    };
    if (!best || candidate.level > best.level) best = candidate;
  }
  return best;
}

const LEVEL_YEARS: Record<string, number> = {
  student: 0,
  entry: 0,
  junior: 1,
  mid: 3,
  senior: 5,
  lead: 8,
};

export interface ExperienceRequirement {
  years: number;
  source: "stated" | "from level";
}

/** Years asked for: stated in the posting, else a typical figure for its seniority level. */
export function experienceRequirement(
  job: Pick<Job, "min_years" | "seniority">,
): ExperienceRequirement | null {
  if (job.min_years !== null) return { years: job.min_years, source: "stated" };
  if (job.seniority) return { years: LEVEL_YEARS[job.seniority] ?? 0, source: "from level" };
  return null;
}
