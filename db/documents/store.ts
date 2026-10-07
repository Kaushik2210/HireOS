import type {
  Change,
  DocumentKind,
  MissingRequirement,
  VersionContent,
  VersionStatus,
  Verification,
} from "@/lib/tailoring/types";

export interface DocumentVersion {
  id: string;
  jobId: string;
  kind: DocumentKind;
  versionNumber: number;
  parentId: string | null;
  status: VersionStatus;
  content: VersionContent;
  changes: Change[];
  missing: MissingRequirement[];
  verification: Verification;
  /** The document as plain text, for display, comparison and export. */
  body: string;
  tailorVersion: number;
  profileHash: string;
  createdAt: string;
  approvedAt: string | null;
}

export interface NewVersion {
  jobId: string;
  kind: DocumentKind;
  parentId: string | null;
  content: VersionContent;
  changes: Change[];
  missing: MissingRequirement[];
  verification: Verification;
  body: string;
  profileHash: string;
}

export type DocumentStoreErrorKind = "limit" | "not_found" | "unknown";

export class DocumentStoreError extends Error {
  constructor(
    public readonly kind: DocumentStoreErrorKind,
    cause?: unknown,
  ) {
    super(`Document store error: ${kind}`, cause === undefined ? undefined : { cause });
    this.name = "DocumentStoreError";
  }
}

export type ApproveOutcome = "approved" | "not_found" | "blocked" | "already_approved";

/** Most versions kept per user. The database enforces the same number. */
export const MAX_VERSIONS_PER_USER = 200;

export interface DocumentStore {
  /** The user's versions, newest first. */
  list(
    userId: string,
    filter?: { jobId?: string; kind?: DocumentKind },
  ): Promise<DocumentVersion[]>;
  /** Null when the version does not exist or belongs to someone else. */
  get(userId: string, id: string): Promise<DocumentVersion | null>;
  /** Saves a new draft and numbers it after the user's latest version of that kind for the job. */
  create(userId: string, input: NewVersion): Promise<DocumentVersion>;
  /** Approving needs a passing integrity check; an approved version never changes again. */
  approve(userId: string, id: string): Promise<ApproveOutcome>;
  remove(userId: string, id: string): Promise<boolean>;
  /** Drops a job's versions. The database does this by cascade; the demo store does it here. */
  removeForJob(userId: string, jobId: string): Promise<void>;
}
