import { BellRing } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { QuickMove } from "@/features/applications/components/controls";
import type { Application } from "@/db/applications/store";
import { STATUSES, STATUS_LABELS, type Status } from "@/lib/applications/types";
import { daysSince, type FollowUp } from "@/services/applications/followups";

const COLUMN_TONE: Partial<Record<Status, "success" | "warning" | "neutral" | "accent">> = {
  offer: "success",
  rejected: "neutral",
  withdrawn: "neutral",
  no_response: "neutral",
  interview: "accent",
  final_round: "accent",
};

function Card({
  app,
  followUp,
  now,
}: {
  app: Application;
  followUp: FollowUp | undefined;
  now: Date;
}) {
  const days = daysSince(app.statusChangedAt, now);
  return (
    <li
      className="border-border bg-background flex flex-col gap-2 rounded-md border p-3"
      data-testid="application-card"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/applications/${app.id}`}
          prefetch={false}
          className="min-w-0 text-sm font-medium hover:underline"
        >
          <span className="break-words">{app.jobTitle}</span>
          <span className="text-muted block text-xs font-normal break-words">
            {app.companyName}
          </span>
        </Link>
        {app.isDemo && <Badge variant="accent">Demo</Badge>}
      </div>
      <p className="text-subtle text-xs">
        {days === 0
          ? "Moved today"
          : `In ${STATUS_LABELS[app.status]} for ${days} ${days === 1 ? "day" : "days"}`}
      </p>
      {followUp && (
        <p className="text-warning flex items-center gap-1 text-xs" data-testid="follow-up-flag">
          <BellRing className="size-3.5" aria-hidden="true" />
          Follow-up due{followUp.reason === "quiet" ? `: quiet for ${followUp.quietDays} days` : ""}
        </p>
      )}
      <QuickMove id={app.id} status={app.status} title={app.jobTitle} />
    </li>
  );
}

/** One column per status, side by side. On a narrow screen the board scrolls sideways within itself. */
export function Board({
  applications,
  followUps,
  now,
}: {
  applications: Application[];
  followUps: Map<string, FollowUp>;
  now: Date;
}) {
  return (
    // `relative` makes this the containing block for the screen-reader-only labels inside, so
    // they are clipped with the board instead of widening the whole page.
    <div
      className="relative -mx-4 overflow-x-auto px-4 pb-2"
      role="region"
      aria-label="Pipeline board"
      tabIndex={0}
    >
      <div className="flex min-w-max gap-3">
        {STATUSES.map((status) => {
          const items = applications.filter((a) => a.status === status);
          return (
            <section
              key={status}
              aria-labelledby={`col-${status}`}
              className="border-border bg-surface flex w-64 shrink-0 flex-col gap-3 rounded-lg border p-3"
              data-testid={`column-${status}`}
            >
              <h3
                id={`col-${status}`}
                className="flex items-center justify-between text-sm font-semibold"
              >
                {STATUS_LABELS[status]}
                <Badge variant={COLUMN_TONE[status] ?? "neutral"}>{items.length}</Badge>
              </h3>
              {items.length === 0 ? (
                <p className="text-subtle text-xs">Nothing here.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((a) => (
                    <Card key={a.id} app={a} followUp={followUps.get(a.id)} now={now} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
