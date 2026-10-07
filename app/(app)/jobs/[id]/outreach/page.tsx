import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { getJobStore } from "@/db/jobs";
import { getOutreachStore } from "@/db/outreach";
import type { OutreachDraft } from "@/db/outreach/store";
import { getProfileStore } from "@/db/profile";
import { BuildProfilePrompt } from "@/features/matching/components/job-intelligence";
import { Guardrail } from "@/features/outreach/components/guardrail";
import { OutreachForm } from "@/features/outreach/components/outreach-form";
import { requireUser } from "@/lib/auth/session";
import type { Job } from "@/lib/jobs/schemas";
import { OUTREACH_META } from "@/lib/outreach/types";
import { canScore } from "@/services/matching/score";
import { buildCandidate } from "@/services/matching/candidate";
import { pendingCount } from "@/services/profile/verified";

export const metadata: Metadata = { title: "Prepare outreach" };
export const dynamic = "force-dynamic";

export default async function JobOutreachPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const user = await requireUser();

  let job: Job | null = null;
  let drafts: OutreachDraft[] = [];
  let usable = false;
  let pending = 0;
  try {
    const [j, d, snapshot] = await Promise.all([
      getJobStore(user).then((s) => s.get(user.id, id.data)),
      getOutreachStore(user).then((s) => s.list(user.id, { jobId: id.data })),
      getProfileStore(user).then((s) => s.getSnapshot(user.id)),
    ]);
    job = j;
    drafts = d;
    usable = canScore(buildCandidate(snapshot)) && snapshot.profile !== null;
    pending = pendingCount(snapshot);
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
  if (!job) notFound();

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
          <h1 className="text-xl font-semibold tracking-tight">Prepare outreach</h1>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 text-sm break-words">
          For {job.title} at {job.company_name}.
        </p>
      </div>

      <Guardrail />

      {!usable ? (
        <BuildProfilePrompt pending={pending} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_16rem]">
          <section
            aria-labelledby="write-heading"
            className="border-border bg-surface rounded-lg border p-5"
          >
            <h2 id="write-heading" className="mb-4 text-sm font-semibold">
              Write a draft
            </h2>
            <OutreachForm jobId={job.id} />
          </section>
          <aside
            aria-labelledby="saved-heading"
            className="border-border bg-surface rounded-lg border p-4"
          >
            <h2 id="saved-heading" className="mb-2 text-sm font-semibold">
              Drafts for this job
            </h2>
            {drafts.length === 0 ? (
              <p className="text-muted text-xs">None yet.</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="job-drafts">
                {drafts.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link
                      href={`/jobs/${job.id}/outreach/${d.id}`}
                      prefetch={false}
                      className="min-w-0 hover:underline"
                    >
                      {OUTREACH_META[d.type].label}
                    </Link>
                    <Badge variant={d.status === "draft" ? "neutral" : "success"}>{d.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
