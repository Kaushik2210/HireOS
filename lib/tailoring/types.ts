import { z } from "zod";

/**
 * Tailored documents. A resume is assembled only from the user's verified profile items:
 * every line is a claim that points back at the item and field it was copied from, and a
 * separate verifier re-checks each claim before the document can be approved.
 */

/** Bump when selection rules or the document shape change. */
export const TAILOR_VERSION = 1;

export const DOCUMENT_KINDS = ["resume", "cover_letter"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const VERSION_STATUSES = ["draft", "approved"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/** Section limits. Tailoring selects within these; it never pads to reach them. */
export const LIMITS = {
  skills: 25,
  bulletsPerEntry: 4,
  projects: 3,
  certifications: 5,
  achievements: 3,
} as const;

/** Largest rendered document, matching the database check. */
export const MAX_DOCUMENT_TEXT = 20_000;

export const CLAIM_KINDS = [
  "headline",
  "summary",
  "skill",
  "heading",
  "bullet",
  "detail",
  "sentence",
] as const;

/**
 * Where a claim's words came from. `fields` names the item fields (`highlights.2` is the
 * third highlight). `job` marks wording that comes from the posting itself, such as the
 * role title in a letter's opening line.
 */
export const sourceRefSchema = z.object({
  entity: z.enum([
    "profiles",
    "education",
    "experiences",
    "projects",
    "certifications",
    "skills",
    "achievements",
    "jobs",
    // Text the user typed into a form, such as how they know a contact.
    "user_input",
  ]),
  id: z.string().min(1),
  fields: z.array(z.string().min(1)).min(1),
});
export type SourceRef = z.output<typeof sourceRefSchema>;

export const claimSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(CLAIM_KINDS),
  text: z.string().min(1).max(1500),
  /** One or more items the text was built from. */
  refs: z.array(sourceRefSchema).min(1),
});
export type Claim = z.output<typeof claimSchema>;

export const entrySchema = z.object({
  /** The profile item this block is built from. */
  ref: z.object({ entity: z.string(), id: z.string() }),
  heading: claimSchema,
  /** Dates, location and similar facts, copied from the item. */
  detail: claimSchema.nullable(),
  bullets: z.array(claimSchema),
});
export type Entry = z.output<typeof entrySchema>;

export const resumeDocSchema = z.object({
  tailor_version: z.number().int(),
  header: z.object({
    name: claimSchema,
    headline: claimSchema.nullable(),
    details: z.array(claimSchema),
  }),
  summary: claimSchema.nullable(),
  skills: z.array(claimSchema),
  experience: z.array(entrySchema),
  projects: z.array(entrySchema),
  education: z.array(entrySchema),
  certifications: z.array(entrySchema),
  achievements: z.array(entrySchema),
});
export type ResumeDoc = z.output<typeof resumeDocSchema>;

export const CHANGE_KINDS = [
  "skill_first",
  "skill_later",
  "project_included",
  "project_left_out",
  "bullets_reordered",
  "bullet_left_out",
  "entry_left_out",
  "item_excluded",
] as const;

export const changeSchema = z.object({
  kind: z.enum(CHANGE_KINDS),
  section: z.string(),
  /** What the change is about, such as a skill or project name. */
  subject: z.string(),
  /** Why, in plain words, tied to the posting. */
  reason: z.string(),
  ref: z.object({ entity: z.string(), id: z.string() }).nullable(),
});
export type Change = z.output<typeof changeSchema>;

export const missingSchema = z.object({
  skill: z.string(),
  required: z.boolean(),
  text: z.string(),
});
export type MissingRequirement = z.output<typeof missingSchema>;

export const blockedSchema = z.object({
  claim_id: z.string(),
  text: z.string(),
  reason: z.string(),
});
export type BlockedClaim = z.output<typeof blockedSchema>;

export const verificationSchema = z.object({
  ok: z.boolean(),
  checked: z.number().int().min(0),
  blocked: z.array(blockedSchema),
});
export type Verification = z.output<typeof verificationSchema>;

/** A cover letter: paragraphs of claims, plus the text as the user last saved it. */
export const letterDocSchema = z.object({
  tailor_version: z.number().int(),
  paragraphs: z.array(z.array(claimSchema).min(1)),
  /** The text shown and saved. Differs from the claims once the user edits it. */
  text: z.string().min(1).max(MAX_DOCUMENT_TEXT),
  edited: z.boolean(),
});
export type LetterDoc = z.output<typeof letterDocSchema>;

export const versionContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resume"), doc: resumeDocSchema }),
  z.object({ kind: z.literal("cover_letter"), doc: letterDocSchema }),
]);
export type VersionContent = z.output<typeof versionContentSchema>;
