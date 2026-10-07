import type { SkillType } from "@/lib/profile/constants";
import { SKILL_CATALOG, type CatalogSkill } from "@/lib/skills/catalog";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Types whose names are specific enough to trust when found in running prose. */
const PROSE_TYPES = new Set<SkillType>([
  "language",
  "framework",
  "database",
  "cloud_devops",
  "data_ml",
  "tool",
]);

/** Short or common words that are also skill aliases. Never matched in prose. */
const AMBIGUOUS_ALIASES = new Set([
  "next",
  "rest",
  "cloud",
  "security",
  "testing",
  "analytics",
  "spark",
  "shell",
  "sh",
  "os",
  "cv",
  "ml",
  "dl",
  "nest",
  "torch",
  "spring",
  "mongo",
  "py",
  "ts",
  "node",
  "r",
  "c",
  "go",
  "containers",
  "version control",
  "analytics",
  "sh",
  "elastic search",
  "dotnet",
]);

interface Matcher {
  skill: CatalogSkill;
  pattern: RegExp;
}

const BOUNDARY_BEFORE = "(?<![A-Za-z0-9+#.])";
const BOUNDARY_AFTER = "(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])";

let matchers: Matcher[] | null = null;

function buildMatchers(): Matcher[] {
  const list: Matcher[] = [];
  for (const skill of SKILL_CATALOG) {
    if (!PROSE_TYPES.has(skill.type)) continue;
    // Canonical names are matched case-sensitively: "Excel" the tool, not "excel" the verb.
    if (skill.name.length > 2) {
      list.push({
        skill,
        pattern: new RegExp(`${BOUNDARY_BEFORE}${escapeRegExp(skill.name)}${BOUNDARY_AFTER}`),
      });
    }
    for (const alias of skill.aliases) {
      if (alias.length < 3 || AMBIGUOUS_ALIASES.has(alias.toLowerCase())) continue;
      list.push({
        skill,
        pattern: new RegExp(`${BOUNDARY_BEFORE}${escapeRegExp(alias)}${BOUNDARY_AFTER}`, "i"),
      });
    }
  }
  return list;
}

/** Catalog skills mentioned in free text. Conservative on purpose: false positives mislead. */
export function scanCatalogSkills(text: string): CatalogSkill[] {
  matchers ??= buildMatchers();
  const found = new Map<string, CatalogSkill>();
  for (const { skill, pattern } of matchers) {
    if (!found.has(skill.slug) && pattern.test(text)) found.set(skill.slug, skill);
  }
  return [...found.values()];
}
