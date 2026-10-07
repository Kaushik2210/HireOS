import type { EventKind, InitialStatus, Status } from "@/lib/applications/types";

export interface Application {
  id: string;
  /** Null once the job itself has been deleted; the title and company are kept. */
  jobId: string | null;
  jobTitle: string;
  companyName: string;
  status: Status;
  /** YYYY-MM-DD. Set when the person says they applied. */
  appliedOn: string | null;
  followUpOn: string | null;
  notes: string | null;
  resumeVersionId: string | null;
  coverLetterVersionId: string | null;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
  /** True for the sample applications shown in demo mode. */
  isDemo: boolean;
}

export interface ApplicationEvent {
  id: string;
  applicationId: string;
  kind: EventKind;
  fromStatus: Status | null;
  toStatus: Status | null;
  note: string | null;
  createdAt: string;
}

export interface NewApplication {
  jobId: string;
  jobTitle: string;
  companyName: string;
  status: InitialStatus;
  /** Only for an applied start; defaults to today. */
  appliedOn: string | null;
}

export interface DetailsUpdate {
  notes: string | null;
  followUpOn: string | null;
  resumeVersionId: string | null;
  coverLetterVersionId: string | null;
}

export type ApplicationStoreErrorKind = "duplicate" | "limit" | "invalid" | "unknown";

export class ApplicationStoreError extends Error {
  constructor(
    public readonly kind: ApplicationStoreErrorKind,
    cause?: unknown,
  ) {
    super(`Application store error: ${kind}`, cause === undefined ? undefined : { cause });
    this.name = "ApplicationStoreError";
  }
}

export type MoveOutcome = "moved" | "not_found" | "not_allowed";
export type UpdateOutcome = "updated" | "not_found" | "invalid_document";
export type EventOutcome = "added" | "not_found" | "invalid";

export interface ApplicationWithEvents {
  application: Application;
  /** Oldest first. */
  events: ApplicationEvent[];
}

export interface ApplicationStore {
  /** All of the user's applications, most recently moved first. */
  list(userId: string): Promise<Application[]>;
  /** Null when it does not exist or belongs to someone else. */
  get(userId: string, id: string): Promise<ApplicationWithEvents | null>;
  getByJob(userId: string, jobId: string): Promise<Application | null>;
  create(userId: string, input: NewApplication): Promise<Application>;
  /** Moves only along allowed transitions and logs the move in the same step. */
  changeStatus(
    userId: string,
    id: string,
    to: Status,
    note: string | null,
    appliedOn: string | null,
  ): Promise<MoveOutcome>;
  updateDetails(userId: string, id: string, update: DetailsUpdate): Promise<UpdateOutcome>;
  /** Only notes and "I followed up" can be added by hand. */
  addEvent(
    userId: string,
    id: string,
    kind: "note" | "followed_up",
    note: string | null,
  ): Promise<EventOutcome>;
  remove(userId: string, id: string): Promise<boolean>;
  /** A deleted job leaves its applications in place. The database does this by foreign key; the demo store here. */
  detachJob(userId: string, jobId: string): Promise<void>;
}

/** Demo mode also has sample applications that can be cleared in one step. */
export interface DemoApplicationStore extends ApplicationStore {
  /** Removes the sample applications for this visitor and keeps the ones they added. */
  wipeDemo(userId: string): Promise<number>;
  hasDemo(userId: string): Promise<boolean>;
}
