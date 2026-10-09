"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDocumentStore } from "@/db/documents";
import { DocumentStoreError } from "@/db/documents/store";
import { getJobStore } from "@/db/jobs";
import { getProfileStore } from "@/db/profile";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { limitAction } from "@/lib/security/action-limits";
import { MAX_DOCUMENT_TEXT } from "@/lib/tailoring/types";
import {
  prepareLetterVersion,
  prepareResumeVersion,
  type Prepared,
} from "@/services/tailoring/prepare";

const idSchema = z.uuid();
/** An item id, or `itemId#hN` for one bullet. */
const excludeKey = z.string().regex(/^[0-9a-f-]{36}(#h\d{1,2})?$/);

const resumeInput = z.object({
  jobId: idSchema,
  exclude: z.array(excludeKey).max(200).default([]),
  parentId: idSchema.nullish(),
});

const letterInput = z.object({
  jobId: idSchema,
  text: z.string().max(MAX_DOCUMENT_TEXT).optional(),
  parentId: idSchema.nullish(),
});

const PREPARE_ERRORS: Record<Exclude<Prepared, { ok: true }>["reason"], string> = {
  no_profile: "Create your profile first: it supplies your name and contact details.",
  nothing_verified:
    "There is nothing verified to build from yet. Add skills, projects or experience, or confirm your imported items.",
  too_long: "That document is too long to save.",
  empty: "The text is empty.",
};

async function loadContext(jobId: string) {
  const user = await requireUser();
  const [job, snapshot] = await Promise.all([
    (await getJobStore(user)).get(user.id, jobId),
    (await getProfileStore(user)).getSnapshot(user.id),
  ]);
  return { user, job, snapshot };
}

async function save(
  userId: string,
  user: Awaited<ReturnType<typeof requireUser>>,
  prepared: Prepared,
  jobId: string,
): Promise<ActionResult> {
  if (!prepared.ok) return { ok: false, error: PREPARE_ERRORS[prepared.reason] };
  const limited = await limitAction(userId, "heavy");
  if (limited) return limited;
  try {
    const created = await (await getDocumentStore(user)).create(userId, prepared.input);
    // No revalidate here: the redirect target is rendered fresh (see the jobs actions).
    redirect(`/jobs/${jobId}/documents/${created.id}`);
  } catch (error) {
    if (error instanceof DocumentStoreError && error.kind === "limit") {
      return {
        ok: false,
        error: "You have reached the limit of saved versions. Delete some first.",
      };
    }
    throw error;
  }
}

/**
 * Saves a tailored resume as a new draft version. The content is generated here from the
 * stored profile and job; the browser only says which items to leave out.
 */
export async function saveResumeVersionAction(input: unknown): Promise<ActionResult> {
  const parsed = resumeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { user, job, snapshot } = await loadContext(parsed.data.jobId);
  if (!job) return { ok: false, error: "That job no longer exists." };
  let prepared: Prepared;
  try {
    prepared = prepareResumeVersion(snapshot, job, {
      exclude: new Set(parsed.data.exclude),
      parentId: parsed.data.parentId ?? null,
    });
  } catch {
    return { ok: false, error: "Could not build the resume. Please try again." };
  }
  return save(user.id, user, prepared, job.id);
}

/** Saves a cover letter, generated or with the user's own edits, as a new draft version. */
export async function saveLetterVersionAction(input: unknown): Promise<ActionResult> {
  const parsed = letterInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { user, job, snapshot } = await loadContext(parsed.data.jobId);
  if (!job) return { ok: false, error: "That job no longer exists." };
  let prepared: Prepared;
  try {
    prepared = prepareLetterVersion(snapshot, job, {
      text: parsed.data.text,
      parentId: parsed.data.parentId ?? null,
    });
  } catch {
    return { ok: false, error: "Could not build the letter. Please try again." };
  }
  return save(user.id, user, prepared, job.id);
}

/** The user's review decision. Only a version whose integrity check passed can be approved. */
export async function approveVersionAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown document." };
  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  try {
    const outcome = await (await getDocumentStore(user)).approve(user.id, parsed.data);
    if (outcome === "not_found") return { ok: false, error: "That document no longer exists." };
    if (outcome === "blocked") {
      return {
        ok: false,
        error:
          "This version has lines that could not be traced to your verified profile. Fix them in a new version first.",
      };
    }
  } catch {
    return { ok: false, error: "Could not approve. Please try again." };
  }
  revalidatePath("/documents");
  return { ok: true, message: "Approved." };
}

export async function deleteVersionAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown document." };
  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  try {
    const removed = await (await getDocumentStore(user)).remove(user.id, parsed.data);
    if (!removed) return { ok: false, error: "That document no longer exists." };
  } catch {
    return { ok: false, error: "Could not delete. Please try again." };
  }
  revalidatePath("/documents");
  return { ok: true };
}
