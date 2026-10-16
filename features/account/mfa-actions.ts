"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { invalidResult } from "@/lib/action-result";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { confirmEnrollSchema, verifyCodeSchema, type EnrollmentDetails } from "@/lib/auth/mfa";
import { requireSecondStepUser, requireUser } from "@/lib/auth/session";
import { limitAction } from "@/lib/security/action-limits";
import { createSharedLimiter } from "@/lib/security/limits";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAudit } from "@/services/audit";

// A six-digit code has a million possibilities, so guessing is slowed hard per account.
const codeAttempts = createSharedLimiter({
  name: "mfaCodeByUser",
  limit: 8,
  windowMs: 15 * 60_000,
});

const TOO_MANY: ActionResult = {
  ok: false,
  error: "Too many attempts. Wait a few minutes and try again.",
};
const BAD_CODE: ActionResult = {
  ok: false,
  error: "That code did not work. Check the time on your device and try the newest code.",
};
const UNAVAILABLE = {
  ok: false,
  error: "Two-step sign-in is not available right now. Please try again in a moment.",
} as const;

export type EnrollmentResult =
  { ok: true; details: EnrollmentDetails } | { ok: false; error: string };

/** Starts setting up an authenticator app: returns the picture to scan and the key as text. */
export async function startEnrollmentAction(): Promise<EnrollmentResult> {
  const user = await requireUser();
  if (user.isDemo) {
    return { ok: false, error: "Two-step sign-in needs a real account, not the demo sandbox." };
  }
  const limited = await limitAction(user.id);
  if (limited && !limited.ok) return { ok: false, error: limited.error };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return UNAVAILABLE;

  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) return UNAVAILABLE;
  if ((factors.data.totp ?? []).length > 0) {
    return { ok: false, error: "Two-step sign-in is already on for this account." };
  }
  // A setup that was abandoned halfway would block a new one (names must be unique).
  for (const stale of factors.data.all.filter((f) => f.status === "unverified")) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }

  const enrolled = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
  });
  if (enrolled.error || !enrolled.data) return UNAVAILABLE;
  const { id, totp } = enrolled.data;
  return { ok: true, details: { factorId: id, qrImage: totp.qr_code, secret: totp.secret } };
}

/** Finishes setup: the first correct code proves the app was configured properly. */
export async function confirmEnrollmentAction(input: unknown): Promise<ActionResult> {
  const parsed = confirmEnrollSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);

  const user = await requireUser();
  if (user.isDemo) return UNAVAILABLE;
  if (!(await codeAttempts.check(user.id)).ok) return TOO_MANY;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return UNAVAILABLE;

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) return BAD_CODE;

  await recordAudit("account.mfa_enabled", user.id);
  revalidatePath("/settings");
  return { ok: true, message: "Two-step sign-in is on." };
}

/** Turning it off needs a fresh code, so a borrowed, unlocked session cannot remove it. */
export async function disableMfaAction(input: unknown): Promise<ActionResult> {
  const parsed = verifyCodeSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);

  const user = await requireUser();
  if (user.isDemo) return UNAVAILABLE;
  if (!(await codeAttempts.check(user.id)).ok) return TOO_MANY;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return UNAVAILABLE;

  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp?.[0];
  if (factors.error || !factor) return { ok: false, error: "Two-step sign-in is not on." };

  const verified = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: parsed.data.code,
  });
  if (verified.error) return BAD_CODE;

  const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
  if (removed.error) return UNAVAILABLE;

  await recordAudit("account.mfa_disabled", user.id);
  revalidatePath("/settings");
  return { ok: true, message: "Two-step sign-in is off." };
}

/** The second step of signing in: raises the session so the app opens. */
export async function verifyLoginCodeAction(input: unknown, next?: string): Promise<ActionResult> {
  const parsed = verifyCodeSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);

  const user = await requireSecondStepUser();
  if (!(await codeAttempts.check(user.id)).ok) return TOO_MANY;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return UNAVAILABLE;

  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp?.[0];
  if (factors.error || !factor) return UNAVAILABLE;

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: parsed.data.code,
  });
  if (error) {
    await recordAudit("auth.mfa_failed", user.id);
    return BAD_CODE;
  }

  await recordAudit("auth.sign_in", user.id, { second_step: true });
  redirect(safeRedirectPath(next));
}
