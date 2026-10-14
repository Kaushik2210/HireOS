import { BellRing, KanbanSquare, ListChecks } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import type { Application } from "@/db/applications/store";
import { StrengthChip } from "@/features/matching/components/strength";
import { STATUS_LABELS, STATUSES } from "@/lib/applications/types";
import type { FollowUp, PipelineSummary } from "@/services/applications/followups";
import type { RankedJob } from "@/services/matching/rank";

/** How many applications sit in each stage, with a link to the board. */
export function PipelineSummaryPanel({ summary }: { summary: PipelineSummary }) {
  if (summary.total === 0) {
    return (
      <EmptyState
        icon={KanbanSquare}
        title="Nothing tracked yet"
        description="Add a job to your pipeline to see it here."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/matches" prefetch={false}>
              Find a job to track
            </Link>
          </Button>
        }
      />
    );
  }
  const shown = STATUSES.filter((s) => summary.counts[s] > 0);
  return (
    <div>
      <p className="text-sm">
        <span className="text-xl font-semibold tabular-nums" data-testid="pipeline-total">
          {summary.total}
        </span>{" "}
        tracked, {summary.active} in progress.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5" data-testid="pipeline-counts">
        {shown.map((s) => (
          <li key={s} className="flex items-center justify-between text-sm">
            <span className="text-muted">{STATUS_LABELS[s]}</span>
            <span className="tabular-nums">{summary.counts[s]}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/applications"
        prefetch={false}
        className="text-accent mt-3 inline-block text-xs underline underline-offset-2 hover:no-underline"
      >
        Open the board
      </Link>
    </div>
  );
}

/** What to do today: follow-ups that are due, and good matches not yet in the pipeline. */
export function TodayPanel({
  followUps,
  applications,
  untracked,
}: {
  followUps: FollowUp[];
  applications: Application[];
  untracked: RankedJob[];
}) {
  if (followUps.length === 0 && untracked.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Nothing needs you today"
        description="Follow-ups that fall due and strong matches you have not tracked will show up here."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {followUps.length > 0 && (
        <div>
          <h4 className="text-subtle mb-1.5 font-mono text-[10px] tracking-wide uppercase">
            Follow-ups due
          </h4>
          <ul className="flex flex-col gap-2" data-testid="due-follow-ups">
            {followUps.slice(0, 3).map((f) => {
              const app = applications.find((a) => a.id === f.applicationId);
              if (!app) return null;
              return (
                <li key={f.applicationId} className="flex items-start gap-2 text-sm">
                  <BellRing className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <Link
                    href={`/applications/${app.id}`}
                    prefetch={false}
                    className="min-w-0 hover:underline"
                  >
                    <span className="break-words">{app.jobTitle}</span>
                    <span className="text-muted block text-xs">
                      {app.companyName}
                      {f.reason === "quiet" ? `, quiet for ${f.quietDays} days` : ", date reached"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {untracked.length > 0 && (
        <div>
          <h4 className="text-subtle mb-1.5 font-mono text-[10px] tracking-wide uppercase">
            Strong matches not tracked yet
          </h4>
          <ul className="flex flex-col gap-2" data-testid="untracked-matches">
            {untracked.slice(0, 3).map(({ job, match }) => (
              <li key={job.id} className="flex items-start justify-between gap-2 text-sm">
                <Link href={`/jobs/${job.id}`} prefetch={false} className="min-w-0 hover:underline">
                  <span className="break-words">{job.title}</span>
                  <span className="text-muted block text-xs">{job.company_name}</span>
                </Link>
                <StrengthChip strength={match.strength} label={match.label} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
