"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getApplicationStore } from "@/db/applications";
import { getInterviewStore } from "@/db/interviews";
import { InterviewStoreError } from "@/db/interviews/store";
import { getJobStore } from "@/db/jobs";
import { getPracticeStore } from "@/db/practice";
import { PracticeStoreError } from "@/db/practice/store";
import { getProfileStore } from "@/db/profile";
import type { ActionResult } from "@/lib/action-result";
import { invalidResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import {
  MAX_CHECKLIST,
  checklistAddSchema,
  checklistToggleSchema,
  createInterviewSchema,
  startSessionSchema,
  submitAnswerSchema,
  updateInterviewSchema,
  type ChecklistItem,
} from "@/lib/interview/types";
import { buildChecklist } from "@/services/interview/checklist";
import { buildQuestions } from "@/services/interview/questions";
import { averageDimensions, scoreAnswer } from "@/services/interview/score";

const idSchema = z.uuid();

function refresh() {
  revalidatePath("/interviews");
  revalidatePath("/dashboard");
}

/**
 * Records an interview round for one of the person's own applications and writes a starting
 * prep checklist from the posting and their verified profile.
 */
export async function addInterviewAction(input: unknown): Promise<ActionResult> {
  const parsed = createInterviewSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  const user = await requireUser();
  let id: string;
  try {
    const found = await (await getApplicationStore(user)).get(user.id, parsed.data.application_id);
    if (!found) return { ok: false, error: "That application no longer exists." };
    const [job, snapshot] = await Promise.all([
      found.application.jobId
        ? getJobStore(user).then((s) => s.get(user.id, found.application.jobId!))
        : Promise.resolve(null),
      getProfileStore(user).then((s) => s.getSnapshot(user.id)),
    ]);
    const created = await (
      await getInterviewStore(user)
    ).create(user.id, {
      applicationId: found.application.id,
      roundLabel: parsed.data.round_label!,
      kind: parsed.data.kind,
      format: parsed.data.format,
      scheduledOn: parsed.data.scheduled_on,
      scheduledTime: parsed.data.scheduled_time,
      interviewer: parsed.data.interviewer,
      notes: parsed.data.notes,
      checklist: buildChecklist(snapshot, job, parsed.data.kind, parsed.data.format),
    });
    id = created.id;
  } catch (error) {
    if (error instanceof InterviewStoreError) {
      if (error.kind === "limit") {
        return {
          ok: false,
          error: "You have reached the limit of saved interviews. Delete some first.",
        };
      }
      if (error.kind === "not_found")
        return { ok: false, error: "That application no longer exists." };
    }
    return { ok: false, error: "Could not save the interview. Please try again." };
  }
  refresh();
  redirect(`/interviews/${id}`);
}

export async function updateInterviewAction(input: unknown): Promise<ActionResult> {
  const parsed = updateInterviewSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  const user = await requireUser();
  try {
    const outcome = await (
      await getInterviewStore(user)
    ).update(user.id, parsed.data.id, {
      roundLabel: parsed.data.round_label!,
      kind: parsed.data.kind,
      format: parsed.data.format,
      scheduledOn: parsed.data.scheduled_on,
      scheduledTime: parsed.data.scheduled_time,
      interviewer: parsed.data.interviewer,
      notes: parsed.data.notes,
      status: parsed.data.status,
    });
    if (outcome === "not_found") return { ok: false, error: "That interview no longer exists." };
  } catch {
    return { ok: false, error: "Could not save your changes. Please try again." };
  }
  refresh();
  return { ok: true, message: "Saved." };
}

async function withInterview(
  id: string,
  change: (items: ChecklistItem[]) => ChecklistItem[] | string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const store = await getInterviewStore(user);
    const interview = await store.get(user.id, id);
    if (!interview) return { ok: false, error: "That interview no longer exists." };
    const next = change(interview.checklist);
    if (typeof next === "string") return { ok: false, error: next };
    if ((await store.setChecklist(user.id, id, next)) === "not_found") {
      return { ok: false, error: "That interview no longer exists." };
    }
  } catch {
    return { ok: false, error: "Could not update the checklist. Please try again." };
  }
  revalidatePath("/interviews");
  return { ok: true };
}

export async function toggleChecklistAction(input: unknown): Promise<ActionResult> {
  const parsed = checklistToggleSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  return withInterview(parsed.data.id, (items) =>
    items.some((i) => i.id === parsed.data.item_id)
      ? items.map((i) => (i.id === parsed.data.item_id ? { ...i, done: parsed.data.done } : i))
      : "That item no longer exists.",
  );
}

export async function addChecklistItemAction(input: unknown): Promise<ActionResult> {
  const parsed = checklistAddSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  return withInterview(parsed.data.id, (items) =>
    items.length >= MAX_CHECKLIST
      ? `A checklist can have at most ${MAX_CHECKLIST} items.`
      : [
          ...items,
          {
            id: `c${Date.now().toString(36)}${items.length}`,
            text: parsed.data.text!,
            done: false,
            source: "custom",
          },
        ],
  );
}

const removeSchema = z.object({ id: z.uuid(), item_id: z.string().min(1).max(40) });

