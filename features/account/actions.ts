"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { invalidResult } from "@/lib/action-result";
import { deleteAccountSchema } from "@/lib/account/schemas";
import { requireUser } from "@/lib/auth/session";
import { limitAction } from "@/lib/security/action-limits";
import { createSharedLimiter } from "@/lib/security/limits";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteAccount, type AdminClient } from "@/services/account/delete";
import { recordAudit } from "@/services/audit";

const deleteByUser = createSharedLimiter({ name: "deleteByUser", limit: 5, windowMs: 3_600_000 });

/** Ends every session this account has, on every device, including this one. */
export async function signOutEverywhereAction(): Promise<void> {
  const user = await requireUser();
  if (!user.isDemo) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      await supabase.auth.signOut({ scope: "global" });
      await recordAudit("auth.sign_out_all", user.id);
    }
  }
  redirect("/login");
}

/**
 * Permanently deletes the signed-in account and all of its data. Only a typed confirmation
 * starts it, and it can only ever act on the person making the request.
 */
export async function deleteAccountAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);

  const user = await requireUser();
  if (user.isDemo) {
    return {
      ok: false,
      error: "Demo data is temporary. Use Wipe demo data on the profile page instead.",
    };
  }
  const limited = await limitAction(user.id);
  if (limited) return limited;
  if (!(await deleteByUser.check(user.id)).ok) {
    return { ok: false, error: "Too many attempts. Please wait a while and try again." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { ok: false, error: "Account deletion is not available on this server." };
  }
  const outcome = await deleteAccount(user.id, admin as unknown as AdminClient);
  if (outcome !== "deleted") {
    return { ok: false, error: "Could not delete the account. Nothing was lost; try again." };
  }

  await recordAudit("account.deleted", null);
  const supabase = await createSupabaseServerClient();
  // The auth record is gone, so clearing the cookies is all that is left; ignore the answer.
  await supabase?.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/login?reason=deleted");
}
