"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getApplicationStore, getDemoApplicationStore } from "@/db/applications";
import { ApplicationStoreError } from "@/db/applications/store";
import { getDocumentStore } from "@/db/documents";
import { getJobStore } from "@/db/jobs";
import type { ActionResult } from "@/lib/action-result";
import { invalidResult } from "@/lib/action-result";
import {
  addEventSchema,
  changeStatusSchema,
  createApplicationSchema,
  updateDetailsSchema,
} from "@/lib/applications/types";
import { requireUser } from "@/lib/auth/session";

const idSchema = z.uuid();

function refresh() {
  revalidatePath("/applications");
  revalidatePath("/dashboard");
}

/**
 * Adds a job to the person's pipeline. "Applied" here is their own statement that they
 * applied on the employer's page: HireOS submits nothing.
 */
export async function trackJobAction(input: unknown): Promise<ActionResult> {
  const parsed = createApplicationSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  const user = await requireUser();
  try {
    const job = await (await getJobStore(user)).get(user.id, parsed.data.jobId);
    if (!job) return { ok: false, error: "That job no longer exists." };
    await (
      await getApplicationStore(user)
    ).create(user.id, {
      jobId: job.id,
      jobTitle: job.title,
      companyName: job.company_name,
      status: parsed.data.status,
      appliedOn: parsed.data.status === "applied" ? parsed.data.applied_on : null,
    });
  } catch (error) {
    if (error instanceof ApplicationStoreError) {
      if (error.kind === "duplicate")
        return { ok: false, error: "This job is already in your pipeline." };
      if (error.kind === "limit") {
        return {
          ok: false,
          error: "You have reached the limit of tracked applications. Delete some first.",
        };
      }
      if (error.kind === "invalid")
        return { ok: false, error: "Check the date: it cannot be in the future." };
    }
    return { ok: false, error: "Could not add the job. Please try again." };
  }
  refresh();
  return { ok: true, message: "Added to your pipeline." };
}

/** Moves an application along an allowed transition. The move is logged with the optional note. */
export async function moveApplicationAction(input: unknown): Promise<ActionResult> {
  const parsed = changeStatusSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  const user = await requireUser();
  try {
    const outcome = await (
      await getApplicationStore(user)
    ).changeStatus(user.id, parsed.data.id, parsed.data.status, parsed.data.note, parsed.data.on);
    if (outcome === "not_found") return { ok: false, error: "That application no longer exists." };
    if (outcome === "not_allowed") {
      return { ok: false, error: "That move is not allowed from the current status." };
    }
  } catch {
    return { ok: false, error: "Could not move the application. Please try again." };
  }
  refresh();
  return { ok: true };
}

/** Saves notes, the follow-up date and the documents used. Documents must be the person's own, for this job. */
export async function updateDetailsAction(input: unknown): Promise<ActionResult> {
  const parsed = updateDetailsSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  const user = await requireUser();
  try {
    const store = await getApplicationStore(user);
    const current = await store.get(user.id, parsed.data.id);
    if (!current) return { ok: false, error: "That application no longer exists." };

    const documents = await getDocumentStore(user);
    for (const [id, kind] of [
      [parsed.data.resume_version_id, "resume"],
      [parsed.data.cover_letter_version_id, "cover_letter"],
    ] as const) {
      if (!id) continue;
      const doc = await documents.get(user.id, id);
      if (!doc || doc.kind !== kind || doc.jobId !== current.application.jobId) {
        return { ok: false, error: "Choose one of your own saved documents for this job." };
      }
    }

    const outcome = await store.updateDetails(user.id, parsed.data.id, {
      notes: parsed.data.notes,
      followUpOn: parsed.data.follow_up_on,
      resumeVersionId: parsed.data.resume_version_id,
      coverLetterVersionId: parsed.data.cover_letter_version_id,
    });
    if (outcome === "not_found") return { ok: false, error: "That application no longer exists." };
    if (outcome === "invalid_document") {
      return { ok: false, error: "Choose one of your own saved documents for this job." };
    }
  } catch {
    return { ok: false, error: "Could not save your changes. Please try again." };
  }
  refresh();
  return { ok: true, message: "Saved." };
}

/** Adds a note, or records that the person followed up. Nothing is sent. */
export async function addEventAction(input: unknown): Promise<ActionResult> {
  const parsed = addEventSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  const user = await requireUser();
  try {
    const outcome = await (
      await getApplicationStore(user)
    ).addEvent(user.id, parsed.data.id, parsed.data.kind, parsed.data.note);
    if (outcome === "not_found") return { ok: false, error: "That application no longer exists." };
    if (outcome === "invalid") return { ok: false, error: "Write something first." };
  } catch {
    return { ok: false, error: "Could not add that. Please try again." };
  }
  refresh();
  return { ok: true };
}

export async function deleteApplicationAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown application." };
  const user = await requireUser();
  try {
    const removed = await (await getApplicationStore(user)).remove(user.id, parsed.data);
    if (!removed) return { ok: false, error: "That application no longer exists." };
  } catch {
    return { ok: false, error: "Could not delete. Please try again." };
  }
  refresh();
  return { ok: true };
}

/** Clears the sample applications in demo mode. The ones the visitor added stay. */
export async function wipeDemoApplicationsAction(): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.isDemo) return { ok: false, error: "There is no sample data to clear." };
  try {
    await getDemoApplicationStore().wipeDemo(user.id);
  } catch {
    return { ok: false, error: "Could not clear the sample data. Please try again." };
  }
  refresh();
  return { ok: true, message: "Sample applications cleared." };
}
