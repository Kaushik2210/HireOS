export type RouteAccess =
  /** Only for signed-out visitors; signed-in users are sent to the app. */
  | "guest-only"
  /** Reachable by anyone (callback handlers). */
  | "public"
  /** Requires a valid session. */
  | "protected";

const GUEST_ONLY = new Set(["/login", "/signup", "/forgot-password"]);
const PUBLIC_PREFIXES = ["/auth/"];

/** Default-deny: any path not listed as public is protected, including unknown ones. */
export function classifyPath(pathname: string): RouteAccess {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (GUEST_ONLY.has(path)) return "guest-only";
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return "public";
  return "protected";
}

/** Supabase auth cookies look like `sb-<project>-auth-token` (possibly chunked `.0`, `.1`). */
export function hasAuthCookie(cookieNames: string[]): boolean {
  return cookieNames.some((name) => name.startsWith("sb-") && name.includes("-auth-token"));
}
