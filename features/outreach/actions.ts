"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getJobStore } from "@/db/jobs";
import { getOutreachStore } from "@/db/outreach";
import { OutreachStoreError } from "@/db/outreach/store";
import { getProfileStore } from "@/db/profile";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { limitAction } from "@/lib/security/action-limits";
import { MAX_BODY, MAX_SUBJECT, outreachInputSchema } from "@/lib/outreach/types";
import { prepareDraft, prepareEdit, type PrepareFailure } from "@/services/outreach/prepare";

const idSchema = z.uuid();

const createInput = z.object({ jobId: idSchema }).and(outreachInputSchema);

const editInput = z.object({
  id: idSchema,
  text: z.string().max(MAX_BODY),
  subject: z
    .string()
    .max(MAX_SUBJECT * 2)
    .optional(),
});

const MESSAGES: Record<PrepareFailure, string> = {
  no_profile: "Create your profile first: it supplies your name and introduction.",
  nothing_verified:
    "There is nothing verified to build from yet. Add skills, projects or experience, or confirm your imported items.",
  needs_context: "Tell us how you know this person first, in your own words.",
  needs_confirmation: "Tick the box to confirm it first: the draft only says what you confirm.",
  empty: "The message is empty.",
  too_long: "That message is too long.",
  bad_subject: "Enter a subject of up to 200 characters.",
};

/**
 * Writes a new draft. The words are generated here from the stored profile and job: the
 * browser only supplies who it is for and the few facts the person typed.
 */
export async function createDraftAction(input: unknown): Promise<ActionResult> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check the details and try again." };
  const { jobId, ...rest } = parsed.data;

  const user = await requireUser();
  const limited = await limitAction(user.id, "heavy");
  if (limited) return limited;
  let draftId: string;
  try {
    const [job, snapshot] = await Promise.all([
      getJobStore(user).then((s) => s.get(user.id, jobId)),
      getProfileStore(user).then((s) => s.getSnapshot(user.id)),
    ]);
    if (!job) return { ok: false, error: "That job no longer exists." };
    const prepared = prepareDraft(snapshot, job, rest);
    if (!prepared.ok) return { ok: false, error: MESSAGES[prepared.reason] };
    draftId = (await (await getOutreachStore(user)).create(user.id, prepared.draft)).id;
  } catch (error) {
    if (error instanceof OutreachStoreError && error.kind === "limit") {
      return { ok: false, error: "You have reached the limit of saved drafts. Delete some first." };
    }
    return { ok: false, error: "Could not write the draft. Please try again." };
  }
  // No revalidate: the redirect target is rendered fresh.
  redirect(`/jobs/${jobId}/outreach/${draftId}`);
}

/** Saves the person's own edits and re-checks them against the verified profile. */
export async function saveDraftEditAction(input: unknown): Promise<ActionResult> {
  const parsed = editInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  try {
    const store = await getOutreachStore(user);
    const draft = await store.get(user.id, parsed.data.id);
    if (!draft) return { ok: false, error: "That draft no longer exists." };
    if (draft.status !== "draft") {
      return { ok: false, error: "Approved drafts cannot be edited. Write a new draft instead." };
    }
    const [job, snapshot] = await Promise.all([
      getJobStore(user).then((s) => s.get(user.id, draft.jobId)),
      getProfileStore(user).then((s) => s.getSnapshot(user.id)),
    ]);
    if (!job) return { ok: false, error: "That job no longer exists." };
    const prepared = prepareEdit(snapshot, job, draft, {
      text: parsed.data.text,
      subject: parsed.data.subject,
    });
    if (!prepared.ok) return { ok: false, error: MESSAGES[prepared.reason] };
    const outcome = await store.edit(user.id, draft.id, prepared.edit);
    if (outcome === "locked") return { ok: false, error: "Approved drafts cannot be edited." };
    if (outcome === "not_found") return { ok: false, error: "That draft no longer exists." };
  } catch {
    return { ok: false, error: "Could not save your changes. Please try again." };
  }
  revalidatePath("/outreach");
  return { ok: true, message: "Saved." };
}

/** The review decision. Only a draft whose integrity check passed can be approved. */
export async function approveDraftAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown draft." };
  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  try {
    const outcome = await (await getOutreachStore(user)).approve(user.id, parsed.data);
    if (outcome === "not_found") return { ok: false, error: "That draft no longer exists." };
    if (outcome === "blocked") {
      return {
        ok: false,
        error:
          "This draft has lines that could not be traced to your verified profile. Fix them first.",
      };
    }
  } catch {
    return { ok: false, error: "Could not approve. Please try again." };
  }
  revalidatePath("/outreach");
  return { ok: true, message: "Approved." };
}

/** The person's own record that they sent it. HireOS sends nothing. */
export async function markSentAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown draft." };
  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  try {
    const outcome = await (await getOutreachStore(user)).markSent(user.id, parsed.data);
    if (outcome === "not_found") return { ok: false, error: "That draft no longer exists." };
    if (outcome === "not_approved") return { ok: false, error: "Approve the draft first." };
  } catch {
    return { ok: false, error: "Could not update. Please try again." };
  }
  revalidatePath("/outreach");
  return { ok: true, message: "Recorded." };
}

export async function deleteDraftAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown draft." };
  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  try {
    const removed = await (await getOutreachStore(user)).remove(user.id, parsed.data);
    if (!removed) return { ok: false, error: "That draft no longer exists." };
  } catch {
    return { ok: false, error: "Could not delete. Please try again." };
  }
  revalidatePath("/outreach");
  return { ok: true };
}
