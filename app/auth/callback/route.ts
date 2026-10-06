import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Exchanges the one-time code from confirmation and recovery emails for a session (PKCE). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
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
