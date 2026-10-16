import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_COOKIE, demoUserId } from "@/lib/auth/demo";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getCapabilities } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthUser {
  id: string;
  email: string | null;
  isDemo: boolean;
}

/**
 * Where a visitor stands. "second_step" means the password was right and the account has
 * two-step sign-in on, but the code has not been entered yet: that visitor is not signed in
 * for anything except entering the code.
 */
export type SessionState =
  | { kind: "anonymous" }
  | { kind: "second_step"; user: AuthUser }
  | { kind: "signed_in"; user: AuthUser };

async function currentDemoUser(): Promise<AuthUser> {
  const cookieStore = await cookies();
  return { id: demoUserId(cookieStore.get(DEMO_COOKIE)?.value), email: null, isDemo: true };
}

/**
 * Resolves the visitor by asking the Auth server to validate the token (getUser), never by
 * trusting the cookie contents. Returns the demo user when Supabase is not configured.
 *
 * An account with a confirmed authenticator app is only signed in once the session has been
 * raised to the second assurance level by entering a code.
 */
export async function getSessionState(): Promise<SessionState> {
  if (!getCapabilities().supabase) return { kind: "signed_in", user: await currentDemoUser() };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { kind: "signed_in", user: await currentDemoUser() };

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "anonymous" };
  const user: AuthUser = { id: data.user.id, email: data.user.email ?? null, isDemo: false };

  const hasSecondStep = (data.user.factors ?? []).some(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
  if (!hasSecondStep) return { kind: "signed_in", user };

  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return level?.currentLevel === "aal2"
    ? { kind: "signed_in", user }
    : { kind: "second_step", user };
}

/**
 * The signed-in user, or null for anyone else, including someone who still owes a second-step
 * code. Returns the demo user when Supabase is not configured.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const state = await getSessionState();
  return state.kind === "signed_in" ? state.user : null;
}

/** Use in layouts, pages, actions and route handlers that need a signed-in user. */
export async function requireUser(): Promise<AuthUser> {
  const state = await getSessionState();
  if (state.kind === "signed_in") return state.user;
  if (state.kind === "second_step") {
    // Come back to the page they were on once the code is in (a reset link, say).
    const here = safeRedirectPath((await headers()).get("x-current-path"));
    redirect(`/login/verify?next=${encodeURIComponent(here)}`);
  }
  redirect("/login");
}

/** For the code-entry page only: the person who has passed the password step. */
export async function requireSecondStepUser(): Promise<AuthUser> {
  const state = await getSessionState();
  if (state.kind === "second_step") return state.user;
  redirect(state.kind === "signed_in" ? "/dashboard" : "/login");
}
