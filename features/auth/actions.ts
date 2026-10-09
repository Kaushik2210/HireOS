"use server";

import { redirect } from "next/navigation";
import {
  resetByEmail,
  resetByIp,
  signInByEmail,
  signInByIp,
  signUpByIp,
} from "@/features/auth/limiters";
import { getAppUrl, getClientIp } from "@/features/auth/request-context";
import { invalidResult, type ActionResult } from "@/lib/action-result";
import { safeRedirectPath } from "@/lib/auth/redirect";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAudit } from "@/services/audit";

const NOT_CONFIGURED: ActionResult = {
  ok: false,
  error: "Authentication is not configured. The app is running in demo mode.",
};

const TOO_MANY: ActionResult = {
  ok: false,
  error: "Too many attempts. Please wait a few minutes and try again.",
};

const UNAVAILABLE: ActionResult = {
  ok: false,
  error: "Sign-in is temporarily unavailable. Please try again in a moment.",
};

/** Network failures and 5xx responses from the auth backend, as opposed to bad credentials. */
function isBackendFailure(error: { name?: string; status?: number } | null): boolean {
  if (!error) return false;
  return error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500;
}

const WEAK_PASSWORD =
  "That password is too weak or has appeared in a known data breach. Try another.";

export async function signInAction(input: unknown, next?: string): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NOT_CONFIGURED;

  const ip = await getClientIp();
  if (!(await signInByIp.check(ip)).ok || !(await signInByEmail.check(parsed.data.email)).ok) {
    return TOO_MANY;
  }

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (isBackendFailure(error)) return UNAVAILABLE;
  if (error || !data.user) {
    await recordAudit("auth.sign_in_failed", null);
    if (error?.code === "email_not_confirmed") {
      return { ok: false, error: "Confirm your email address first, then sign in." };
    }
    // Same message for unknown email and wrong password: no account enumeration.
    return { ok: false, error: "Invalid email or password." };
  }

  await recordAudit("auth.sign_in", data.user.id);
  redirect(safeRedirectPath(next));
}

export async function signUpAction(input: unknown): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NOT_CONFIGURED;

  if (!(await signUpByIp.check(await getClientIp())).ok) return TOO_MANY;

  const appUrl = getAppUrl();
  if (!appUrl) return { ok: false, error: "Sign-up is temporarily unavailable." };

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${appUrl}/auth/callback?next=/dashboard` },
  });

  if (error) {
    if (error.code === "weak_password") return { ok: false, error: WEAK_PASSWORD };
    return { ok: false, error: "Could not create the account. Please try again." };
  }

  if (data.user) await recordAudit("auth.sign_up", data.user.id);

  // Email confirmation disabled: a session exists immediately.
  if (data.session) redirect("/dashboard");

  // Identical response whether or not the address was already registered.
  return { ok: true, message: "Check your email for a confirmation link to finish signing up." };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    await supabase.auth.signOut();
    if (data.user) await recordAudit("auth.sign_out", data.user.id);
  }
  redirect("/login");
}

export async function requestPasswordResetAction(input: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NOT_CONFIGURED;

  if (
    !(await resetByIp.check(await getClientIp())).ok ||
    !(await resetByEmail.check(parsed.data.email)).ok
  ) {
    return TOO_MANY;
  }

  const appUrl = getAppUrl();
  if (!appUrl) return { ok: false, error: "Password reset is temporarily unavailable." };

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
  });
  await recordAudit("auth.password_reset_requested", null);

  // Always the same answer: never reveal whether the address has an account.
  return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NOT_CONFIGURED;

  // The recovery link established a session in /auth/callback; no session means no change.
  const user = await requireUser();

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      ok: false,
      error:
        error.code === "weak_password"
          ? WEAK_PASSWORD
          : "Could not update the password. Request a new reset link and try again.",
    };
  }

  await recordAudit("auth.password_updated", user.id);
  redirect("/dashboard");
}
