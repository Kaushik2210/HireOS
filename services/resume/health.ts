import type { HealthCheck, HealthGroup, ParsedResume, ResumeHealth } from "@/lib/resume/schemas";
import { scanCatalogSkills } from "@/lib/skills/scan";

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

function check(
  id: string,
  label: string,
  progress: number,
  evidence: string,
  hint: string,
): HealthCheck {
  const p = clamp01(progress);
  return { id, label, progress: p, evidence, hint: p >= 1 ? "" : hint };
}

function group(id: string, label: string, weight: number, checks: HealthCheck[]): HealthGroup {
  const mean = checks.reduce((sum, c) => sum + c.progress, 0) / checks.length;
  return { id, label, weight, score: Math.round(mean * 100), checks };
}

const ACTION_VERBS = new Set(
  (
    "built developed designed implemented created led managed delivered launched improved " +
    "reduced increased optimized optimised automated deployed migrated integrated analyzed " +
    "analysed wrote tested debugged refactored architected streamlined mentored presented " +
    "collaborated coordinated organized organised resolved established maintained configured " +
    "containerized containerised researched trained cut saved scaled shipped drove owned " +
    "introduced replaced simplified secured monitored documented evaluated engineered " +
    "founded initiated redesigned accelerated generated achieved won"
  ).split(" "),
);

// A number that is not just a technology version ("Python 3", "HTML5").
const VERSIONED_NAME = /\b[A-Za-z][A-Za-z.+#]*\s?\d(?:\.\d+)?\b/g;
const QUANTIFIED = /\d[\d,.]*\s?(?:%|\+|k\b|m\b|x\b|ms\b|s\b)?|[$₹€£]\s?\d/;

const quantified = (bullet: string) => QUANTIFIED.test(bullet.replace(VERSIONED_NAME, ""));
const startsWithAction = (bullet: string) =>
  ACTION_VERBS.has((bullet.split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z]/g, ""));
const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

const pct = (n: number) => `${Math.round(n * 100)}%`;

export interface HealthInput {
  /** Normalized text, as produced by the parser. */
  text: string;
  parsed: ParsedResume;
}

/**
 * Scores the resume as a document across six groups. Deterministic: every check is computed
 * from the extracted text and parsed structure, and states the evidence it used. This says
 * how readable and well-formed the resume is. It does not predict hiring outcomes.
 */
