import type {
  ChecklistItem,
  InterviewFormat,
  InterviewKind,
  InterviewStatus,
} from "@/lib/interview/types";

export interface Interview {
  id: string;
  applicationId: string;
  roundLabel: string;
  kind: InterviewKind;
  format: InterviewFormat | null;
  /** The person's own wall-clock date (YYYY-MM-DD) and time (HH:MM). No time zone is assumed. */
  scheduledOn: string | null;
  scheduledTime: string | null;
  interviewer: string | null;
  notes: string | null;
  status: InterviewStatus;
  checklist: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

export interface InterviewFields {
  roundLabel: string;
  kind: InterviewKind;
  format: InterviewFormat | null;
  scheduledOn: string | null;
  scheduledTime: string | null;
  interviewer: string | null;
  notes: string | null;
}

export interface NewInterview extends InterviewFields {
  applicationId: string;
  checklist: ChecklistItem[];
}

export type InterviewStoreErrorKind = "limit" | "not_found" | "unknown";

export class InterviewStoreError extends Error {
  constructor(
    public readonly kind: InterviewStoreErrorKind,
    cause?: unknown,
  ) {
    super(`Interview store error: ${kind}`, cause === undefined ? undefined : { cause });
    this.name = "InterviewStoreError";
  }
}

export type UpdateOutcome = "updated" | "not_found";

export interface InterviewStore {
  /** The user's rounds, soonest first; rounds without a date come last. */
  list(userId: string, filter?: { applicationId?: string }): Promise<Interview[]>;
  /** Null when it does not exist or belongs to someone else. */
  get(userId: string, id: string): Promise<Interview | null>;
  /** The application must be the user's own; the caller checks, and the database enforces it too. */
  create(userId: string, input: NewInterview): Promise<Interview>;
  update(
    userId: string,
    id: string,
    fields: InterviewFields & { status: InterviewStatus },
  ): Promise<UpdateOutcome>;
  setChecklist(userId: string, id: string, checklist: ChecklistItem[]): Promise<UpdateOutcome>;
  remove(userId: string, id: string): Promise<boolean>;
  /** Rounds go with their application. The database cascades; the demo store does it here. */
  removeForApplication(userId: string, applicationId: string): Promise<void>;
}
