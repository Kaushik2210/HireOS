import { z } from "zod";
import { claimSchema } from "@/lib/tailoring/types";

/**
 * Outreach drafts. HireOS only writes the words: the user copies a draft and sends it
 * themselves, from their own email or LinkedIn account. Nothing here connects to, scrapes or
 * automates LinkedIn or any mail service.
 */

export const OUTREACH_TYPES = [
  "recruiter",
  "hiring_manager",
  "referral",
  "alumni",
  "linkedin_note",
  "follow_up",
  "thank_you",
] as const;
export type OutreachType = (typeof OUTREACH_TYPES)[number];

export const CHANNELS = ["email", "linkedin"] as const;
export type Channel = (typeof CHANNELS)[number];

export const DRAFT_STATUSES = ["draft", "approved", "sent"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export interface OutreachMeta {
  label: string;
  channel: Channel;
  description: string;
  /** The user must supply how they are connected to the person. */
  needsContext?: boolean;
  /** The user must confirm something has really happened before the draft can claim it. */
  confirm?: "applied" | "spoken";
}

export const OUTREACH_META: Record<OutreachType, OutreachMeta> = {
  recruiter: {
    label: "Recruiter email",
    channel: "email",
    description: "Introduce yourself to a recruiter for this role.",
  },
  hiring_manager: {
    label: "Hiring manager email",
    channel: "email",
    description: "A short note asking for a brief conversation.",
  },
  referral: {
    label: "Referral request",
    channel: "email",
    description: "Ask someone you know whether they would refer you.",
  },
  alumni: {
    label: "Alumni outreach",
    channel: "email",
    description: "Reach out to someone you share a school or community with.",
    needsContext: true,
  },
  linkedin_note: {
    label: "LinkedIn connection note",
    channel: "linkedin",
    description: "A note of at most 300 characters. Copy it and send it yourself.",
  },
  follow_up: {
    label: "Follow-up email",
    channel: "email",
    description: "Check in after you have applied.",
    confirm: "applied",
  },
  thank_you: {
    label: "Thank-you email",
    channel: "email",
    description: "Thank someone after you have spoken.",
    confirm: "spoken",
  },
};

export const CONFIRM_TEXT = {
  applied: "I have already applied for this job.",
  spoken: "I have already spoken with this person.",
} as const;

/** LinkedIn's limit for a connection request note. */
export const LINKEDIN_NOTE_LIMIT = 300;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 5000;
export const MAX_DRAFTS_PER_USER = 300;

/** One line of text: control characters removed, whitespace collapsed, blank becomes null. */
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

/** What the person tells us about the message. Everything else comes from stored data. */
export const outreachInputSchema = z.object({
  type: z.enum(OUTREACH_TYPES),
  recipient_name: oneLine(100),
  recipient_title: oneLine(100),
  shared_context: oneLine(300),
  confirm_applied: z.boolean().default(false),
  confirm_spoken: z.boolean().default(false),
});
export type OutreachInput = z.output<typeof outreachInputSchema>;

export const outreachDocSchema = z.object({
  tailor_version: z.number().int(),
  channel: z.enum(CHANNELS),
  subject: z.string().max(MAX_SUBJECT).nullable(),
  paragraphs: z.array(z.array(claimSchema).min(1)),
  /** The body as shown and saved. Differs from the claims once the user edits it. */
  text: z.string().min(1).max(MAX_BODY),
  edited: z.boolean(),
});
export type OutreachDoc = z.output<typeof outreachDocSchema>;