export function computeResumeHealth({ text, parsed }: HealthInput): ResumeHealth {
  const { contact, stats } = parsed;
  const sectionKeys = new Set(parsed.sections.map((s) => s.key));
  const pages = Math.max(stats.pages, 1);

  const bullets = [...parsed.experiences, ...parsed.projects].flatMap((e) => e.highlights);
  const noBullets = bullets.length === 0;
  const noBulletEvidence = "No bullet points were found under experience or projects.";

  /* ---------- ATS compatibility ---------- */
  const perPage = text.length / pages;
  const emailInHeaderOnly = parsed.notes.some((n) =>
    /email address is in the page header/i.test(n),
  );
  const core = [
    sectionKeys.has("education"),
    sectionKeys.has("skills"),
    sectionKeys.has("experience") || sectionKeys.has("projects"),
  ];
  const ats = group("ats", "ATS compatibility", 25, [
    check(
      "text",
      "Readable text",
      perPage / 600,
      `${Math.round(perPage)} characters of selectable text per page`,
      "Little text could be read. If this is a scanned or image-only file, export it again from your editor so the text is selectable.",
    ),
    check(
      "email",
      "Email address",
      contact.email ? (emailInHeaderOnly ? 0.5 : 1) : 0,
      contact.email ? (emailInHeaderOnly ? "Found only in the page header" : "Found") : "Not found",
      contact.email
        ? "Repeat your email in the main text, since some systems skip headers."
        : "Add your email address near the top.",
    ),
    check(
      "phone",
      "Phone number",
      contact.phone ? 1 : 0,
      contact.phone ? "Found" : "Not found",
      "Add a phone number near the top.",
    ),
    check(
      "headings",
      "Standard section headings",
      core.filter(Boolean).length / core.length,
      `${core.filter(Boolean).length} of 3 core sections recognised (Education, Skills, Experience or Projects)`,
      "Use plain headings such as Experience, Projects, Education and Skills so systems can find them.",
    ),
    check(
      "length",
      "Length",
      pages <= 2 ? 1 : pages === 3 ? 0.5 : 0,
      `${pages} ${pages === 1 ? "page" : "pages"}`,
      "Keep it to one or two pages.",
    ),
  ]);

  /* ---------- Structure ---------- */
  const dated = [...parsed.experiences, ...parsed.education, ...parsed.projects];
  const withDates = dated.filter((e) => e.start_date).length;
  const datedRoles = parsed.experiences.filter((e) => e.start_date);
  const ordered = datedRoles.every(
    (e, i) => i === 0 || datedRoles[i - 1]!.start_date! >= e.start_date!,
  );
  const content = [
    sectionKeys.has("experience") || sectionKeys.has("leadership"),
    sectionKeys.has("projects"),
    sectionKeys.has("education"),
  ];
  const structure = group("structure", "Structure", 20, [
    check(
      "content",
      "Content sections",
      content.filter(Boolean).length / content.length,
      `${content.filter(Boolean).length} of 3 (Experience, Projects, Education)`,
      "Cover experience, projects and education. Projects can stand in for experience early in a career.",
    ),
    check(
      "dates",
      "Dates on entries",
      dated.length === 0 ? 0 : share(withDates, dated.length),
      dated.length === 0
        ? "No entries were read"
        : `${withDates} of ${dated.length} entries have dates`,
      "Give every role, project and degree a start and end date.",
    ),
    check(
      "entries",
      "Roles and projects",
      (parsed.experiences.length + parsed.projects.length) / 2,
      `${parsed.experiences.length} experience and ${parsed.projects.length} project entries read`,
      "Include at least two roles or projects.",
    ),
    check(
      "order",
      "Newest first",
      datedRoles.length < 2 || ordered ? 1 : 0,
      datedRoles.length < 2
        ? "Too few dated roles to compare"
        : ordered
          ? "Reverse chronological"
          : "Roles are not newest first",
      "List your most recent role first.",
    ),
    check(
      "name",
      "Name at the top",
      contact.full_name ? 1 : 0,
      contact.full_name ? "Found" : "Not found",
      "Start the document with your name on its own line.",
    ),
  ]);

  /* ---------- Impact ---------- */
  const quantifiedCount = bullets.filter(quantified).length;
  const actionCount = bullets.filter(startsWithAction).length;
  const impact = group("impact", "Impact", 20, [
    check(
      "numbers",
      "Quantified results",
      noBullets ? 0 : share(quantifiedCount, bullets.length) / 0.4,
      noBullets
        ? noBulletEvidence
        : `${quantifiedCount} of ${bullets.length} bullets include a number (${pct(share(quantifiedCount, bullets.length))}, aim for 40%)`,
      "Add measurable results where they are true: numbers, percentages, time saved, users served.",
    ),
    check(
      "verbs",
      "Action verbs",
      noBullets ? 0 : share(actionCount, bullets.length) / 0.6,
      noBullets
        ? noBulletEvidence
        : `${actionCount} of ${bullets.length} bullets start with an action verb (${pct(share(actionCount, bullets.length))}, aim for 60%)`,
      "Start bullets with what you did: built, designed, reduced, led.",
    ),
    check(
      "volume",
      "Enough detail",
      bullets.length / 6,
      `${bullets.length} bullet points under experience and projects`,
      "Aim for at least six bullet points across your roles and projects.",
    ),
  ]);

  /* ---------- Readability ---------- */
  const lengthOk = bullets.filter((b) => {
    const n = wordCount(b);
    return n >= 8 && n <= 28;
  }).length;
  const firstPerson = (text.match(/\b(?:I|my|me|myself)\b/g) ?? []).length;
  const words = stats.words;
  const denseLines = text.split("\n").filter((l) => !l.startsWith("• ") && l.length > 200).length;
  const readability = group("readability", "Readability", 15, [
    check(
      "bullet-length",
      "Bullet length",
      noBullets ? 0 : share(lengthOk, bullets.length) / 0.7,
      noBullets ? noBulletEvidence : `${lengthOk} of ${bullets.length} bullets are 8 to 28 words`,
      "Keep bullets to one or two lines, roughly 8 to 28 words.",
    ),
    check(
      "first-person",
      "No first-person phrasing",
      1 - firstPerson / 4,
      firstPerson === 0 ? "None found" : `${firstPerson} uses of "I", "my" or "me"`,
      'Drop pronouns. Write "Built a tracker", not "I built my tracker".',
    ),
    check(
      "word-count",
      "Overall length",
      words < 250 ? words / 250 : words > 900 ? 1 - (words - 900) / 600 : 1,
      `${words} words`,
      words < 250 ? "Add more detail about what you did." : "Trim to the most relevant material.",
    ),
    check(
      "dense",
      "No dense paragraphs",
      1 - denseLines / 3,
      denseLines === 0 ? "None found" : `${denseLines} very long lines of running text`,
      "Break long paragraphs into short bullet points.",
    ),
  ]);

  /* ---------- Skill coverage ---------- */
  const types = new Set(
    parsed.skills.filter((s) => s.type !== "soft" && s.type !== "domain").map((s) => s.type),
  );
  const skills = group("skills", "Skill coverage", 10, [
    check(
      "skills-section",
      "Skills section",
      sectionKeys.has("skills") ? 1 : 0,
      sectionKeys.has("skills") ? "Found" : "Not found",
      "Add a Skills section listing your tools and technologies.",
    ),
    check(
      "skills-count",
      "Skills listed",
      parsed.skills.length / 8,
      `${parsed.skills.length} skills recognised`,
      "List at least eight skills you can back up.",
    ),
    check(
      "skills-breadth",
      "Skill categories",
      types.size / 3,
      `${types.size} of 3 categories (languages, frameworks, databases, tools and more)`,
      "Cover at least three categories.",
    ),
  ]);

  /* ---------- Keyword coverage (general) ---------- */
  const keywordSet = new Set([
    ...scanCatalogSkills(text).map((s) => s.name),
    ...parsed.skills.map((s) => s.name),
  ]);
  const keywords = group("keywords", "Keyword coverage", 10, [
    check(
      "keyword-breadth",
      "Recognised skills and tools",
      keywordSet.size / 15,
      `${keywordSet.size} recognised skills and tools across the document`,
      "General breadth only. Coverage of a specific job's keywords is measured when you compare against that job.",
    ),
  ]);

  const groups = [ats, structure, impact, readability, skills, keywords];
  const score = Math.round(groups.reduce((sum, g) => sum + (g.weight * g.score) / 100, 0));
  return { score, groups };
}
