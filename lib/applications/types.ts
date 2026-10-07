import { z } from "zod";

/**
 * The application pipeline. A status is the person's own statement of where an application
 * stands: HireOS never submits anything, so "applied" means they applied themselves.
 */

export const STATUSES = [
  "discovered",
  "shortlisted",
  "preparing",
  "applied",
  "assessment",
  "interview",
  "final_round",
  "offer",
  "rejected",
  "withdrawn",
  "no_response",
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  discovered: "Discovered",
  shortlisted: "Shortlisted",
  preparing: "Preparing",
  applied: "Applied",
  assessment: "Assessment",
  interview: "Interview",
  final_round: "Final round",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  no_response: "No response",
};

/** Statuses a new application can start in. Anything later must be reached by moving. */
export const INITIAL_STATUSES = ["discovered", "shortlisted", "preparing", "applied"] as const;
export type InitialStatus = (typeof INITIAL_STATUSES)[number];

/** Statuses that mean the person has applied, so an application date must exist. */
export const APPLIED_STATUSES: readonly Status[] = [
  "applied",
  "assessment",
  "interview",
  "final_round",
  "offer",
];

/** Closed outcomes shown apart from the live pipeline. */
export const CLOSED_STATUSES: readonly Status[] = ["rejected", "withdrawn", "no_response"];

/** Statuses where a reply is awaited, so a follow-up can be due. */
export const AWAITING_STATUSES: readonly Status[] = ["applied", "assessment", "interview"];

/**
 * Which moves are allowed. This is the single definition the service, the memory store and
 * the database table are all tested against.
 */
export const TRANSITIONS: Record<Status, readonly Status[]> = {
  discovered: ["shortlisted", "preparing", "withdrawn"],
  shortlisted: ["discovered", "preparing", "applied", "withdrawn"],
  preparing: ["shortlisted", "applied", "withdrawn"],
  applied: ["assessment", "interview", "rejected", "withdrawn", "no_response"],
  assessment: ["interview", "rejected", "withdrawn", "no_response"],
  interview: ["assessment", "final_round", "offer", "rejected", "withdrawn", "no_response"],
  final_round: ["offer", "rejected", "withdrawn", "no_response"],
  offer: ["rejected", "withdrawn"],
  rejected: [],
  withdrawn: ["shortlisted"],
  no_response: ["applied", "interview", "rejected", "withdrawn"],
};

export const canMove = (from: Status, to: Status) => TRANSITIONS[from].includes(to);

/** Days without activity before an awaited application is flagged for a follow-up. */
export const DEFAULT_FOLLOW_UP_DAYS = 7;

export const EVENT_KINDS = [
  "created",
  "status_changed",
  "note",
  "followed_up",
  "follow_up_set",
  "documents_linked",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Kinds the person can add themselves. The rest are written by the system. */
export const USER_EVENT_KINDS = ["note", "followed_up"] as const;

export const MAX_NOTE = 1000;
export const MAX_NOTES = 2000;
export const MAX_APPLICATIONS = 500;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter a valid date");

/** Free text, single paragraph: control characters out, whitespace collapsed. */
const cleanNote = (max: number) =>
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

export const createApplicationSchema = z.object({
  jobId: z.uuid(),
  status: z.enum(INITIAL_STATUSES).default("shortlisted"),
  /** When they applied, if they already have. Defaults to today for an applied start. */
  applied_on: isoDate.nullish().transform((v) => v ?? null),
});

export const changeStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(STATUSES),
  note: cleanNote(MAX_NOTE),
  on: isoDate.nullish().transform((v) => v ?? null),
});

export const updateDetailsSchema = z.object({
  id: z.uuid(),
  notes: cleanNote(MAX_NOTES),
  follow_up_on: isoDate.nullish().transform((v) => v ?? null),
  resume_version_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  cover_letter_version_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
});

export const addEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum(USER_EVENT_KINDS),
  note: cleanNote(MAX_NOTE),
});
