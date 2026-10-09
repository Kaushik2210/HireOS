"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfileStore } from "@/db/profile";
import { getResumeStore } from "@/db/resume";
import { StoreError } from "@/db/profile/store";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { limitAction } from "@/lib/security/action-limits";
import { applyImportPlan, buildImportPlan } from "@/services/resume/import";

const idSchema = z.uuid();

export async function deleteResumeAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown resume." };

  const user = await requireUser();
  const limited = await limitAction(user.id);
  if (limited) return limited;
  try {
    const deleted = await (await getResumeStore(user)).delete(user.id, parsed.data);
    if (!deleted) return { ok: false, error: "That resume no longer exists." };
  } catch {
    return { ok: false, error: "Could not delete the resume. Please try again." };
  }
  revalidatePath("/resume");
  return { ok: true };
}

/**
 * Adds what the parser found to the profile as unconfirmed proposals. Nothing becomes
 * verified here: the user reviews each item on the profile page.
 */
export async function importResumeAction(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown resume." };

  const user = await requireUser();
  const limited = await limitAction(user.id, "heavy");
  if (limited) return limited;
  try {
    const resume = await (await getResumeStore(user)).get(user.id, parsed.data);
    if (!resume) return { ok: false, error: "That resume no longer exists." };

    const profileStore = await getProfileStore(user);
    const plan = buildImportPlan(resume.parsed, await profileStore.getSnapshot(user.id));
    const result = await applyImportPlan(profileStore, user.id, plan);

    revalidatePath("/profile");
    revalidatePath("/dashboard");

    if (result.total === 0 && !result.profileCreated) {
      return {
        ok: true,
        message:
          result.duplicates > 0
            ? "Everything from this resume is already in your profile."
            : "Nothing new could be added from this resume.",
      };
    }
    const parts = [
      `Added ${result.total} ${result.total === 1 ? "item" : "items"} for your review`,
    ];
    if (result.profileCreated) parts.push("created your profile from the contact details");
    if (result.duplicates > 0) parts.push(`skipped ${result.duplicates} already in your profile`);
    return { ok: true, message: `${parts.join(", ")}.` };
  } catch (error) {
    if (error instanceof StoreError && error.kind === "duplicate") {
      return { ok: false, error: "Some entries were added at the same time. Try again." };
    }
    return { ok: false, error: "Could not add these to your profile. Please try again." };
  }
}
