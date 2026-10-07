import { KanbanSquare, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getApplicationStore } from "@/db/applications";
import type { Application, ApplicationEvent } from "@/db/applications/store";
import { Board } from "@/features/applications/components/board";
import { WipeSamplesButton } from "@/features/applications/components/controls";
import { requireUser } from "@/lib/auth/session";
import { dueFollowUps, summarize } from "@/services/applications/followups";

export const metadata: Metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const user = await requireUser();

  let applications: Application[] = [];
  let activity: ApplicationEvent[] = [];
  let loadFailed = false;
  try {
    const store = await getApplicationStore(user);
    [applications, activity] = await Promise.all([store.list(user.id), store.activity(user.id)]);
  } catch {
    loadFailed = true;
  }

  const now = new Date();
  const due = dueFollowUps(applications, activity, now);
  const followUps = new Map(due.map((d) => [d.applicationId, d]));
  const summary = summarize(applications);
  const hasSamples = applications.some((a) => a.isDemo);

  return (
    <div className="mx-auto flex max-w-[90rem] flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Applications</h1>
          {user.isDemo && hasSamples && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 max-w-prose text-sm">
          Track where each application stands. A status is your own record: HireOS never submits an
          application for you, so &quot;Applied&quot; means you applied on the employer&apos;s own
          page.
        </p>
      </div>

      {user.isDemo && hasSamples && (
        <section
          aria-labelledby="samples-heading"
          className="border-accent/30 bg-accent-soft flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
        >
          <div>
            <h2 id="samples-heading" className="text-sm font-semibold">
              Sample applications
            </h2>
            <p className="text-muted mt-0.5 max-w-prose text-xs">
              These are fictional, for trying the pipeline. Clearing them keeps anything you added
              yourself.
            </p>
          </div>
          <WipeSamplesButton />
        </section>
      )}

      {loadFailed ? (
        <div role="alert" className="border-danger/40 flex items-start gap-3 rounded-lg border p-4">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load your applications. Your data is safe. Reload to try again.
          </p>
        </div>
      ) : applications.length === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title="No applications yet"
          description="Open a job and choose Add to pipeline to start tracking it."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/matches" prefetch={false}>
                Find a job to track
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <dl
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            aria-label="Pipeline summary"
            data-testid="summary"
          >
            {[
              ["Tracked", summary.total],
              ["In progress", summary.active],
              ["Offers", summary.counts.offer],
              ["Follow-ups due", due.length],
            ].map(([label, value]) => (
              <div key={label} className="border-border bg-surface rounded-lg border p-3">
                <dt className="text-subtle font-mono text-[10px] tracking-wide uppercase">
                  {label}
                </dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <Board applications={applications} followUps={followUps} now={now} />
        </>
      )}
    </div>
  );
}
