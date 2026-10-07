import type { ExperienceKind } from "@/lib/profile/constants";
import {
  clip,
  isBullet,
  splitPieces,
  stripBullet,
  toBlocks,
  type Block,
} from "@/services/resume/blocks";
import { findDateSpan, stripSpan, type DateSpan } from "@/services/resume/dates";
import { scanCatalogSkills } from "@/lib/skills/scan";

/* Drafts are plain objects; the parser validates each one against the real profile schemas. */
export interface EducationDraft {
  institution: string;
  degree: string;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  grade: string | null;
  highlights: string[];
}
export interface ExperienceDraft {
  kind: ExperienceKind;
  organization: string;
  title: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  highlights: string[];
  skills: string[];
}
export interface ProjectDraft {
  name: string;
  role: string | null;
  description: string | null;
  url: string | null;
  repo_url: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  tech: string[];
  highlights: string[];
}
export interface CertificationDraft {
  name: string;
  issuer: string | null;
  issued_date: string | null;
  expires_date: null;
  credential_id: null;
  url: string | null;
}
export interface AchievementDraft {
  title: string;
  category: "award" | "competition" | "publication" | "other";
  description: string | null;
  achieved_on: string | null;
}

export interface EntryContext {
  /** Set when any date only had a year, so months are placeholders. */
  yearOnlyDates: boolean;
}

function spanOf(lines: string[], ctx: EntryContext): DateSpan | null {
  for (const line of lines) {
    const span = findDateSpan(line);
    if (span) {
      if (span.start?.yearOnly || span.end?.yearOnly) ctx.yearOnlyDates = true;
      return span;
    }
  }
  return null;
}

const dateFields = (span: DateSpan | null) => ({
  start_date: span?.start?.month ?? null,
  end_date: span?.isCurrent ? null : (span?.end?.month ?? null),
  is_current: span?.isCurrent ?? false,
});

const withoutDates = (lines: string[]) =>
  lines.map((line) => {
    const span = findDateSpan(line);
    return span ? stripSpan(line, span) : line;
  });

/* ---------------- education ---------------- */

const DEGREE =
  /\b(bachelor|master|doctor|ph\.?\s?d|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|m\.?\s?e\b|b\.?\s?sc|m\.?\s?sc|b\.?\s?c\.?\s?a|m\.?\s?c\.?\s?a|b\.?\s?com|m\.?\s?com|b\.?\s?a\b|m\.?\s?a\b|mba|bba|diploma|associate degree|high school|secondary|senior secondary|hsc|ssc|class (?:x|xii|10|12)|12th|10th|intermediate)\b/i;
const INSTITUTION =
  /\b(university|college|institute|school|academy|polytechnic|iit|nit|iiit|vidyalaya)\b/i;
const GRADE =
  /\b(?:cgpa|gpa|cpi|sgpa)\s*[:\-]?\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?|\b(\d{2,3}(?:\.\d+)?)\s*%/i;

function parseGrade(text: string): string | null {
  const m = GRADE.exec(text);
  if (!m) return null;
  if (m[1])
    return `${/gpa|cpi/i.test(m[0]) ? m[0].match(/cgpa|gpa|cpi|sgpa/i)![0].toUpperCase() : "CGPA"} ${m[1]}${m[2] ? ` / ${m[2]}` : ""}`;
  return `${m[3]}%`;
}

/**
 * Education lists often put each entry on consecutive lines with no blank line or bullets,
 * so entries are split wherever a second degree line appears.
 */
function educationBlocks(lines: string[]): Block[] {
  const groups: Block[] = [];
  let current: Block | null = null;
  let hasDegree = false;
  for (const line of lines) {
    if (line === "") {
      current = null;
      hasDegree = false;
      continue;
    }
    if (isBullet(line)) {
      if (current) current.bullets.push(stripBullet(line));
      continue;
    }
    const isDegreeLine = DEGREE.test(line);
    if (!current || (isDegreeLine && hasDegree)) {
      current = { header: [], bullets: [], extra: [] };
      groups.push(current);
      hasDegree = false;
    }
    current.header.push(line);
    if (isDegreeLine) hasDegree = true;
  }
  return groups;
}

export function extractEducation(lines: string[], ctx: EntryContext): EducationDraft[] {
  const drafts: EducationDraft[] = [];
  for (const block of educationBlocks(lines)) {
    const all = [...block.header, ...block.extra];
    const span = spanOf(all, ctx);
    const grade = parseGrade(all.join(" "));
    const cleaned = withoutDates(all).map((l) => l.replace(GRADE, "").replace(/[()]/g, " ").trim());
    const pieces = cleaned.flatMap(splitPieces).filter(Boolean);

    const degreePiece = pieces.find((p) => DEGREE.test(p));
    const institutionPiece = pieces.find((p) => INSTITUTION.test(p) && p !== degreePiece);
    if (!degreePiece) continue;

    // "Bachelor of Technology in Computer Science" -> degree + field
    const inMatch = /^(.*?)\s+(?:in|-|,)\s+(.+)$/i.exec(degreePiece);
    const degree = inMatch ? inMatch[1]!.trim() : degreePiece;
    const field = inMatch ? inMatch[2]!.trim() : null;

    const institution =
      institutionPiece ??
      pieces.find((p) => p !== degreePiece && !GRADE.test(p) && p.length > 3) ??
      "";
    if (!institution) continue;

    drafts.push({
      institution: clip(institution, 150),
      degree: clip(degree, 150),
      field_of_study: field ? clip(field, 150) : null,
      ...dateFields(span),
      grade: grade ? clip(grade, 40) : null,
      highlights: block.bullets.slice(0, 10).map((b) => clip(b, 300)),
    });
  }
  return drafts;
}

