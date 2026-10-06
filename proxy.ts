import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, isValidDemoId } from "@/lib/auth/demo";
import { classifyPath, hasAuthCookie } from "@/lib/auth/route-access";
import { getServerEnv } from "@/lib/env";

/**
 * Refreshes the Supabase session on every request and redirects based on route access.
 * This is the first gate only: server components, actions and route handlers
 * re-verify the user with requireUser(), and RLS enforces access in the database.
 */
export async function proxy(request: NextRequest) {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key } = getServerEnv();

  // Demo mode: no auth backend, nothing to enforce. Give each visitor an isolated sandbox id.
  if (!url || !key) {
    if (isValidDemoId(request.cookies.get(DEMO_COOKIE)?.value)) return NextResponse.next();
    const id = crypto.randomUUID();
    request.cookies.set(DEMO_COOKIE, id); // visible to this same request's render
    const demo = NextResponse.next({ request });
    demo.cookies.set(DEMO_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return demo;
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Verifies the JWT signature locally (and refreshes it when expired).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const access = classifyPath(request.nextUrl.pathname);

  const redirectTo = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    // Carry over any refreshed session cookies.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (access === "protected" && !signedIn) {
    // API clients expect a status code, not a redirect to an HTML page.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Please sign in again.", code: "auth" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const login = new URL("/login", request.url);
    const { pathname, search } = request.nextUrl;
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    // A leftover auth cookie with no valid claims means the session expired.
    if (hasAuthCookie(request.cookies.getAll().map((c) => c.name))) {
      login.searchParams.set("reason", "expired");
    }
    return redirectTo(login);
  }

  if (access === "guest-only" && signedIn) {
    return redirectTo(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and Next internals.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
