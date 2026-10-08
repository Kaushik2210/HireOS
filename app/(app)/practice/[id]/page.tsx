import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPracticeStore } from "@/db/practice";
import type { PracticeAnswer, PracticeSession } from "@/db/practice/store";
import { AnswerForm, DeletePracticeButton } from "@/features/interview/components/forms";
import { FeedbackView, ScoreMeter } from "@/features/interview/components/feedback";
import { requireUser } from "@/lib/auth/session";
import { MOCK_FOCUS_LABELS } from "@/lib/interview/types";

export const metadata: Metadata = { title: "Practice session" };
export const dynamic = "force-dynamic";

const card = "border-border bg-surface rounded-lg border p-5";
const KIND_LABEL = {
  behavioral: "Behavioral",
  technical: "Technical",
  project: "About your project",
  experience: "About your experience",
  motivation: "Motivation",
} as const;

export default async function PracticeSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const user = await requireUser();

  let found: { session: PracticeSession; answers: PracticeAnswer[] } | null = null;
  try {
    found = await (await getPracticeStore(user)).get(user.id, id.data);
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load this session. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }
  if (!found) notFound();
  const { session, answers } = found;
  const done = session.status === "completed";
  const position = answers.length;
  const current = done ? null : session.questions[position];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href="/interviews"
          prefetch={false}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Interview Hub
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {done ? "Practice results" : "Practice session"}
          </h1>
          <Badge variant={done ? "success" : "accent"}>{done ? "finished" : "in progress"}</Badge>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 text-sm break-words">
          {MOCK_FOCUS_LABELS[session.focus]} practice for {session.jobTitle} at{" "}
          {session.companyName}.
        </p>
      </div>

      {current ? (
        <section aria-labelledby="question-heading" className={card} data-testid="current-question">
          <p
            className="text-subtle mb-2 font-mono text-[10px] tracking-wide uppercase"
            aria-live="polite"
          >
            Question {position + 1} of {session.questionCount} · {KIND_LABEL[current.kind]}
          </p>
          <h2 id="question-heading" className="mb-3 text-base font-semibold break-words">
            {current.text}
          </h2>
          {current.gap && (
            <p
              className="border-warning/40 text-warning mb-3 rounded border p-3 text-xs"
              role="note"
            >
              This job asks for {current.skill}, and your verified profile does not show it. An
              honest answer, such as what you do know and how you would learn the rest, usually
              serves you better than bluffing.
            </p>
          )}
          <AnswerForm
            key={position}
            sessionId={session.id}
            position={position}
            last={position === session.questionCount - 1}
          />
        </section>
      ) : (
        <section aria-labelledby="summary-heading" className={card} data-testid="summary">
          <h2 id="summary-heading" className="mb-3 text-sm font-semibold">
            Across all {session.questionCount} answers
          </h2>
          <p className="mb-4">
            <span className="text-3xl font-semibold tabular-nums" data-testid="session-score">
              {session.overall}
            </span>
            <span className="text-subtle text-sm"> / 100</span>
          </p>
          <ul className="flex flex-col gap-3" data-testid="dimension-averages">
            {session.dimensions?.map((d) => (
              <li key={d.id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{d.label}</span>
                  <span className="text-muted font-mono text-xs tabular-nums">
                    {d.score === null ? "Not scored" : `${d.score} / 100`}
                    {d.score !== null && d.answers < session.questionCount
                      ? ` (${d.answers} answers)`
                      : ""}
                  </span>
                </div>
                {d.score !== null && (
                  <ScoreMeter score={d.score} name={`${d.label}: ${d.score} out of 100`} />
                )}
              </li>
            ))}
          </ul>
          <p className="text-subtle mt-4 text-xs">
            These describe how your answers were built. They cannot judge technical correctness and
            do not predict any interviewer&apos;s reaction.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {session.jobId && (
              <Button asChild variant="primary" size="sm">
                <Link href={`/jobs/${session.jobId}/practice`} prefetch={false}>
                  Practise again
                </Link>
              </Button>
            )}
          </div>
        </section>
      )}

      {answers.length > 0 && (
        <section aria-labelledby="answers-heading" className="flex flex-col gap-3">
          <h2 id="answers-heading" className="text-sm font-semibold">
            Your answers
          </h2>
          <ol className="flex flex-col gap-3" data-testid="answers">
            {answers.map((a) => (
              <li key={a.id} className={card}>
                <details open={!done && a.position === answers.length - 1}>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium break-words">
                      {a.position + 1}. {a.question.text}
                    </span>
                    <Badge
                      variant={a.overall >= 75 ? "success" : a.overall >= 50 ? "accent" : "warning"}
                    >
                      {a.overall} / 100
                    </Badge>
                  </summary>
                  <p className="text-muted mt-3 text-sm break-words whitespace-pre-wrap">
                    {a.answer}
                  </p>
                  <div className="border-border mt-4 border-t pt-4">
                    <FeedbackView feedback={a.feedback} />
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div>
        <DeletePracticeButton id={session.id} redirectTo="/interviews" />
      </div>
    </div>
  );
}