/* ---------------- experience ---------------- */

const TITLE =
  /\b(intern|trainee|developer|engineer|analyst|manager|lead|consultant|associate|administrator|designer|architect|scientist|specialist|executive|officer|assistant|director|head|coordinator|member|volunteer|captain|founder|co-founder|secretary|president|treasurer|representative|ambassador|mentor|tutor|researcher|programmer|tester|technician|fellow|apprentice|freelancer)\b/i;
const ORG_WORD =
  /\b(inc|ltd|llc|llp|pvt|private|limited|corp|corporation|technologies|software|labs|solutions|systems|consulting|services|group|company|co|studios|analytics|bank|university|college|institute|foundation|club|society|association|ngo)\b\.?/i;

interface RoleHeader {
  title: string | null;
  organization: string | null;
  location: string | null;
}

export function parseRoleHeader(headerLines: string[]): RoleHeader {
  const cleaned = withoutDates(headerLines);
  let pieces = cleaned.flatMap(splitPieces).filter(Boolean);

  // "Software Engineer at Acme" or "Engineer @ Acme"
  if (pieces.length === 1) {
    const at = /^(.*?)\s+(?:at|@)\s+(.+)$/i.exec(pieces[0]!);
    if (at) pieces = [at[1]!.trim(), at[2]!.trim()];
  }
  // "Intern, Acme Pvt Ltd" when nothing else separated the parts
  if (pieces.length === 1 && pieces[0]!.includes(",")) {
    pieces = pieces[0]!
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }

  const titleIdx = pieces.findIndex((p) => TITLE.test(p) && !ORG_WORD.test(p));
  const titleFallback = pieces.findIndex((p) => TITLE.test(p));
  const ti = titleIdx !== -1 ? titleIdx : titleFallback;
  const title = ti !== -1 ? pieces[ti]! : null;

  const rest = pieces.filter((_, i) => i !== ti);
  let organization = rest.find((p) => ORG_WORD.test(p)) ?? rest[0] ?? null;
  let location: string | null = null;

  if (organization?.includes(",")) {
    const [org, ...tail] = organization.split(",").map((p) => p.trim());
    const place = tail.join(", ");
    if (org && place && place.split(" ").length <= 4 && !ORG_WORD.test(place)) {
      organization = org;
      location = place;
    }
  }
  if (!location) {
    const other = rest.find((p) => p !== organization && p.split(" ").length <= 4);
    if (other && /^[\p{Lu}][\p{L} .'’-]+(?:,\s*[\p{Lu}][\p{L} .'’-]+)?$/u.test(other))
      location = other;
  }
  return { title, organization, location };
}

export function extractExperience(
  lines: string[],
  sectionKind: "experience" | "leadership",
  ctx: EntryContext,
): ExperienceDraft[] {
  const drafts: ExperienceDraft[] = [];
  for (const block of toBlocks(lines)) {
    const header = block.header.slice(0, 3);
    const { title, organization, location } = parseRoleHeader(header);
    if (!title || !organization) continue;

    const span = spanOf(header, ctx);
    let kind: ExperienceKind = sectionKind === "leadership" ? "leadership" : "work";
    if (/\bintern(ship)?\b/i.test(title)) kind = "internship";
    else if (/\bvolunteer\b/i.test(title) || /\bvolunteer/i.test(organization)) kind = "volunteer";

    const blockText = [...block.header, ...block.bullets, ...block.extra].join("\n");
    drafts.push({
      kind,
      organization: clip(organization, 150),
      title: clip(title, 150),
      location: location ? clip(location, 150) : null,
      ...dateFields(span),
      highlights: [...block.bullets, ...block.extra.map((e) => e)]
        .slice(0, 10)
        .map((b) => clip(b, 300)),
      skills: scanCatalogSkills(blockText)
        .map((s) => s.name)
        .slice(0, 30),
    });
  }
  return drafts;
}

/* ---------------- projects ---------------- */

const TECH_LINE =
  /^(?:tech(?:nologies)?(?: stack| used)?|stack|built with|tools?(?: used)?|technologies used)\s*[:\-]\s*(.+)$/i;
const ROLE_LINE = /^(?:my )?role\s*:\s*(.+)$/i;
const GITHUB_URL = /https?:\/\/(?:www\.)?github\.com\/[^\s|,;)]+/i;
const ANY_URL = /https?:\/\/[^\s|,;)]+/gi;

