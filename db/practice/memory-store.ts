import { randomUUID } from "node:crypto";
import {
  PracticeStoreError,
  type AnswerOutcome,
  type DimensionAverage,
  type FinishOutcome,
  type NewSession,
  type PracticeAnswer,
  type PracticeSession,
  type PracticeStore,
} from "@/db/practice/store";
import { MAX_SESSIONS, type AnswerFeedback } from "@/lib/interview/types";

/** Bounds the demo sandbox so a long-running server cannot grow without limit. */
const MAX_SANDBOXES = 500;

interface Sandbox {
  sessions: PracticeSession[];
  answers: Map<string, PracticeAnswer[]>;
}

/** Demo-mode store: one isolated, bounded, in-memory history per visitor, with the database's rules. */
export class MemoryPracticeStore implements PracticeStore {
  private readonly sandboxes = new Map<string, Sandbox>();

  private box(userId: string): Sandbox {
    let box = this.sandboxes.get(userId);
    if (!box) {
      box = { sessions: [], answers: new Map() };
      this.sandboxes.set(userId, box);
      if (this.sandboxes.size > MAX_SANDBOXES) {
        const oldest = this.sandboxes.keys().next();
        if (!oldest.done) this.sandboxes.delete(oldest.value);
      }
    }
    return box;
  }

  async list(userId: string, filter: { jobId?: string } = {}) {
    return structuredClone(
      this.box(userId)
        .sessions.filter((s) => !filter.jobId || s.jobId === filter.jobId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async get(userId: string, id: string) {
    const box = this.box(userId);
    const session = box.sessions.find((s) => s.id === id);
    if (!session) return null;
    return structuredClone({
      session,
      answers: [...(box.answers.get(id) ?? [])].sort((a, b) => a.position - b.position),
    });
  }

  async create(userId: string, input: NewSession): Promise<PracticeSession> {
    const box = this.box(userId);
    if (box.sessions.length >= MAX_SESSIONS) throw new PracticeStoreError("limit");
    const session: PracticeSession = {
      id: randomUUID(),
      jobId: input.jobId,
      jobTitle: input.jobTitle,
      companyName: input.companyName,
      focus: input.focus,
      questionCount: input.questions.length,
      questions: structuredClone(input.questions),
      round: input.round,
      status: "in_progress",
      overall: null,
      dimensions: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    box.sessions.push(session);
    box.answers.set(session.id, []);
    return structuredClone(session);
  }

  async submitAnswer(
    userId: string,
    sessionId: string,
    position: number,
    answer: string,
    feedback: AnswerFeedback,
  ): Promise<AnswerOutcome> {
    const box = this.box(userId);
    const session = box.sessions.find((s) => s.id === sessionId);
    if (!session) return "not_found";
    if (session.status !== "in_progress") return "finished";
    const given = box.answers.get(sessionId) ?? [];
    if (position !== given.length || position >= session.questionCount) return "out_of_order";
    given.push({
      id: randomUUID(),
      position,
      question: structuredClone(session.questions[position]!),
      answer,
      feedback: structuredClone(feedback),
      overall: feedback.overall,
      createdAt: new Date().toISOString(),
    });
    box.answers.set(sessionId, given);
    return "saved";
  }

  async finish(
    userId: string,
    sessionId: string,
    dimensions: DimensionAverage[],
  ): Promise<FinishOutcome> {
    const box = this.box(userId);
    const session = box.sessions.find((s) => s.id === sessionId);
    if (!session) return "not_found";
    if (session.status === "completed") return "already_finished";
    const given = box.answers.get(sessionId) ?? [];
    if (given.length !== session.questionCount) return "incomplete";
    session.status = "completed";
    session.completedAt = new Date().toISOString();
    session.overall = Math.round(given.reduce((t, a) => t + a.overall, 0) / given.length);
    session.dimensions = structuredClone(dimensions);
    return "finished";
  }

  async remove(userId: string, id: string) {
    const box = this.box(userId);
    const index = box.sessions.findIndex((s) => s.id === id);
    if (index < 0) return false;
    box.sessions.splice(index, 1);
    box.answers.delete(id);
    return true;
  }

  async detachJob(userId: string, jobId: string) {
    for (const s of this.box(userId).sessions) if (s.jobId === jobId) s.jobId = null;
  }
}
