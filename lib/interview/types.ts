import { z } from "zod";

/**
 * Interview preparation. Everything here is deterministic: questions come from a built-in
 * bank and are chosen from the job and the person's verified profile, and practice answers
 * are scored on how they are built. Nothing here is written or judged by an AI model, and
 * nothing is shared with anyone.
 */

export const INTERVIEW_KINDS = [
  "phone_screen",
  "technical",
  "behavioral",
  "system_design",
  "hr",
  "final",
  "other",
] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

export const INTERVIEW_KIND_LABELS: Record<InterviewKind, string> = {
  phone_screen: "Phone screen",
  technical: "Technical",
  behavioral: "Behavioral",
  system_design: "System design",
  hr: "HR conversation",
  final: "Final round",
  other: "Other",
};

export const FORMATS = ["video", "phone", "onsite", "take_home"] as const;
export type InterviewFormat = (typeof FORMATS)[number];

export const FORMAT_LABELS: Record<InterviewFormat, string> = {
  video: "Video call",
  phone: "Phone call",
  onsite: "On site",
  take_home: "Take-home task",
};

export const INTERVIEW_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const MAX_CHECKLIST = 30;
export const MAX_INTERVIEWS = 200;
export const MAX_INTERVIEW_NOTES = 2000;
export const MAX_ANSWER = 3000;
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 10;
export const MAX_SESSIONS = 200;

export const checklistItemSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(200),
  done: z.boolean(),
  source: z.enum(["generated", "custom"]),
});
export type ChecklistItem = z.output<typeof checklistItemSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter a valid date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time like 14:30");

/** Single-line text: control characters out, whitespace collapsed, blank becomes null. */
const oneLine = (max: number) =>
  z
    .string()
    .max(max * 2)
    .nullish()
    .transform((v) => {
      const cleaned = (v ?? "")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return cleaned.length > 0 ? cleaned : null;
    })
    .refine((v) => v === null || v.length <= max, `Use at most ${max} characters`);

/** Free text over several lines: control characters out except line breaks. */
const multiLine = (max: number) =>
  z
    .string()
    .max(max * 2)
    .nullish()
    .transform((v) => {
      const cleaned = (v ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
        .trim();
      return cleaned.length > 0 ? cleaned : null;
    })
    .refine((v) => v === null || v.length <= max, `Use at most ${max} characters`);

const requiredLine = (label: string, max: number) =>
  oneLine(max).refine((v) => v !== null, `Enter ${label}`);

export const interviewFieldsSchema = z.object({
  round_label: requiredLine("a name for this round", 100),
  kind: z.enum(INTERVIEW_KINDS),
  format: z
    .enum(FORMATS)
    .nullish()
    .transform((v) => v ?? null),
  scheduled_on: isoDate.nullish().transform((v) => v ?? null),
  scheduled_time: hhmm.nullish().transform((v) => v ?? null),
  interviewer: oneLine(150),
  notes: multiLine(MAX_INTERVIEW_NOTES),
});

export const createInterviewSchema = interviewFieldsSchema
  .extend({ application_id: z.uuid() })
  .refine((v) => v.scheduled_time === null || v.scheduled_on !== null, {
    message: "Add a date to go with the time",
    path: ["scheduled_on"],
  });

export const updateInterviewSchema = interviewFieldsSchema
  .extend({ id: z.uuid(), status: z.enum(INTERVIEW_STATUSES) })
  .refine((v) => v.scheduled_time === null || v.scheduled_on !== null, {
    message: "Add a date to go with the time",
    path: ["scheduled_on"],
  });

export const checklistToggleSchema = z.object({
  id: z.uuid(),
  item_id: z.string().min(1).max(40),
  done: z.boolean(),
});

export const checklistAddSchema = z.object({
  id: z.uuid(),
  text: requiredLine("an item", 200),
});

/* ---------- questions ---------- */

export const QUESTION_KINDS = [
  "behavioral",
  "technical",
  "project",
  "experience",
  "motivation",
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const questionSchema = z.object({
  /** Stable for the same bank entry or profile item, so a session can be traced back. */
  id: z.string().min(1).max(120),
  kind: z.enum(QUESTION_KINDS),
  text: z.string().min(1).max(500),
  /** The posting's skill this question is about, when it is one. */
  skill: z.string().nullable(),
  /** Groups of words: an answer covers a group when it uses any word in it. */
  expects: z.array(z.array(z.string().min(1)).min(1)).max(6),
  /** True when the posting asks for this skill and the verified profile does not show it. */
  gap: z.boolean(),
});
export type Question = z.output<typeof questionSchema>;

/* ---------- practice scoring ---------- */

export const DIMENSION_IDS = [
  "structure",
  "specificity",
  "relevance",
  "evidence",
  "clarity",
  "integrity",
] as const;
export type DimensionId = (typeof DIMENSION_IDS)[number];

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  structure: "Structure",
  specificity: "Specificity",
  relevance: "Relevance",
  evidence: "Evidence from your own work",
  clarity: "Clarity",
  integrity: "Honesty about your profile",
};

export const dimensionSchema = z.object({
  id: z.enum(DIMENSION_IDS),
  label: z.string(),
  /** False when the question gives no basis for this dimension; it is then left out. */
  applicable: z.boolean(),
  score: z.number().int().min(0).max(100).nullable(),
  summary: z.string(),
  inputs: z.array(z.object({ label: z.string(), value: z.string() })),
  /** A hedged suggestion, present when there is something to improve. */
  suggestion: z.string().nullable(),
});
export type Dimension = z.output<typeof dimensionSchema>;

export const answerFeedbackSchema = z.object({
  scorer_version: z.number().int(),
  overall: z.number().int().min(0).max(100),
  band: z.enum(["needs_work", "decent", "strong"]),
  dimensions: z.array(dimensionSchema).length(DIMENSION_IDS.length),
  /** The most useful things to change, hedged, at most three. */
  improve: z.array(z.string()).max(3),
});
export type AnswerFeedback = z.output<typeof answerFeedbackSchema>;

export const MOCK_FOCUS = ["technical", "behavioral", "screen", "final"] as const;
export type MockFocus = (typeof MOCK_FOCUS)[number];

export const MOCK_FOCUS_LABELS: Record<MockFocus, string> = {
  technical: "Technical",
  behavioral: "Behavioral",
  screen: "Screening call",
  final: "Final round (mixed)",
};

export const startSessionSchema = z.object({
  jobId: z.uuid(),
  focus: z.enum(MOCK_FOCUS),
  count: z.number().int().min(MIN_QUESTIONS).max(MAX_QUESTIONS),
});

export const submitAnswerSchema = z.object({
  sessionId: z.uuid(),
  position: z.number().int().min(0).max(MAX_QUESTIONS),
  answer: z
    .string()
    .max(MAX_ANSWER * 2)
    .transform((v) =>
      v
        .replace(/\r\n/g, "\n")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
        .trim(),
    )
    .refine((v) => v.length >= 1, "Write an answer first")
    .refine((v) => v.length <= MAX_ANSWER, `Use at most ${MAX_ANSWER} characters`),
});

export const BAND_TEXT = {
  needs_work: "Needs work on these measures",
  decent: "Decent on these measures",
  strong: "Strong on these measures",
} as const;