const splitList = (text: string) =>
  text
    .split(/[,;|•·]/)
    .map((t) => t.replace(/\band\b/gi, "").trim())
    .filter((t) => t.length > 0 && t.length <= 50);

export function extractProjects(lines: string[], ctx: EntryContext): ProjectDraft[] {
  const drafts: ProjectDraft[] = [];
  for (const block of toBlocks(lines)) {
    if (block.header.length === 0) continue;
    const span = spanOf(block.header, ctx);

    let role: string | null = null;
    let tech: string[] = [];
    const descriptionLines: string[] = [];
    let name = "";

    block.header.forEach((rawLine, index) => {
      const line = (
        findDateSpan(rawLine) ? stripSpan(rawLine, findDateSpan(rawLine)!) : rawLine
      ).trim();
      const techMatch = TECH_LINE.exec(line);
      const roleMatch = ROLE_LINE.exec(line);
      if (techMatch) {
        tech = splitList(techMatch[1]!);
      } else if (roleMatch) {
        role = roleMatch[1]!.trim();
      } else if (index === 0) {
        // "Name (Python, Django)" or "Name | Python, Django" or "Name - description"
        const paren = /^(.*?)\s*\(([^)]*,[^)]*)\)\s*(.*)$/.exec(line);
        if (paren) {
          name = paren[1]!.trim();
          tech = splitList(paren[2]!);
        } else {
          const [first, ...tail] = splitPieces(line);
          name = (first ?? line).replace(/^[•*-]\s*/, "").trim();
          for (const piece of tail) {
            if (piece.includes(",") || scanCatalogSkills(piece).length > 0)
              tech = tech.concat(splitList(piece));
            else descriptionLines.push(piece);
          }
        }
      } else if (line.length > 0 && !/^https?:\/\//i.test(line)) {
        descriptionLines.push(line);
      }
    });

    if (!name) continue;
    const blockText = [...block.header, ...block.bullets, ...block.extra].join("\n");
    if (tech.length === 0) tech = scanCatalogSkills(blockText).map((s) => s.name);

    const urls = [...blockText.matchAll(ANY_URL)].map((m) => m[0].replace(/[.,;]+$/, ""));
    const repo = GITHUB_URL.exec(blockText)?.[0].replace(/[.,;]+$/, "") ?? null;
    const other = urls.find((u) => u !== repo) ?? null;
    const description = [...descriptionLines, ...block.extra].join(" ").trim();

    drafts.push({
      name: clip(name, 150),
      role: role ? clip(role, 150) : null,
      description: description ? clip(description, 1000) : null,
      url: other,
      repo_url: repo,
      ...dateFields(span),
      tech: [...new Set(tech)].slice(0, 30),
      highlights: block.bullets.slice(0, 10).map((b) => clip(b, 300)),
    });
  }
  return drafts;
}

/* ---------------- certifications ---------------- */

export function extractCertifications(lines: string[], ctx: EntryContext): CertificationDraft[] {
  const drafts: CertificationDraft[] = [];
  for (const raw of lines) {
    if (!raw) continue;
    const line = isBullet(raw) ? stripBullet(raw) : raw;
    const span = spanOf([line], ctx);
    const text = span ? stripSpan(line, span) : line;
    const [name, issuer] = text
      .split(/\s+(?:-|–|—|by|from|\|)\s+|,\s+(?=[A-Z])/)
      .map((p) => p.trim());
    if (!name || name.length < 3) continue;
    drafts.push({
      name: clip(name, 200),
      issuer: issuer ? clip(issuer, 150) : null,
      issued_date: span?.start?.month ?? null,
      expires_date: null,
      credential_id: null,
      url: null,
    });
    if (drafts.length >= 20) break;
  }
  return drafts;
}

/* ---------------- achievements ---------------- */

function categorize(text: string): AchievementDraft["category"] {
  if (
    /\b(hackathon|competition|contest|olympiad|finalist|winner|won|champion|rank(?:ed)?|runner)\b/i.test(
      text,
    )
  ) {
    return "competition";
  }
  if (/\b(paper|publication|published|journal|conference|ieee|arxiv)\b/i.test(text))
    return "publication";
  if (/\b(award|scholarship|honou?r|recognition|medal|prize|certificate of)\b/i.test(text))
    return "award";
  return "other";
}

export function extractAchievements(lines: string[], ctx: EntryContext): AchievementDraft[] {
  const drafts: AchievementDraft[] = [];
  for (const raw of lines) {
    if (!raw) continue;
    const line = isBullet(raw) ? stripBullet(raw) : raw;
    if (line.length < 4) continue;
    const span = spanOf([line], ctx);
    const text = span ? stripSpan(line, span) : line;
    drafts.push({
      title: clip(text, 200),
      category: categorize(text),
      description: null,
      achieved_on: span?.start?.month ?? null,
    });
    if (drafts.length >= 20) break;
  }
  return drafts;
}
