import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
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
import {
  MOCK_FOCUS,
  answerFeedbackSchema,
  questionSchema,
  type AnswerFeedback,
} from "@/lib/interview/types";

const MAX_LIST = 200;

type Row = Record<string, unknown>;

function fail(error: { code?: string; message?: string } | null): never {
  if (error?.message?.includes("practice session limit")) throw new PracticeStoreError("limit");
  // The code is enough to diagnose; messages can echo row contents.
  console.error("practice store query failed", { code: error?.code ?? "unknown" });
  throw new PracticeStoreError("unknown");
}

const dimensionAverage = z.object({
  id: z.string(),
  label: z.string(),
  score: z.number().nullable(),
  answers: z.number(),
});

const sessionRow = z.object({
  id: z.string(),
  job_id: z.string().nullable(),
  job_title: z.string(),
  company_name: z.string(),
  focus: z.enum(MOCK_FOCUS),
  question_count: z.number().int(),
  questions: z.array(questionSchema),
  round: z.number().int(),
  status: z.enum(["in_progress", "completed"]),
  overall: z.number().nullable(),
  dimensions: z.array(dimensionAverage).nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

const answerRow = z.object({
  id: z.string(),
  position: z.number().int(),
  question: questionSchema,
  answer: z.string(),
  feedback: answerFeedbackSchema,
  overall: z.number(),
  created_at: z.string(),
});

/** Stored rows are re-validated; one that no longer fits is skipped rather than breaking a page. */
function toSession(row: unknown): PracticeSession | null {
  const parsed = sessionRow.safeParse(row);
  if (!parsed.success) {
    console.error("stored practice session failed validation", { id: (row as Row | null)?.id });
    return null;
  }
  const r = parsed.data;
  return {
    id: r.id,
    jobId: r.job_id,
    jobTitle: r.job_title,
    companyName: r.company_name,
    focus: r.focus,
    questionCount: r.question_count,
    questions: r.questions,
    round: r.round,
    status: r.status,
    overall: r.overall,
    dimensions: r.dimensions,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

function toAnswer(row: unknown): PracticeAnswer | null {
  const parsed = answerRow.safeParse(row);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    id: r.id,
    position: r.position,
    question: r.question,
    answer: r.answer,
    feedback: r.feedback,
    overall: r.overall,
    createdAt: r.created_at,
  };
}

/**
 * Practice sessions on Supabase. Built from the user-scoped client, so Row Level Security
 * limits every call to the caller's own rows. The database refuses answers out of order or to
 * a finished session, and refuses to finish a session whose overall score is not the average.
 */
export class SupabasePracticeStore implements PracticeStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(userId: string, filter: { jobId?: string } = {}) {
    let query = this.client.from("mock_sessions").select("*").eq("user_id", userId);
    if (filter.jobId) query = query.eq("job_id", filter.jobId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(MAX_LIST);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toSession).filter((s): s is PracticeSession => s !== null);
  }

  async get(userId: string, id: string) {
    const { data, error } = await this.client
      .from("mock_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail(error);
    const session = data ? toSession(data) : null;
    if (!session) return null;
    const { data: answers, error: answerError } = await this.client
      .from("mock_answers")
      .select("*")
      .eq("user_id", userId)
      .eq("session_id", id)
      .order("position", { ascending: true });
    if (answerError) fail(answerError);
    return {
      session,
      answers: ((answers ?? []) as Row[])
        .map(toAnswer)
        .filter((a): a is PracticeAnswer => a !== null),
    };
  }

  async create(userId: string, input: NewSession): Promise<PracticeSession> {
    const { data, error } = await this.client
      .from("mock_sessions")
      .insert({
        user_id: userId,
        job_id: input.jobId,
        job_title: input.jobTitle,
        company_name: input.companyName,
        focus: input.focus,
        question_count: input.questions.length,
        questions: input.questions,
        round: input.round,
      })
      .select("*")
      .single();
    if (error) fail(error);
    const created = toSession(data);
    if (!created) throw new PracticeStoreError("unknown");
    return created;
  }

  async submitAnswer(
    userId: string,
    sessionId: string,
    position: number,
    answer: string,
    feedback: AnswerFeedback,
  ): Promise<AnswerOutcome> {
    const current = await this.get(userId, sessionId);
    if (!current) return "not_found";
    if (current.session.status !== "in_progress") return "finished";
    if (position !== current.answers.length || position >= current.session.questionCount) {
      return "out_of_order";
    }
    const { error } = await this.client.from("mock_answers").insert({
      user_id: userId,
      session_id: sessionId,
      position,
      question: current.session.questions[position],
      answer,
      feedback,
      overall: feedback.overall,
    });
    if (!error) return "saved";
    // Two submissions at once: the database's ordering rule or the unique position wins.
    if (error.message?.includes("in order") || error.code === "23505") return "out_of_order";
    if (error.message?.includes("not open")) return "finished";
    fail(error);
  }

  async finish(
    userId: string,
    sessionId: string,
    dimensions: DimensionAverage[],
  ): Promise<FinishOutcome> {
    const current = await this.get(userId, sessionId);
    if (!current) return "not_found";
    if (current.session.status === "completed") return "already_finished";
    if (current.answers.length !== current.session.questionCount) return "incomplete";
    const overall = Math.round(
      current.answers.reduce((t, a) => t + a.overall, 0) / current.answers.length,
    );
    const { data, error } = await this.client
      .from("mock_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        overall,
        dimensions,
      })
      .eq("user_id", userId)
      .eq("id", sessionId)
      .eq("status", "in_progress")
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0 ? "finished" : "already_finished";
  }

  async remove(userId: string, id: string) {
    const { data, error } = await this.client
      .from("mock_sessions")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0;
  }

  async detachJob() {
    // The foreign key sets job_id to null when a job is deleted, and keeps the session.
  }
}
