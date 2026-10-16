import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, isValidDemoId } from "@/lib/auth/demo";
import { classifyPath, hasAuthCookie } from "@/lib/auth/route-access";
import { getServerEnv } from "@/lib/env";
import { buildCsp, createNonce } from "@/lib/security/headers";

/**
 * Refreshes the Supabase session on every request and redirects based on route access.
 * This is the first gate only: server components, actions and route handlers
 * re-verify the user with requireUser(), and RLS enforces access in the database.
 */
async function route(request: NextRequest, pass: () => NextResponse) {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key } = getServerEnv();

  // Demo mode: no auth backend, nothing to enforce. Give each visitor an isolated sandbox id.
  if (!url || !key) {
    if (isValidDemoId(request.cookies.get(DEMO_COOKIE)?.value)) return pass();
    const id = crypto.randomUUID();
    request.cookies.set(DEMO_COOKIE, id); // visible to this same request's render
    const demo = pass();
    demo.cookies.set(DEMO_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return demo;
  }

  let response = pass();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = pass();
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

/**
 * Every response carries a Content Security Policy with a fresh nonce. The nonce travels to
 * the renderer in a request header so Next.js can stamp it on its own scripts and styles.
 */
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV === "development" });
  const pass = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    // Lets a page that sends someone to the code screen say where to come back to.
    headers.set("x-current-path", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    headers.set("Content-Security-Policy", csp);
    return NextResponse.next({ request: { headers } });
  };
  const response = await route(request, pass);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and Next internals.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
