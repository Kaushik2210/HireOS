import type { Application, ApplicationEvent } from "@/db/applications/store";
import type { MatchLabel, MatchResult } from "@/lib/matching/types";
import { MATCH_LABELS, MATCH_LABEL_TEXT } from "@/lib/matching/types";
import { hasApplied, reachedStatuses } from "@/services/analytics/funnel";

export interface GroupStat {
  id: string;
  label: string;
  applied: number;
  heardBack: number;
  interviewed: number;
}

const HEARD = ["assessment", "interview", "final_round", "offer", "rejected"] as const;
const INTERVIEWED = ["interview", "final_round", "offer"] as const;

function tally(
  id: string,
  label: string,
  apps: readonly Application[],
  events: readonly ApplicationEvent[],
): GroupStat {
  let heard = 0;
  let interviewed = 0;
  for (const a of apps) {
    const reached = reachedStatuses(a, events);
    if (HEARD.some((s) => reached.has(s))) heard++;
    if (INTERVIEWED.some((s) => reached.has(s))) interviewed++;
  }
  return { id, label, applied: apps.length, heardBack: heard, interviewed };
}

/** Replies by how well the job fitted on paper, using today's Application Strength. */
export function breakdownByStrength(
  apps: readonly Application[],
  events: readonly ApplicationEvent[],
  matches: ReadonlyMap<string, MatchResult>,
): GroupStat[] {
  const applied = apps.filter((a) => hasApplied(a, events) && matches.has(a.id));
  return MATCH_LABELS.map((label: MatchLabel) =>
    tally(
      label,
      MATCH_LABEL_TEXT[label],
      applied.filter((a) => matches.get(a.id)!.label === label),
      events,
    ),
  ).filter((g) => g.applied > 0);
}

/** Replies for applications with and without a resume version linked. */
export function breakdownByResume(
  apps: readonly Application[],
  events: readonly ApplicationEvent[],
): GroupStat[] {
  const applied = apps.filter((a) => hasApplied(a, events));
  return [
    tally(
      "tailored",
      "Resume version linked",
      applied.filter((a) => a.resumeVersionId !== null),
      events,
    ),
    tally(
      "none",
      "No resume linked",
      applied.filter((a) => a.resumeVersionId === null),
      events,
    ),
  ].filter((g) => g.applied > 0);
}
