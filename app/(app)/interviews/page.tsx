import { MessageSquare, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getApplicationStore } from "@/db/applications";
import type { Application } from "@/db/applications/store";
import { getInterviewStore } from "@/db/interviews";
import type { Interview } from "@/db/interviews/store";
import { getPracticeStore } from "@/db/practice";
import type { PracticeSession } from "@/db/practice/store";
import { requireUser } from "@/lib/auth/session";
import { INTERVIEW_KIND_LABELS, MOCK_FOCUS_LABELS } from "@/lib/interview/types";

export const metadata: Metadata = { title: "Interview Hub" };
export const dynamic = "force-dynamic";

const when = (i: Interview) =>
  i.scheduledOn
    ? `${i.scheduledOn}${i.scheduledTime ? ` at ${i.scheduledTime}` : ""}`
    : "No date yet";

export default async function InterviewHubPage() {
  const user = await requireUser();

  let interviews: Interview[] = [];
  let sessions: PracticeSession[] = [];
  let applications: Application[] = [];
  let loadFailed = false;
  try {
    [interviews, sessions, applications] = await Promise.all([
      getInterviewStore(user).then((s) => s.list(user.id)),
      getPracticeStore(user).then((s) => s.list(user.id)),
      getApplicationStore(user).then((s) => s.list(user.id)),
    ]);
  } catch {
    loadFailed = true;
  }

  const byId = new Map(applications.map((a) => [a.id, a]));
  const live = interviews.filter((i) => byId.has(i.applicationId));
  const upcoming = live.filter((i) => i.status === "scheduled");
  const past = live.filter((i) => i.status !== "scheduled");
  // Applications worth practising for: those with a job still available, in the pipeline's active stages.
  const practiceTargets = applications
    .filter((a) => a.jobId && !["rejected", "withdrawn"].includes(a.status))
    .slice(0, 6);
  const finished = sessions.filter((s) => s.status === "completed");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Interview Hub</h1>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 max-w-prose text-sm">
          Keep a record of each round, work through a prep checklist, and practise answering. The
          questions come from a built-in bank and your verified profile, and practice scores
          describe how an answer is built. Nothing here is written or judged by an AI model.
        </p>
      </div>

      {loadFailed ? (
        <div role="alert" className="border-danger/40 flex items-start gap-3 rounded-lg border p-4">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load your interviews. Your data is safe. Reload to try again.
          </p>
        </div>
      ) : (
        <>
          <section
            aria-labelledby="rounds-heading"
            className="border-border bg-surface rounded-lg border p-5"
          >
            <h2 id="rounds-heading" className="mb-3 text-sm font-semibold">
              Interview rounds
            </h2>
            {live.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No interviews recorded yet"
                description="Open an application and choose Add interview to record a round and get a prep checklist."
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/applications" prefetch={false}>
                      Go to applications
                    </Link>
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-4">
                {[
                  ["Upcoming", upcoming],
                  ["Past and cancelled", past],
                ].map(([title, list]) =>
                  (list as Interview[]).length === 0 ? null : (
                    <div key={title as string}>
                      <h3 className="text-subtle mb-1.5 font-mono text-[10px] tracking-wide uppercase">
                        {title as string}
                      </h3>
                      <ul className="divide-border divide-y" data-testid="interview-list">
                        {(list as Interview[]).map((i) => {
                          const app = byId.get(i.applicationId)!;
                          const done = i.checklist.filter((c) => c.done).length;
                          return (
                            <li
                              key={i.id}
                              className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm"
                            >
                              <Link
                                href={`/interviews/${i.id}`}
                                prefetch={false}
                                className="min-w-0 hover:underline"
                              >
                                <span className="break-words">
                                  {i.roundLabel} · {app.jobTitle}
                                </span>
                                <span className="text-muted block text-xs break-words">
                                  {app.companyName} · {INTERVIEW_KIND_LABELS[i.kind]} · {when(i)}
                                </span>
                              </Link>
                              <span className="text-muted text-xs">
                                {done} of {i.checklist.length} prepared
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>

          <section
            aria-labelledby="practice-heading"
            className="border-border bg-surface rounded-lg border p-5"
          >
            <h2 id="practice-heading" className="mb-1 text-sm font-semibold">
              Mock interview practice
            </h2>
            <p className="text-muted mb-3 text-xs">
              Pick a job to practise for. You answer in writing, one question at a time, and see
              feedback on six measures after each answer.
            </p>
            {practiceTargets.length > 0 ? (
              <ul className="flex flex-wrap gap-2" data-testid="practice-targets">
                {practiceTargets.map((a) => (
                  <li key={a.id}>
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/jobs/${a.jobId}/practice`} prefetch={false}>
                        {a.jobTitle}, {a.companyName}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted text-sm">
                Open any job and choose Practice interview.{" "}
                <Link href="/matches" prefetch={false} className="text-accent hover:underline">
                  Find a job
                </Link>
              </p>
            )}
          </section>

          <section
            aria-labelledby="history-heading"
            className="border-border bg-surface rounded-lg border p-5"
          >
            <h2 id="history-heading" className="mb-3 text-sm font-semibold">
              Practice history
            </h2>
            {sessions.length === 0 ? (
              <p className="text-muted text-sm">No practice sessions yet.</p>
            ) : (
              <ul className="divide-border divide-y" data-testid="practice-history">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                  >
                    <Link
                      href={`/practice/${s.id}`}
                      prefetch={false}
                      className="min-w-0 hover:underline"
                    >
                      <span className="break-words">{s.jobTitle}</span>
                      <span className="text-muted block text-xs">
                        {s.companyName} · {MOCK_FOCUS_LABELS[s.focus]} · {s.questionCount} questions
                      </span>
                    </Link>
                    {s.status === "completed" ? (
                      <Badge
                        variant={
                          s.overall! >= 75 ? "success" : s.overall! >= 50 ? "accent" : "warning"
                        }
                      >
                        {s.overall} / 100
                      </Badge>
                    ) : (
                      <Badge variant="neutral">In progress</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {finished.length >= 2 && (
              <p className="text-muted mt-3 text-xs" data-testid="trend">
                Your last {Math.min(5, finished.length)} finished sessions, newest first:{" "}
                {finished
                  .slice(0, 5)
                  .map((s) => s.overall)
                  .join(", ")}
                .
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
