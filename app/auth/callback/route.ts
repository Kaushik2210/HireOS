import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getServerEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Exchanges the one-time code from confirmation and recovery emails for a session (PKCE). */
export async function GET(request: NextRequest) {
  const { searchParams, origin: requestOrigin } = new URL(request.url);
  // The configured address wins: behind a proxy the request's own origin can be an internal
  // name, and a forged Host header must not decide where a signed-in person is sent.
  const origin = getServerEnv().APP_URL?.replace(/\/$/, "") ?? requestOrigin;
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  const supabase = await createSupabaseServerClient();
  if (!supabase || !code) {
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
