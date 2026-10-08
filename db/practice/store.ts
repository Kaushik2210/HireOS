import type { AnswerFeedback, MockFocus, Question } from "@/lib/interview/types";

export interface PracticeAnswer {
  id: string;
  position: number;
  question: Question;
  answer: string;
  feedback: AnswerFeedback;
  overall: number;
  createdAt: string;
}

export interface DimensionAverage {
  id: string;
  label: string;
  /** Null when no answer in the session gave this dimension a score. */
  score: number | null;
  answers: number;
}

export interface PracticeSession {
  id: string;
  /** Null once the job itself has been deleted; the title and company are kept. */
  jobId: string | null;
  jobTitle: string;
  companyName: string;
  focus: MockFocus;
  questionCount: number;
  questions: Question[];
  /** Which practice round this is for the job, so a repeat covers different questions. */
  round: number;
  status: "in_progress" | "completed";
  overall: number | null;
  dimensions: DimensionAverage[] | null;
  createdAt: string;
  completedAt: string | null;
}

export interface NewSession {
  jobId: string;
  jobTitle: string;
  companyName: string;
  focus: MockFocus;
  questions: Question[];
  round: number;
}

export type PracticeStoreErrorKind = "limit" | "not_found" | "unknown";

export class PracticeStoreError extends Error {
  constructor(
    public readonly kind: PracticeStoreErrorKind,
    cause?: unknown,
  ) {
    super(`Practice store error: ${kind}`, cause === undefined ? undefined : { cause });
    this.name = "PracticeStoreError";
  }
}

export type AnswerOutcome = "saved" | "not_found" | "out_of_order" | "finished";
export type FinishOutcome = "finished" | "not_found" | "incomplete" | "already_finished";

export interface PracticeStore {
  /** The user's sessions, newest first. */
  list(userId: string, filter?: { jobId?: string }): Promise<PracticeSession[]>;
  /** Null when it does not exist or belongs to someone else. Answers are oldest first. */
  get(
    userId: string,
    id: string,
  ): Promise<{ session: PracticeSession; answers: PracticeAnswer[] } | null>;
  create(userId: string, input: NewSession): Promise<PracticeSession>;
  /** Answers go in order, one per question, and never change once saved. */
  submitAnswer(
    userId: string,
    sessionId: string,
    position: number,
    answer: string,
    feedback: AnswerFeedback,
  ): Promise<AnswerOutcome>;
  /** Needs every question answered; the overall score is the average of the answers' scores. */
  finish(userId: string, sessionId: string, dimensions: DimensionAverage[]): Promise<FinishOutcome>;
  remove(userId: string, id: string): Promise<boolean>;
  /** A deleted job leaves its sessions in place. The database does this by foreign key; the demo store here. */
  detachJob(userId: string, jobId: string): Promise<void>;
}
