import type { AuthUser } from "@/lib/auth/session";
import type { MfaStatus } from "@/lib/auth/mfa";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Whether the signed-in person has an authenticator app confirmed. "unavailable" means the
 * answer could not be read (no backend, or the backend refused), so the page says so instead
 * of guessing.
 */
export async function loadMfaStatus(user: AuthUser): Promise<MfaStatus | "unavailable"> {
  if (user.isDemo) return "unavailable";
  const client = await createSupabaseServerClient();
  if (!client) return "unavailable";
  const { data, error } = await client.auth.mfa.listFactors();
  if (error || !data) return "unavailable";
  return (data.totp ?? []).length > 0 ? "on" : "off";
}
