// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, staticSecurityHeaders } from "@/lib/security/headers";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `) || d === name)
    ?.slice(name.length)
    .trim();

describe("content security policy", () => {
  const csp = buildCsp({ nonce: "abc", isDev: false });

  it("allows scripts only from this app and nonced ones, never inline or eval", () => {
    const script = directive(csp, "script-src")!;
    expect(script).toContain("'self'");
    expect(script).toContain("'nonce-abc'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
  });

  it("blocks plugins, framing, foreign forms and base-tag tricks", () => {
    expect(directive(csp, "object-src")).toBe("'none'");
    expect(directive(csp, "frame-ancestors")).toBe("'none'");
    expect(directive(csp, "frame-src")).toBe("'none'");
    expect(directive(csp, "form-action")).toBe("'self'");
    expect(directive(csp, "base-uri")).toBe("'self'");
  });

  it("keeps the browser from talking to anyone but this app", () => {
    expect(directive(csp, "connect-src")).toBe("'self'");
    expect(directive(csp, "default-src")).toBe("'self'");
    // No wildcard or remote host in any directive.
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).not.toContain("*");
  });

  it("only relaxes style attributes, which cannot run script", () => {
    expect(directive(csp, "style-src")).toBe("'self' 'nonce-abc'");
    expect(directive(csp, "style-src-attr")).toBe("'unsafe-inline'");
  });

  it("needs eval only in development", () => {
    const dev = buildCsp({ nonce: "abc", isDev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("creates an unpredictable nonce for every request", () => {
    const nonces = new Set(Array.from({ length: 200 }, createNonce));
    expect(nonces.size).toBe(200);
    for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("static security headers", () => {
  const headers = (prod: boolean) =>
    Object.fromEntries(staticSecurityHeaders(prod).map((h) => [h.key, h.value]));

  it("sets the protective headers", () => {
    const h = headers(true);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Permissions-Policy"]).toContain("microphone=()");
  });

  it("sends HSTS in production only", () => {
    expect(headers(true)["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(headers(false)["Strict-Transport-Security"]).toBeUndefined();
  });
});
