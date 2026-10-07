import type { Application, ApplicationEvent } from "@/db/applications/store";
import {
  AWAITING_STATUSES,
  CLOSED_STATUSES,
  DEFAULT_FOLLOW_UP_DAYS,
  STATUSES,
  type Status,
} from "@/lib/applications/types";

export interface FollowUp {
  applicationId: string;
  /** Why a follow-up is due: a date the person set, or a quiet stretch. */
  reason: "scheduled" | "quiet";
  /** Whole days since the last real activity. */
  quietDays: number;
  /** The date it became due, YYYY-MM-DD. */
  dueOn: string;
}

const day = 86_400_000;
const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Whole days from an ISO timestamp to now (never negative). */
export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((startOfDay(dateOf(now)) - startOfDay(iso)) / day));
}

/**
 * The follow-up engine. It only flags: HireOS never sends anything. An application is
 * "awaiting" while it is applied, in assessment or in interviews. It is due when the date the
 * person set has arrived and they have not followed up since, or, with no date set, when it
 * has been quiet for `days` days. Only moves and "I followed up" count as activity; a note
 * the person writes to themselves does not.
 */
export function followUpFor(
  app: Application,
  events: readonly ApplicationEvent[],
  now: Date,
  days: number = DEFAULT_FOLLOW_UP_DAYS,
): FollowUp | null {
  if (!AWAITING_STATUSES.includes(app.status)) return null;

  const activity = events
    .filter((e) => e.applicationId === app.id)
    .filter((e) => e.kind === "created" || e.kind === "status_changed" || e.kind === "followed_up")
    .map((e) => e.createdAt)
    .sort();
  const last = activity.at(-1) ?? app.statusChangedAt;
  const quietDays = daysSince(last, now);
  const today = dateOf(now);

  if (app.followUpOn) {
    if (app.followUpOn > today) return null;
    // Followed up on or after the date: handled until a new date is set.
    const followedUp = events.some(
      (e) => e.kind === "followed_up" && e.createdAt.slice(0, 10) >= app.followUpOn!,
    );
    if (followedUp) return null;
    return { applicationId: app.id, reason: "scheduled", quietDays, dueOn: app.followUpOn };
  }

  if (quietDays < days) return null;
  return {
    applicationId: app.id,
    reason: "quiet",
    quietDays,
    dueOn: dateOf(new Date(startOfDay(last) + days * day)),
  };
}

/** Follow-ups due across many applications, longest quiet first. */
export function dueFollowUps(
  apps: readonly Application[],
  events: readonly ApplicationEvent[],
  now: Date,
  days: number = DEFAULT_FOLLOW_UP_DAYS,
): FollowUp[] {
  return apps
    .map((a) =>
      followUpFor(
        a,
        events.filter((e) => e.applicationId === a.id),
        now,
        days,
      ),
    )
    .filter((f): f is FollowUp => f !== null)
    .sort((a, b) => b.quietDays - a.quietDays);
}

export interface PipelineSummary {
  counts: Record<Status, number>;
  total: number;
  /** In the pipeline and not closed or an offer. */
  active: number;
  closed: number;
}

export function summarize(apps: readonly Application[]): PipelineSummary {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const a of apps) counts[a.status]++;
  const closed = CLOSED_STATUSES.reduce((n, s) => n + counts[s], 0);
  return { counts, total: apps.length, active: apps.length - closed - counts.offer, closed };
}
