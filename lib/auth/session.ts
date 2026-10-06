import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_COOKIE, demoUserId } from "@/lib/auth/demo";
import { getCapabilities } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthUser {
  id: string;
  email: string | null;
  isDemo: boolean;
}

async function currentDemoUser(): Promise<AuthUser> {
  const cookieStore = await cookies();
  return { id: demoUserId(cookieStore.get(DEMO_COOKIE)?.value), email: null, isDemo: true };
}

/**
 * Resolves the current user by asking the Auth server to validate the token
 * (getUser), never by trusting the cookie contents. Returns the demo user when
 * Supabase is not configured, and null when nobody is signed in.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!getCapabilities().supabase) return currentDemoUser();

  const supabase = await createSupabaseServerClient();
  if (!supabase) return currentDemoUser();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null, isDemo: false };
}

/** Use in layouts, pages, actions and route handlers that need a signed-in user. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
