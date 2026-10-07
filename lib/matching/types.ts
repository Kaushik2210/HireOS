import { z } from "zod";

/**
 * Application Strength: how well a person's *verified* profile lines up with one job's stated
 * requirements. It describes the match on paper. It is never a prediction of whether anyone
 * will be interviewed or hired, and nothing here is worded as one.
 */

/** Bump when weights, thresholds or rules change, so stored results can be told apart. */
export const SCORER_VERSION = 1;

export const COMPONENT_IDS = [
  "skills",
  "projects",
  "experience",
  "keywords",
  "education",
  "location",
  "seniority",
] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

/** Points available per component. They sum to 100. */
export const COMPONENT_WEIGHTS: Record<ComponentId, number> = {
  skills: 30,
  projects: 15,
  experience: 15,
  keywords: 10,
  education: 10,
  location: 10,
  seniority: 10,
};

export const COMPONENT_LABELS: Record<ComponentId, string> = {
  skills: "Skill match",
  projects: "Project relevance",
  experience: "Experience match",
  keywords: "Keyword coverage",
  education: "Education match",
  location: "Location match",
  seniority: "Seniority match",
};

export const MATCH_LABELS = ["strong", "good", "stretch", "low"] as const;
export type MatchLabel = (typeof MATCH_LABELS)[number];

/** Lower bounds, inclusive. Anything below `stretch` is "low". */
export const LABEL_THRESHOLDS = { strong: 80, good: 65, stretch: 45 } as const;

/** Applied when too few required skills are found, so other components cannot hide the gap. */
export const SKILL_CAP = { minRequiredSkills: 3, minCoverage: 0.4, maxStrength: 54 } as const;

export const MATCH_LABEL_TEXT: Record<MatchLabel, string> = {
  strong: "Strong",
  good: "Good",
  stretch: "Stretch",
  low: "Low",
};

export function labelFor(strength: number): MatchLabel {
  if (strength >= LABEL_THRESHOLDS.strong) return "strong";
  if (strength >= LABEL_THRESHOLDS.good) return "good";
  if (strength >= LABEL_THRESHOLDS.stretch) return "stretch";
  return "low";
}

/* ---------- result shape (also validates stored results) ---------- */

export const sourceRefSchema = z.object({ entity: z.string(), id: z.string() });
export type SourceRef = z.output<typeof sourceRefSchema>;

export const inputSchema = z.object({ label: z.string(), value: z.string() });

export const componentSchema = z.object({
  id: z.enum(COMPONENT_IDS),
  label: z.string(),
  weight: z.number(),
  /** False when the job does not state what this component needs. It then carries no weight. */
  applicable: z.boolean(),
  /** 0 to 100, or null when not applicable. */
  score: z.number().min(0).max(100).nullable(),
  /** One plain sentence on how the score came about. */
  summary: z.string(),
  /** The actual values compared, so the number can be checked by hand. */
  inputs: z.array(inputSchema),
});
export type MatchComponent = z.output<typeof componentSchema>;

export const evidenceSchema = z.object({
  text: z.string(),
  /** The verified profile item this rests on. Null for facts about preferences. */
  source_ref: sourceRefSchema.nullable(),
});
export type Evidence = z.output<typeof evidenceSchema>;

export const GAP_KINDS = [
  "required_skill",
  "weak_skill",
  "preferred_skill",
  "experience",
  "education",
  "seniority",
  "location",
] as const;

export const gapSchema = z.object({
  kind: z.enum(GAP_KINDS),
  severity: z.enum(["high", "medium", "low"]),
  text: z.string(),
  suggestion: z.string().nullable(),
});
export type Gap = z.output<typeof gapSchema>;

export const ACTION_KINDS = [
  "apply",
  "tailor",
  "close_gaps",
  "reconsider",
  "build_profile",
] as const;

export const matchResultSchema = z.object({
  scorer_version: z.number(),
  strength: z.number().min(0).max(100),
  label: z.enum(MATCH_LABELS),
  /** Set when the skills cap lowered the result. Shown so the number is never a surprise. */
  cap: z.object({ applied: z.boolean(), reason: z.string().nullable() }),
  components: z.array(componentSchema).length(COMPONENT_IDS.length),
  why: z.array(evidenceSchema),
  gaps: z.array(gapSchema),
  keywords: z.object({ covered: z.array(z.string()), missing: z.array(z.string()) }),
  concerns: z.array(z.string()),
  action: z.object({ kind: z.enum(ACTION_KINDS), text: z.string() }),
});
export type MatchResult = z.output<typeof matchResultSchema>;
