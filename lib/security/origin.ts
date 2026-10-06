/**
 * CSRF guard for cookie-authenticated endpoints that are not server actions (which Next.js
 * already protects). A browser always sends Origin on cross-site POSTs, and Sec-Fetch-Site
 * on modern ones; a request carrying neither is not from a browser and is refused.
 */
export function isSameOrigin(request: {
  url: string;
  headers: { get(name: string): string | null };
}): boolean {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;

  if (origin) {
    try {
      return new URL(origin).origin === expected;
    } catch {
      return false;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}
