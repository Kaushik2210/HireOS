import { ArrowLeft, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { getJobStore } from "@/db/jobs";
import { getPracticeStore } from "@/db/practice";
import type { PracticeSession } from "@/db/practice/store";
import { getProfileStore } from "@/db/profile";
import type { ProfileSnapshot } from "@/db/profile/store";
import { StartPracticeForm } from "@/features/interview/components/forms";
import { requireUser } from "@/lib/auth/session";
import { MOCK_FOCUS_LABELS } from "@/lib/interview/types";
import type { Job } from "@/lib/jobs/schemas";
import { buildQuestions } from "@/services/interview/questions";

export const metadata: Metadata = { title: "Practice interview" };
export const dynamic = "force-dynamic";

const card = "border-border bg-surface rounded-lg border p-5";

export default async function JobPracticePage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const user = await requireUser();

  let job: Job | null = null;
  let sessions: PracticeSession[] = [];
  let snapshot: ProfileSnapshot | null = null;
  try {
    [job, sessions, snapshot] = await Promise.all([
      getJobStore(user).then((s) => s.get(user.id, id.data)),
      getPracticeStore(user).then((s) => s.list(user.id, { jobId: id.data })),
      getProfileStore(user).then((s) => s.getSnapshot(user.id)),
    ]);
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load this page. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }
  if (!job || !snapshot) notFound();

  // A preview of what is likely to come up, so the person can prepare before practising.
  const preview = buildQuestions(snapshot, job, "final", 8, 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href={`/jobs/${job.id}`}
          prefetch={false}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to the job
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Practice interview</h1>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 text-sm break-words">
          For {job.title} at {job.company_name}.
        </p>
      </div>

      <p className="border-border text-muted flex items-start gap-2 rounded-lg border p-3 text-xs">
        <ShieldCheck className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Questions come from a built-in bank and your verified profile. Your answers stay private
          and are scored by fixed rules on how they are built (structure, detail, relevance,
          evidence from your own work, clarity and honesty about your profile). The score cannot
          judge whether a technical answer is correct. An AI coach is Planned.
        </span>
      </p>

      <section aria-labelledby="start-heading" className={card}>
        <h2 id="start-heading" className="mb-3 text-sm font-semibold">
          Start a session
        </h2>
        <StartPracticeForm jobId={job.id} />
      </section>

      <section aria-labelledby="likely-heading" className={card}>
        <h2 id="likely-heading" className="mb-1 text-sm font-semibold">
          Questions worth preparing
        </h2>
        <p className="text-muted mb-3 text-xs">
          A sample of what this posting and your profile suggest. A practice session draws from the
          same sources, so reading these first is fair preparation.
        </p>
        <ol className="flex flex-col gap-2.5" data-testid="likely-questions">
          {preview.map((q) => (
            <li key={q.id} className="text-sm">
              <span className="break-words">{q.text}</span>
              {q.gap && (
                <span className="text-warning block text-xs">
                  The posting asks for {q.skill} and your verified profile does not show it. Be
                  ready to say so plainly.
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="sessions-heading" className={card}>
        <h2 id="sessions-heading" className="mb-3 text-sm font-semibold">
          Your sessions for this job
        </h2>
        {sessions.length === 0 ? (
          <p className="text-muted text-sm">None yet.</p>
        ) : (
          <ul className="divide-border divide-y" data-testid="job-sessions">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/practice/${s.id}`} prefetch={false} className="hover:underline">
                  {MOCK_FOCUS_LABELS[s.focus]}, {s.questionCount} questions
                </Link>
                {s.status === "completed" ? (
                  <Badge variant="neutral">{s.overall} / 100</Badge>
                ) : (
                  <Badge variant="neutral">In progress</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
