import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getApplicationStore } from "@/db/applications";
import type { Application } from "@/db/applications/store";
import { getInterviewStore } from "@/db/interviews";
import type { Interview } from "@/db/interviews/store";
import {
  ChecklistPanel,
  DeleteInterviewButton,
  EditInterviewForm,
} from "@/features/interview/components/forms";
import { requireUser } from "@/lib/auth/session";
import { FORMAT_LABELS, INTERVIEW_KIND_LABELS } from "@/lib/interview/types";

export const metadata: Metadata = { title: "Interview" };
export const dynamic = "force-dynamic";

const card = "border-border bg-surface rounded-lg border p-5";

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const user = await requireUser();

  let interview: Interview | null = null;
  let application: Application | null = null;
  try {
    interview = await (await getInterviewStore(user)).get(user.id, id.data);
    if (interview) {
      application =
        (await (await getApplicationStore(user)).get(user.id, interview.applicationId))
          ?.application ?? null;
    }
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load this interview. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }
  if (!interview || !application) notFound();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Link
          href="/interviews"
          prefetch={false}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Interview Hub
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight break-words">
            {interview.roundLabel}
          </h1>
          <Badge variant={interview.status === "scheduled" ? "accent" : "neutral"}>
            {interview.status}
          </Badge>
        </div>
        <p className="text-muted mt-1 text-sm break-words">
          {INTERVIEW_KIND_LABELS[interview.kind]}
          {interview.format ? `, ${FORMAT_LABELS[interview.format].toLowerCase()}` : ""} for{" "}
          <Link
            href={`/applications/${application.id}`}
            prefetch={false}
            className="hover:underline"
          >
            {application.jobTitle} at {application.companyName}
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {application.jobId && (
            <Button asChild variant="primary" size="sm">
              <Link href={`/jobs/${application.jobId}/practice`} prefetch={false}>
                Practise for this job
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <section aria-labelledby="prep-heading" className={card}>
          <h2 id="prep-heading" className="mb-1 text-sm font-semibold">
            Prep checklist
          </h2>
          <p className="text-muted mb-4 text-xs">
            Suggested from the posting and your verified profile. These are to-dos for you, not
            claims about you.
          </p>
          <ChecklistPanel id={interview.id} items={interview.checklist} />
        </section>
        <aside className="flex flex-col gap-6" aria-label="Details">
          <section aria-labelledby="details-heading" className={card}>
            <h2 id="details-heading" className="mb-3 text-sm font-semibold">
              Details
            </h2>
            <EditInterviewForm
              key={interview.updatedAt}
              id={interview.id}
              status={interview.status}
              initial={{
                round_label: interview.roundLabel,
                kind: interview.kind,
                format: interview.format,
                scheduled_on: interview.scheduledOn ?? "",
                scheduled_time: interview.scheduledTime ?? "",
                interviewer: interview.interviewer ?? "",
                notes: interview.notes ?? "",
              }}
            />
          </section>
          <DeleteInterviewButton id={interview.id} />
        </aside>
      </div>
    </div>
  );
}
