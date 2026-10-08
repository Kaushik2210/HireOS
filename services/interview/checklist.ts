import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import { QUESTIONS_TO_ASK } from "@/lib/interview/bank";
import {
  MAX_CHECKLIST,
  type ChecklistItem,
  type InterviewFormat,
  type InterviewKind,
} from "@/lib/interview/types";
import { normalizeKey, normalizeSkill } from "@/lib/skills/catalog";
import { buildCandidate } from "@/services/matching/candidate";
import { verifiedSnapshot } from "@/services/profile/verified";

const list = (items: string[]) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * A starting checklist for one interview, built from the posting and the verified profile.
 * Every item is a to-do for the person, never a claim about them: gaps are phrased as "be
 * ready to say plainly", and nothing suggests they know what they do not.
 */
export function buildChecklist(
  snapshot: ProfileSnapshot,
  job: Job | null,
  kind: InterviewKind,
  format: InterviewFormat | null,
): ChecklistItem[] {
  const items: string[] = [];
  const v = verifiedSnapshot(snapshot);
  const have = buildCandidate(snapshot).skills;

  if (job) {
    const required = job.required_skills.map((s) => normalizeSkill(s).name);
    items.push(
      `Re-read the posting for ${job.title} at ${job.company_name}${required.length > 0 ? `, and note the skills it asks for: ${list(required.slice(0, 6))}` : ""}.`,
    );
    const owned = required.filter((n) => have.has(normalizeKey(n))).slice(0, 5);
    if (owned.length > 0) {
      items.push(`Refresh ${list(owned)}. Your profile lists them, so expect questions on them.`);
    }
    for (const gap of required.filter((n) => !have.has(normalizeKey(n))).slice(0, 3)) {
      items.push(
        `Be ready to say plainly that you have not used ${gap} yet, and how you would learn it.`,
      );
    }
  }

  const needle = new Set(
    (job?.required_skills ?? []).map((s) => normalizeKey(normalizeSkill(s).name)),
  );
  const projects = [...v.projects]
    .map((p) => ({
      p,
      hits: p.tech.filter((t) => needle.has(normalizeKey(normalizeSkill(t).name))).length,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2);
  for (const { p } of projects) {
    items.push(
      `Practise a two-minute walk-through of ${p.name}: the problem, the decisions you made, and the result.`,
    );
  }

  if (kind === "behavioral" || kind === "hr" || kind === "final" || kind === "phone_screen") {
    items.push(
      "Prepare two short stories, one about a challenge and one about a mistake, each with Situation, Task, Action and Result.",
    );
  }
  if (kind === "technical" || kind === "final") {
    items.push(
      "Practise explaining your approach out loud while you work through a small problem.",
    );
  }
  if (kind === "system_design") {
    items.push(
      "Sketch a simple design on paper: requirements first, then the main parts, the data, and what happens as it grows.",
    );
  }
  if (kind === "phone_screen" || kind === "hr") {
    items.push(
      'Prepare a one-minute answer to "Tell me about yourself" and one to "Why this company?".',
    );
  }

  items.push("Have the resume you applied with open in front of you, and re-read it.");
  items.push(
    `Choose two questions to ask them. For example: "${QUESTIONS_TO_ASK[0]}" or "${QUESTIONS_TO_ASK[2]}"`,
  );

  if (format === "video")
    items.push("Test your camera, microphone and the meeting link the day before.");
  if (format === "phone") items.push("Find a quiet place and keep your phone charged and nearby.");
  if (format === "onsite") items.push("Plan your route and travel time, and what to bring.");
  if (format === "take_home")
    items.push("Read the brief twice, note the deadline, and decide what you will not build.");

  return items.slice(0, MAX_CHECKLIST).map((text, i) => ({
    id: `g${i + 1}`,
    text: text.length > 200 ? `${text.slice(0, 197)}...` : text,
    done: false,
    source: "generated" as const,
  }));
}
