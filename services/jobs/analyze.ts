import type { WORK_MODES, JOB_TYPES } from "@/lib/jobs/constants";
import { parseSalary, type Salary } from "@/lib/jobs/salary";
import type { EXPERIENCE_LEVELS } from "@/lib/profile/constants";
import { normalizeSkill } from "@/lib/skills/catalog";
import { scanCatalogSkills } from "@/lib/skills/scan";
import { normalizeText } from "@/lib/text/normalize";
import { clip } from "@/services/resume/blocks";

type WorkMode = (typeof WORK_MODES)[number];
type JobType = (typeof JOB_TYPES)[number];
type Level = (typeof EXPERIENCE_LEVELS)[number];

export interface JobAnalysis {
  requirements: string[];
  responsibilities: string[];
  required_skills: string[];
  preferred_skills: string[];
  seniority: Level | null;
  min_years: number | null;
  work_mode: WorkMode | null;
  job_type: JobType | null;
  salary: Salary | null;
}

type SectionKind = "responsibilities" | "requirements" | "preferred" | "other";

const HEADINGS: Record<SectionKind, string[]> = {
  responsibilities: [
    "responsibilities",
    "key responsibilities",
    "role and responsibilities",
    "what you will do",
    "what you ll do",
    "what you ll be doing",
    "what you will be doing",
    "your role",
    "the role",
    "duties",
    "day to day",
    "in this role you will",
    "you will",
  ],
  requirements: [
    "requirements",
    "qualifications",
    "what you will need",
    "what you ll need",
    "who you are",
    "must have",
    "required skills",
    "minimum qualifications",
    "basic qualifications",
    "skills and experience",
    "what we are looking for",
    "what we re looking for",
    "about you",
    "required",
    "you have",
    "you bring",
  ],
  preferred: [
    "nice to have",
    "preferred",
    "preferred qualifications",
    "bonus",
    "bonus points",
    "good to have",
    "a plus",
    "plus",
    "desirable",
    "preferred skills",
    "nice to haves",
    "it would be great if you have",
  ],
  other: [
    "benefits",
    "perks",
    "what we offer",
    "about us",
    "about the company",
    "compensation",
    "salary",
    "how to apply",
    "why join us",
    "our culture",
    "equal opportunity",
  ],
};

const LOOKUP = new Map<string, SectionKind>();
for (const [kind, names] of Object.entries(HEADINGS) as [SectionKind, string[]][]) {
  for (const name of names) LOOKUP.set(name, kind);
}

const headingKey = (line: string) =>
  line
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function headingOf(line: string): SectionKind | null {
  if (line.length === 0 || line.length > 50 || line.startsWith("• ")) return null;
  return LOOKUP.get(headingKey(line)) ?? null;
}

interface Sections {
  intro: string[];
  responsibilities: string[];
  requirements: string[];
  preferred: string[];
}

function splitSections(lines: string[]): Sections {
  const out: Sections = { intro: [], responsibilities: [], requirements: [], preferred: [] };
  let current: keyof Sections = "intro";
  let ignoring = false;
  for (const line of lines) {
    const kind = headingOf(line);
    if (kind) {
      if (kind === "other") ignoring = true;
      else {
        ignoring = false;
        current = kind;
      }
      continue;
    }
    if (ignoring || !line) continue;
    out[current].push(line);
  }
  return out;
}

/** Bullet items, or sentence-length lines when the section is not bulleted. */
function itemsOf(lines: string[]): string[] {
  const items = lines
    .map((l) => (l.startsWith("• ") ? l.slice(2) : l).trim())
    .filter((l) => l.length >= 12);
  return [...new Set(items.map((l) => clip(l, 400)))].slice(0, 30);
}

const LEAD_INS =
  /^(?:(?:strong|solid|good|proven|hands-on|working|practical|basic|deep|excellent|demonstrated)\s+)*(?:experience|proficiency|knowledge|understanding|familiarity|expertise|skills?|background|exposure|command)\s+(?:with|in|of|using|on)\s+/i;

/** Skills named in one requirement line: list tokens first (exact), then safe prose matches. */
function skillsInLine(line: string): string[] {
  const found = new Set<string>();
  const stripped = line.replace(/^•\s*/, "").replace(LEAD_INS, "");
  for (const part of stripped.split(/[,;/|()]|\s+(?:or|and|and\/or)\s+/i)) {
    const token = part
      .trim()
      .replace(/^(?:e\.g\.|such as|like|including|especially|ideally)\s+/i, "")
      .replace(/[.:]+$/, "");
    if (!token || token.length > 30) continue;
    const hit = normalizeSkill(token);
    if (hit.recognised) found.add(hit.name);
  }
  for (const skill of scanCatalogSkills(line)) found.add(skill.name);
  return [...found];
}

