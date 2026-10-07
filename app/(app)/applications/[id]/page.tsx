import { ArrowLeft, BellRing, ExternalLink, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getApplicationStore } from "@/db/applications";
import type { ApplicationWithEvents } from "@/db/applications/store";
import { getDocumentStore } from "@/db/documents";
import type { DocumentVersion } from "@/db/documents/store";
import { getJobStore } from "@/db/jobs";
import {
  DeleteApplicationButton,
  DetailsForm,
  FollowedUpButton,
  NoteForm,
  StatusPanel,
} from "@/features/applications/components/controls";
import { requireUser } from "@/lib/auth/session";
import { describeEvent } from "@/lib/applications/format";
import { STATUS_LABELS, CLOSED_STATUSES } from "@/lib/applications/types";
import type { Job } from "@/lib/jobs/schemas";
import { followUpFor } from "@/services/applications/followups";

export const metadata: Metadata = { title: "Application" };
export const dynamic = "force-dynamic";

const card = "border-border bg-surface rounded-lg border p-5";
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const user = await requireUser();

  let found: ApplicationWithEvents | null = null;
  let job: Job | null = null;
  let documents: DocumentVersion[] = [];
  try {
    found = await (await getApplicationStore(user)).get(user.id, id.data);
    if (found?.application.jobId) {
      const jobId = found.application.jobId;
      [job, documents] = await Promise.all([
        getJobStore(user).then((s) => s.get(user.id, jobId)),
        getDocumentStore(user).then((s) => s.list(user.id, { jobId })),
      ]);
    }
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load this application. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }
  if (!found) notFound();

  const { application: app, events } = found;
  const followUp = followUpFor(app, events, new Date());
  const option = (d: DocumentVersion) => ({
    id: d.id,
    label: `Version ${d.versionNumber} (${d.status})`,
  });
  const resumes = documents.filter((d) => d.kind === "resume").map(option);
  const letters = documents.filter((d) => d.kind === "cover_letter").map(option);
  const closed = CLOSED_STATUSES.includes(app.status);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Link
          href="/applications"
          prefetch={false}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> All applications
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight break-words">{app.jobTitle}</h1>
          <Badge variant={closed ? "neutral" : app.status === "offer" ? "success" : "accent"}>
            {STATUS_LABELS[app.status]}
          </Badge>
          {app.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 text-sm break-words">
          {app.companyName}
          {app.appliedOn ? ` · You applied on ${app.appliedOn}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {job ? (
            <>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/jobs/${job.id}`} prefetch={false}>
                  View the job
                </Link>
              </Button>
              {job.apply_url && (
                <Button asChild variant="secondary" size="sm">
                  <a href={job.apply_url} target="_blank" rel="noopener noreferrer">
                    Open application <ExternalLink />
                  </a>
                </Button>
              )}
            </>
          ) : (
            <p className="text-muted text-xs">
              The job itself is no longer available, but your history is kept.
            </p>
          )}
        </div>
      </div>

      {followUp && (
        <section
          aria-labelledby="followup-heading"
          className="border-warning/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
          data-testid="follow-up-panel"
        >
          <div>
            <h2
              id="followup-heading"
              className="text-warning flex items-center gap-2 text-sm font-semibold"
            >
              <BellRing className="size-4" aria-hidden="true" /> A follow-up is due
            </h2>
            <p className="text-muted mt-1 max-w-prose text-xs">
              {followUp.reason === "scheduled"
                ? `You set ${followUp.dueOn} as the day to follow up.`
                : `Nothing has changed for ${followUp.quietDays} days.`}{" "}
              HireOS drafts the message; you send it yourself.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {job && (
              <Button asChild variant="primary" size="sm">
                <Link href={`/jobs/${job.id}/outreach?type=follow_up`} prefetch={false}>
                  Draft a follow-up
                </Link>
              </Button>
            )}
            <FollowedUpButton id={app.id} />
          </div>
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="timeline-heading" className={card}>
            <h2 id="timeline-heading" className="mb-4 text-sm font-semibold">
              Timeline
            </h2>
            <ol className="flex flex-col gap-4" data-testid="timeline">
              {[...events].reverse().map((e) => (
                <li key={e.id} className="border-border-strong border-l-2 pl-4">
                  <p className="text-sm break-words">{describeEvent(e)}</p>
                  {e.note && e.kind !== "follow_up_set" && (
                    <p className="text-muted mt-0.5 text-sm break-words whitespace-pre-line">
                      {e.note}
                    </p>
                  )}
                  <p className="text-subtle mt-0.5 text-xs">{fmt(e.createdAt)}</p>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="note-heading" className={card}>
            <h2 id="note-heading" className="sr-only">
              Add a note
            </h2>
            <NoteForm id={app.id} />
          </section>
        </div>

        <aside className="flex flex-col gap-6" aria-label="Manage">
          <section aria-labelledby="status-heading" className={card}>
            <h2 id="status-heading" className="mb-3 text-sm font-semibold">
              Status
            </h2>
            <StatusPanel id={app.id} status={app.status} />
          </section>
          <section aria-labelledby="details-heading" className={card}>
            <h2 id="details-heading" className="mb-3 text-sm font-semibold">
              Details
            </h2>
            <DetailsForm
              key={app.updatedAt}
              id={app.id}
              notes={app.notes}
              followUpOn={app.followUpOn}
              resumeId={app.resumeVersionId}
              letterId={app.coverLetterVersionId}
              resumes={resumes}
              letters={letters}
            />
          </section>
          <DeleteApplicationButton id={app.id} />
        </aside>
      </div>
    </div>
  );
}
