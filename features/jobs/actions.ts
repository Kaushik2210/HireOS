"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDocumentStore } from "@/db/documents";
import { getApplicationStore } from "@/db/applications";
import { getJobStore } from "@/db/jobs";
import { getPracticeStore } from "@/db/practice";
import { getOutreachStore } from "@/db/outreach";
import { JobStoreError } from "@/db/jobs/store";
import { manualJobFormSchema } from "@/features/jobs/form";
import { invalidResult, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { limitAction } from "@/lib/security/action-limits";
import { MAX_PRIVATE_JOBS } from "@/lib/jobs/constants";
import { normalizeRawJob } from "@/services/jobs/normalize";
import { MANUAL_SOURCE } from "@/services/jobs/providers/registry";

const idSchema = z.uuid();

/**
 * Adds a job the user found themselves. The text is cleaned, analysed and validated exactly
 * like a provider's, and the job stays private to this user. Nothing is fetched.
 */
export async function addJobAction(input: unknown): Promise<ActionResult> {
  const parsed = manualJobFormSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);

  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  const store = await getJobStore(user);

  let createdId: string;
  try {
    if ((await store.countPrivate(user.id)) >= MAX_PRIVATE_JOBS) {
      return {
        ok: false,
        error: `You can keep up to ${MAX_PRIVATE_JOBS} jobs of your own. Delete one first.`,
      };
    }

    const normalized = normalizeRawJob(parsed.data, MANUAL_SOURCE);
    if (!normalized.ok) {
      return {
        ok: false,
        error: "That posting could not be read. Check the description and try again.",
      };
    }
    createdId = (await store.createPrivate(user.id, normalized.job)).id;
  } catch (error) {
    if (error instanceof JobStoreError) {
      if (error.kind === "duplicate") {
        return {
          ok: false,
          error: "You already added this job.",
          fieldErrors: { title: ["You already added this job"] },
        };
      }
      if (error.kind === "limit") {
        return {
          ok: false,
          error: `You can keep up to ${MAX_PRIVATE_JOBS} jobs of your own. Delete one first.`,
        };
      }
    }
    return { ok: false, error: "Could not save the job. Please try again." };
  }

  redirect(`/jobs/${createdId}`);
}

export async function deleteJobAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown job." };

  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  try {
    const deleted = await (await getJobStore(user)).deletePrivate(user.id, parsed.data);
    if (!deleted)
      return { ok: false, error: "That job no longer exists, or is not yours to delete." };
    // Saved resumes, letters and outreach drafts for this job go with it (the database cascades; demo mode does it here).
    await (await getDocumentStore(user)).removeForJob(user.id, parsed.data);
    await (await getOutreachStore(user)).removeForJob(user.id, parsed.data);
    await (await getApplicationStore(user)).detachJob(user.id, parsed.data);
    await (await getPracticeStore(user)).detachJob(user.id, parsed.data);
  } catch {
    return { ok: false, error: "Could not delete the job. Please try again." };
  }
  revalidatePath("/jobs");
  return { ok: true };
}

/**
 * Hides or shows the sample jobs for this user only. In demo mode this is the "wipe demo
 * data" control; for a real account it never deletes shared rows, it just filters them out.
 */
export async function setDemoHiddenAction(hidden: boolean): Promise<ActionResult> {
  if (typeof hidden !== "boolean") return { ok: false, error: "Invalid request." };
  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  try {
    await (await getJobStore(user)).setDemoHidden(user.id, hidden);
  } catch {
    return { ok: false, error: "Could not update that setting. Please try again." };
  }
  revalidatePath("/jobs");
  return { ok: true };
}