const YEARS_RANGE = /\b(\d{1,2})\s*\+?\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi;
const YEARS_MIN = /\b(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)\b/gi;

/**
 * The most experience any requirement asks for, taking the lower bound of ranges
 * ("3-5 years" is 3). Only lines that talk about experience count, so "5 years in business"
 * in a company blurb is ignored.
 */
function minYears(lines: string[]): number | null {
  let best: number | null = null;
  for (const line of lines) {
    if (!/experience|exposure|background|working|professional/i.test(line)) continue;
    const ranges = [...line.matchAll(YEARS_RANGE)];
    const singles = [...line.matchAll(YEARS_MIN)];
    const candidates = [...ranges.map((m) => Number(m[1])), ...singles.map((m) => Number(m[1]))];
    for (const years of candidates) {
      if (years >= 0 && years <= 30 && (best === null || years > best)) best = years;
    }
  }
  return best;
}

/** Title wins; years of experience fill in when the title says nothing. */
function seniorityOf(title: string, years: number | null): Level | null {
  const t = title.toLowerCase();
  if (/\b(intern|internship|trainee|apprentice|co-?op)\b/.test(t)) return "student";
  if (/\b(graduate|fresher|entry[- ]level)\b/.test(t)) return "entry";
  if (/\b(junior|jr\.?)\b/.test(t)) return "junior";
  if (/\b(lead|manager|head of|director|architect|principal|staff)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?)\b/.test(t)) return "senior";
  if (/\b(associate)\b/.test(t)) return "entry";
  if (/\b(iii|level 3)\b/.test(t)) return "senior";
  if (/\b(ii|level 2)\b/.test(t)) return "mid";
  if (/\b(i|level 1)\b$/.test(t.trim())) return "junior";
  if (years === null) return null;
  if (years <= 1) return "entry";
  if (years <= 2) return "junior";
  if (years <= 4) return "mid";
  return "senior";
}

function workModeOf(location: string | null | undefined, text: string): WorkMode | null {
  const head = `${location ?? ""} ${text.slice(0, 600)}`;
  if (/\bhybrid\b/i.test(head)) return "hybrid";
  if (/\bremote\b/i.test(location ?? "")) return "remote";
  if (
    /\b(fully remote|100% remote|remote[- ]first|remote position|work from home|work remotely)\b/i.test(
      text,
    )
  ) {
    return "remote";
  }
  if (/\b(on[- ]?site|in[- ]office|work from (?:the )?office)\b/i.test(head)) return "onsite";
  return null;
}

function jobTypeOf(title: string, text: string): JobType | null {
  const t = `${title} ${text.slice(0, 800)}`.toLowerCase();
  if (/\b(intern|internship|trainee)\b/.test(title.toLowerCase())) return "internship";
  if (/\bpart[- ]time\b/.test(t)) return "part_time";
  if (/\b(contract|contractor|freelance|fixed[- ]term)\b/.test(t)) return "contract";
  if (/\bfull[- ]time\b/.test(t)) return "full_time";
  return null;
}

/**
 * Reads structured facts out of a plain-text job description. Deterministic and offline:
 * the same text always gives the same result, and it only reports what the text says.
 * The description is untrusted data and is never interpreted as instructions; it is only
 * split into lines and matched against fixed patterns.
 */
export function analyzeJob(input: {
  title: string;
  description: string;
  location?: string | null;
}): JobAnalysis {
  const text = normalizeText(input.description);
  const lines = text.split("\n");
  const sections = splitSections(lines);

  const requirements = itemsOf(sections.requirements);
  const responsibilities = itemsOf(sections.responsibilities);

  const preferredSkills = new Set(sections.preferred.flatMap(skillsInLine));
  const required = new Set<string>();
  // Skills in the requirements section, plus any named in the intro or responsibilities,
  // are treated as required unless the posting lists them under "nice to have".
  for (const line of [...sections.requirements, ...sections.responsibilities, ...sections.intro]) {
    for (const skill of skillsInLine(line)) if (!preferredSkills.has(skill)) required.add(skill);
  }
  for (const skill of required) preferredSkills.delete(skill);

  const years = minYears(sections.requirements.length > 0 ? sections.requirements : lines);

  return {
    requirements,
    responsibilities,
    required_skills: [...required].slice(0, 40),
    preferred_skills: [...preferredSkills].slice(0, 40),
    seniority: seniorityOf(input.title, years),
    min_years: years,
    work_mode: workModeOf(input.location, text),
    job_type: jobTypeOf(input.title, text),
    salary: parseSalary(text),
  };
}
