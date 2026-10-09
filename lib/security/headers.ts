/**
 * Security headers.
 *
 * The Content Security Policy is built per request in proxy.ts because it carries a fresh
 * nonce; the rest are fixed and applied by next.config.ts.
 */

export interface CspOptions {
  nonce: string;
  /** React needs eval in development only (for readable server error stacks). */
  isDev: boolean;
}

export function buildCsp({ nonce, isDev }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced framework scripts load their chunks; host lists and
    // inline handlers are ignored by browsers that understand it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Style elements need the nonce. Inline style attributes (progress-bar widths) cannot
    // run script, so they are allowed on their own directive.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // The browser talks only to this app; every Supabase call is made on the server.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Headers that do not change per request. */
export function staticSecurityHeaders(isProd: boolean): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    ...(isProd
      ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
      : []),
  ];
}
