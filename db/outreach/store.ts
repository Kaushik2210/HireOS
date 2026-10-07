import type { Channel, DraftStatus, OutreachDoc, OutreachType } from "@/lib/outreach/types";
import type { Verification } from "@/lib/tailoring/types";

export interface OutreachDraft {
  id: string;
  jobId: string;
  type: OutreachType;
  channel: Channel;
  recipientName: string | null;
  recipientTitle: string | null;
  sharedContext: string | null;
  subject: string | null;
  body: string;
  doc: OutreachDoc;
  verification: Verification;
  profileHash: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  sentAt: string | null;
}

export interface NewDraft {
  jobId: string;
  type: OutreachType;
  recipientName: string | null;
  recipientTitle: string | null;
  sharedContext: string | null;
  doc: OutreachDoc;
  verification: Verification;
  profileHash: string;
}

export interface DraftEdit {
  doc: OutreachDoc;
  verification: Verification;
  profileHash: string;
}

export type OutreachStoreErrorKind = "limit" | "unknown";

export class OutreachStoreError extends Error {
  constructor(
    public readonly kind: OutreachStoreErrorKind,
    cause?: unknown,
  ) {
    super(`Outreach store error: ${kind}`, cause === undefined ? undefined : { cause });
    this.name = "OutreachStoreError";
  }
}

export type EditOutcome = "updated" | "not_found" | "locked";
export type ApproveOutcome = "approved" | "not_found" | "blocked" | "already_approved";
export type SentOutcome = "sent" | "not_found" | "not_approved" | "already_sent";

/** Most drafts kept per user. The database enforces the same number. */
export const MAX_DRAFTS = 300;

export interface OutreachStore {
  /** The user's drafts, newest first. */
  list(userId: string, filter?: { jobId?: string }): Promise<OutreachDraft[]>;
  /** Null when the draft does not exist or belongs to someone else. */
  get(userId: string, id: string): Promise<OutreachDraft | null>;
  create(userId: string, input: NewDraft): Promise<OutreachDraft>;
  /** Only a draft that is still a draft can be edited. */
  edit(userId: string, id: string, edit: DraftEdit): Promise<EditOutcome>;
  /** Approving needs a passing integrity check and freezes the words. */
  approve(userId: string, id: string): Promise<ApproveOutcome>;
  /** The user's own record that they sent it. HireOS sends nothing. */
  markSent(userId: string, id: string): Promise<SentOutcome>;
  remove(userId: string, id: string): Promise<boolean>;
  /** Drops a job's drafts. The database does this by cascade; the demo store does it here. */
  removeForJob(userId: string, jobId: string): Promise<void>;
}
