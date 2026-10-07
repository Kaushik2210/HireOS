import { Send, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getJobStore } from "@/db/jobs";
import { getOutreachStore } from "@/db/outreach";
import type { OutreachDraft } from "@/db/outreach/store";
import { Guardrail } from "@/features/outreach/components/guardrail";
import { requireUser } from "@/lib/auth/session";
import type { Job } from "@/lib/jobs/schemas";
import { OUTREACH_META } from "@/lib/outreach/types";

export const metadata: Metadata = { title: "Outreach" };
export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const user = await requireUser();

  let drafts: OutreachDraft[] = [];
  const jobs = new Map<string, Job>();
  let loadFailed = false;
  try {
    drafts = await (await getOutreachStore(user)).list(user.id);
    const jobStore = await getJobStore(user);
    const found = await Promise.all(
      [...new Set(drafts.map((d) => d.jobId))].map((id) => jobStore.get(user.id, id)),
    );
    for (const job of found) if (job) jobs.set(job.id, job);
  } catch {
    loadFailed = true;
  }

  const groups = new Map<string, OutreachDraft[]>();
  for (const d of drafts) {
    if (!jobs.has(d.jobId)) continue;
    groups.set(d.jobId, [...(groups.get(d.jobId) ?? []), d]);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Outreach</h1>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 max-w-prose text-sm">
          Draft messages for recruiters, hiring managers, referrals and alumni, plus LinkedIn
          connection notes. Start from a job to write one.
        </p>
      </div>

      <Guardrail />

      {loadFailed ? (
        <div role="alert" className="border-danger/40 flex items-start gap-3 rounded-lg border p-4">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load your drafts. Your data is safe. Reload to try again.
          </p>
        </div>
      ) : groups.size === 0 ? (
        <EmptyState
          icon={Send}
          title="No drafts yet"
          description="Open a job, then choose Prepare outreach to write your first message."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/matches" prefetch={false}>
                Find a job to write about
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4" data-testid="outreach-groups">
          {[...groups].map(([jobId, list]) => {
            const job = jobs.get(jobId)!;
            return (
              <li key={jobId} className="border-border bg-surface rounded-lg border p-4">
                <Link
                  href={`/jobs/${job.id}/outreach`}
                  prefetch={false}
                  className="text-sm font-semibold hover:underline"
                >
                  {job.title}
                </Link>
                <p className="text-muted text-xs">{job.company_name}</p>
                <ul className="divide-border mt-3 divide-y">
                  {list.map((d) => (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <Link
                        href={`/jobs/${job.id}/outreach/${d.id}`}
                        prefetch={false}
                        className="hover:underline"
                      >
                        {OUTREACH_META[d.type].label}
                        {d.recipientName ? ` to ${d.recipientName}` : ""}
                      </Link>
                      <span className="flex items-center gap-2">
                        {!d.verification.ok && <Badge variant="warning">Needs fixes</Badge>}
                        <Badge variant={d.status === "draft" ? "neutral" : "success"}>
                          {d.status}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
