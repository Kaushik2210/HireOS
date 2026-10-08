import type { Application, ApplicationEvent } from "@/db/applications/store";
import { APPLIED_STATUSES, AWAITING_STATUSES, type Status } from "@/lib/applications/types";
import { rate, TOO_EARLY_DAYS, type Rate } from "@/lib/analytics/types";
import { daysSince } from "@/services/applications/followups";

const day = 86_400_000;

/** Every status an application has been in, from its history and where it is now. */
export function reachedStatuses(
  app: Application,
  events: readonly ApplicationEvent[],
): Set<Status> {
  const reached = new Set<Status>([app.status]);
  for (const e of events) {
    if (e.applicationId !== app.id) continue;
    if (e.toStatus) reached.add(e.toStatus);
    if (e.fromStatus) reached.add(e.fromStatus);
  }
  return reached;
}

const has = (set: Set<Status>, list: readonly Status[]) => list.some((s) => set.has(s));

/** An application counts as applied once the person said so, whatever happened afterwards. */
export function hasApplied(app: Application, events: readonly ApplicationEvent[]): boolean {
  return app.appliedOn !== null || has(reachedStatuses(app, events), APPLIED_STATUSES);
}

/** When the person applied, as a time: the date they gave, else when they moved it to applied. */
export function appliedAt(app: Application, events: readonly ApplicationEvent[]): number | null {
  if (app.appliedOn) return Date.parse(`${app.appliedOn}T00:00:00Z`);
  const first = events
    .filter((x) => x.applicationId === app.id && x.toStatus === "applied")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return first ? Date.parse(first.createdAt) : null;
}

/** Any reply that is not silence: an assessment, an interview or a rejection. */
const RESPONSE_STAGES: readonly Status[] = [
  "assessment",
  "interview",
  "final_round",
  "offer",
  "rejected",
];
const INTERVIEW_STAGES: readonly Status[] = ["interview", "final_round", "offer"];

export interface FunnelStage {
  id: "applied" | "assessment" | "interview" | "final_round" | "offer";
  label: string;
  reached: number;
}

export interface Funnel {
  applied: number;
  stages: FunnelStage[];
  heardBack: Rate;
  interviewed: Rate;
  offers: Rate;
  /** Of the interviews, how many reached an offer. */
  offerAfterInterview: Rate;
  rejected: number;
  noResponse: number;
  withdrawn: number;
  /** Median days from applying to the first reply. Null when nothing has been answered yet. */
  medianDaysToResponse: number | null;
  /** Applications still waiting on a first reply, and how many of them are young. */
  awaiting: { total: number; young: number };
  /** Applications applied to in each of the last weeks, oldest first. */
  weekly: { weekStart: string; applied: number }[];
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

const mondayOf = (d: Date) => {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return t - dow * day;
};

/** What the pipeline shows about replies. Pure: the same records always give the same numbers. */
export function computeFunnel(
  apps: readonly Application[],
  events: readonly ApplicationEvent[],
  now: Date,
  weeks = 8,
): Funnel {
  const applied = apps.filter((a) => hasApplied(a, events));
  const reached = new Map(applied.map((a) => [a.id, reachedStatuses(a, events)]));
  const count = (list: readonly Status[]) =>
    applied.filter((a) => has(reached.get(a.id)!, list)).length;

  const interviewed = count(INTERVIEW_STAGES);
  const offers = count(["offer"]);

  const responseDays: number[] = [];
  for (const a of applied) {
    const mine = events
      .filter((e) => e.applicationId === a.id && e.kind === "status_changed")
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    const first = mine.find((e) => e.toStatus && RESPONSE_STAGES.includes(e.toStatus));
    const from = appliedAt(a, events);
    if (!first || from === null) continue;
    responseDays.push(Math.max(0, Math.round((Date.parse(first.createdAt) - from) / day)));
  }

  // Waiting for a first reply: applied and nothing has happened since.
  const waiting = applied.filter(
    (a) => a.status === "applied" && AWAITING_STATUSES.includes(a.status),
  );
  const young = waiting.filter(
    (a) => daysSince(a.appliedOn ?? a.statusChangedAt, now) < TOO_EARLY_DAYS,
  ).length;

  const thisWeek = mondayOf(now);
  const weekly = Array.from({ length: weeks }, (_, i) => {
    const start = thisWeek - (weeks - 1 - i) * 7 * day;
    const end = start + 7 * day;
    const n = applied.filter((a) => {
      const when = appliedAt(a, events);
      return when !== null && when >= start && when < end;
    }).length;
    return { weekStart: new Date(start).toISOString().slice(0, 10), applied: n };
  });

  return {
    applied: applied.length,
    stages: [
      { id: "applied", label: "Applied", reached: applied.length },
      { id: "assessment", label: "Assessment", reached: count(["assessment"]) },
      { id: "interview", label: "Interview", reached: interviewed },
      { id: "final_round", label: "Final round", reached: count(["final_round", "offer"]) },
      { id: "offer", label: "Offer", reached: offers },
    ],
    heardBack: rate(count(RESPONSE_STAGES), applied.length),
    interviewed: rate(interviewed, applied.length),
    offers: rate(offers, applied.length),
    offerAfterInterview: rate(offers, interviewed),
    rejected: count(["rejected"]),
    noResponse: count(["no_response"]),
    withdrawn: count(["withdrawn"]),
    medianDaysToResponse: median(responseDays),
    awaiting: { total: waiting.length, young },
    weekly,
  };
}