/** Only the person's own items can be removed; the suggested ones can be ticked or refreshed. */
export async function removeChecklistItemAction(input: unknown): Promise<ActionResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  return withInterview(parsed.data.id, (items) => {
    const target = items.find((i) => i.id === parsed.data.item_id);
    if (!target) return "That item no longer exists.";
    if (target.source !== "custom")
      return "Suggested items cannot be removed. Tick them off instead.";
    return items.filter((i) => i.id !== target.id);
  });
}

/** Rebuilds the suggested items from the current posting and profile; the person's own items and ticks stay. */
export async function refreshChecklistAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown interview." };
  const user = await requireUser();
  try {
    const store = await getInterviewStore(user);
    const interview = await store.get(user.id, parsed.data);
    if (!interview) return { ok: false, error: "That interview no longer exists." };
    const found = await (await getApplicationStore(user)).get(user.id, interview.applicationId);
    const [job, snapshot] = await Promise.all([
      found?.application.jobId
        ? getJobStore(user).then((s) => s.get(user.id, found.application.jobId!))
        : Promise.resolve(null),
      getProfileStore(user).then((s) => s.getSnapshot(user.id)),
    ]);
    const done = new Set(interview.checklist.filter((i) => i.done).map((i) => i.text));
    const custom = interview.checklist.filter((i) => i.source === "custom");
    const fresh = buildChecklist(snapshot, job, interview.kind, interview.format)
      .map((i) => ({ ...i, done: done.has(i.text) }))
      .slice(0, Math.max(0, MAX_CHECKLIST - custom.length));
    await store.setChecklist(user.id, interview.id, [...fresh, ...custom]);
  } catch {
    return { ok: false, error: "Could not refresh the checklist. Please try again." };
  }
  revalidatePath("/interviews");
  return { ok: true, message: "Suggestions refreshed." };
}

export async function deleteInterviewAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown interview." };
  const user = await requireUser();
  try {
    const removed = await (await getInterviewStore(user)).remove(user.id, parsed.data);
    if (!removed) return { ok: false, error: "That interview no longer exists." };
  } catch {
    return { ok: false, error: "Could not delete. Please try again." };
  }
  refresh();
  return { ok: true };
}

/* ---------- practice ---------- */

/**
 * Starts a practice session. The questions are chosen here, from the built-in bank and the
 * person's verified profile, and saved with the session so they cannot change underneath it.
 */
export async function startPracticeAction(input: unknown): Promise<ActionResult> {
  const parsed = startSessionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Choose a kind of practice and 3 to 10 questions." };
  const user = await requireUser();
  let id: string;
  try {
    const [job, snapshot, practice] = await Promise.all([
      getJobStore(user).then((s) => s.get(user.id, parsed.data.jobId)),
      getProfileStore(user).then((s) => s.getSnapshot(user.id)),
      getPracticeStore(user),
    ]);
    if (!job) return { ok: false, error: "That job no longer exists." };
    const round = (await practice.list(user.id, { jobId: job.id })).length;
    const questions = buildQuestions(snapshot, job, parsed.data.focus, parsed.data.count, round);
    id = (
      await practice.create(user.id, {
        jobId: job.id,
        jobTitle: job.title,
        companyName: job.company_name,
        focus: parsed.data.focus,
        questions,
        round,
      })
    ).id;
  } catch (error) {
    if (error instanceof PracticeStoreError && error.kind === "limit") {
      return {
        ok: false,
        error: "You have reached the limit of saved practice sessions. Delete some first.",
      };
    }
    return { ok: false, error: "Could not start the session. Please try again." };
  }
  refresh();
  redirect(`/practice/${id}`);
}

/**
 * Scores an answer from the stored question and the verified profile, saves it, and finishes
 * the session after the last one. The browser sends only the words; the scoring is all here.
 */
export async function submitAnswerAction(input: unknown): Promise<ActionResult> {
  const parsed = submitAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Write an answer first." };
  }
  const user = await requireUser();
  try {
    const practice = await getPracticeStore(user);
    const found = await practice.get(user.id, parsed.data.sessionId);
    if (!found) return { ok: false, error: "That session no longer exists." };
    const question = found.session.questions[parsed.data.position];
    if (!question) return { ok: false, error: "That question does not exist." };

    const snapshot = await (await getProfileStore(user)).getSnapshot(user.id);
    const feedback = scoreAnswer(question, parsed.data.answer, snapshot);
    const outcome = await practice.submitAnswer(
      user.id,
      found.session.id,
      parsed.data.position,
      parsed.data.answer,
      feedback,
    );
    if (outcome === "not_found") return { ok: false, error: "That session no longer exists." };
    if (outcome === "finished") return { ok: false, error: "This session is already finished." };
    if (outcome === "out_of_order") {
      return { ok: false, error: "That question has already been answered. Reload to continue." };
    }

    if (found.answers.length + 1 === found.session.questionCount) {
      const all = [...found.answers.map((a) => a.feedback), feedback];
      await practice.finish(user.id, found.session.id, averageDimensions(all));
    }
  } catch {
    return { ok: false, error: "Could not save your answer. Please try again." };
  }
  refresh();
  return { ok: true };
}

export async function deletePracticeAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown session." };
  const user = await requireUser();
  try {
    const removed = await (await getPracticeStore(user)).remove(user.id, parsed.data);
    if (!removed) return { ok: false, error: "That session no longer exists." };
  } catch {
    return { ok: false, error: "Could not delete. Please try again." };
  }
  refresh();
  return { ok: true };
}
