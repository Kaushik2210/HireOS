import type { SkillLevel, SkillType } from "@/lib/profile/constants";
import { normalizeSkill, type CatalogSkill } from "@/lib/skills/catalog";
import { scanCatalogSkills } from "@/lib/skills/scan";

export interface SkillDraft {
  name: string;
  type: SkillType;
  level: SkillLevel;
  years: null;
}

const LABEL_TYPES: [RegExp, SkillType][] = [
  [/lang/i, "language"],
  [/framework|librar/i, "framework"],
  [/database|\bdb\b|data ?store/i, "database"],
  [/cloud|devops|infra/i, "cloud_devops"],
  [/machine|\bml\b|\bai\b|analytic|data (?:science|analysis)/i, "data_ml"],
  [/soft|interpersonal|professional/i, "soft"],
  [/concept|domain|fundamental|core/i, "domain"],
  [/tool|platform|software|technolog/i, "tool"],
];

const GENERIC_WORDS = new Set([
  "basic",
  "basics",
  "intermediate",
  "advanced",
  "proficient",
  "familiar",
  "knowledge",
  "experience",
  "skills",
  "other",
  "others",
  "etc",
  "fluent",
  "good",
  "strong",
  "working",
  "beginner",
  "expert",
  "and",
  "or",
  "with",
  "in",
  "of",
  "the",
  "various",
  "multiple",
]);

function plausibleSkillName(token: string): boolean {
  if (token.length < 2 || token.length > 30) return false;
  if (!/^[A-Z0-9][\w+#.&' /-]*$/.test(token)) return false;
  if (token.split(" ").length > 3) return false;
  if (/^\d+$/.test(token)) return false;
  return !GENERIC_WORDS.has(token.toLowerCase());
}

function typeFromLabel(label: string | null): SkillType | null {
  if (!label) return null;
  return LABEL_TYPES.find(([re]) => re.test(label))?.[1] ?? null;
}

export interface SkillExtraction {
  drafts: SkillDraft[];
  /** Catalog skills found anywhere in the evidence text (experience and projects). */
  mentioned: CatalogSkill[];
}

/**
 * Builds skill drafts from the skills section plus technologies mentioned in experience
 * and projects. Levels are derived from evidence, never guessed:
 *   listed only            beginner
 *   used in a role/project intermediate
 * The user sets the real level during review.
 */
export function extractSkills(skillLines: string[], evidenceText: string): SkillExtraction {
  const listed = new Map<string, { name: string; type: SkillType }>();

  for (const rawLine of skillLines) {
    const line = rawLine.replace(/^•\s*/, "");
    const labelled = /^([A-Za-z][A-Za-z &/+-]{2,40}):\s*(.+)$/.exec(line);
    const label = labelled ? labelled[1]! : null;
    const body = labelled ? labelled[2]! : line;
    const labelType = typeFromLabel(label);

    for (const part of body.split(/[,;|•·]/)) {
      const token = part
        .replace(/\([^)]*\)/g, "")
        .replace(/\b(?:etc|and more)\b\.?/gi, "")
        .trim()
        .replace(/[.:]+$/, "");
      if (!token) continue;

      const hit = normalizeSkill(token);
      let name: string;
      let type: SkillType;
      if (hit.recognised && hit.type) {
        name = hit.name;
        type = hit.type;
      } else if (labelType && plausibleSkillName(token)) {
        name = hit.name;
        type = labelType;
      } else {
        continue;
      }
      const key = name.toLowerCase();
      if (!listed.has(key)) listed.set(key, { name, type });
    }
  }

  const mentioned = scanCatalogSkills(evidenceText);
  const used = new Set(mentioned.map((s) => s.name.toLowerCase()));

  const drafts = new Map<string, SkillDraft>();
  for (const [key, { name, type }] of listed) {
    drafts.set(key, {
      name,
      type,
      level: used.has(key) ? "intermediate" : "beginner",
      years: null,
    });
  }
  for (const skill of mentioned) {
    const key = skill.name.toLowerCase();
    if (!drafts.has(key)) {
      drafts.set(key, { name: skill.name, type: skill.type, level: "intermediate", years: null });
    }
  }
  return { drafts: [...drafts.values()].slice(0, 50), mentioned };
}
