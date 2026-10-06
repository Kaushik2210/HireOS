export const DEFAULT_REDIRECT = "/dashboard";

/**
 * Returns a same-origin relative path that is safe to redirect to, else the default.
 * Blocks open redirects: absolute URLs, protocol-relative ("//host"), backslash tricks,
 * and control characters.
 */
export function safeRedirectPath(input: string | null | undefined): string {
  if (!input || typeof input !== "string") return DEFAULT_REDIRECT;
  if (!input.startsWith("/")) return DEFAULT_REDIRECT;
  if (input.startsWith("//") || input.includes("\\")) return DEFAULT_REDIRECT;
  if (/[\u0000-\u001f\u007f]/.test(input)) return DEFAULT_REDIRECT;
  try {
    const parsed = new URL(input, "http://placeholder.invalid");
    if (parsed.origin !== "http://placeholder.invalid") return DEFAULT_REDIRECT;
  } catch {
    return DEFAULT_REDIRECT;
  }
  return input;
}
