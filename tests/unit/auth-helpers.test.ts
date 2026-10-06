import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { classifyPath, hasAuthCookie } from "@/lib/auth/route-access";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import { createRateLimiter } from "@/lib/rate-limit";

describe("safeRedirectPath", () => {
  it("keeps same-origin relative paths, including query strings", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/jobs?status=open&page=2")).toBe("/jobs?status=open&page=2");
  });

  it.each([
    "https://evil.example",
    "http://evil.example/path",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "/path\nwith-newline",
    "/ok\u0000null",
  ])("rejects %j", (input) => {
    expect(safeRedirectPath(input)).toBe("/dashboard");
  });

  it("falls back for empty, null and undefined", () => {
    expect(safeRedirectPath("")).toBe("/dashboard");
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
  });
});

describe("classifyPath (default deny)", () => {
  it("marks auth pages guest-only", () => {
    for (const p of ["/login", "/signup", "/forgot-password", "/login/"]) {
      expect(classifyPath(p)).toBe("guest-only");
    }
  });

  it("marks the auth callback public", () => {
    expect(classifyPath("/auth/callback")).toBe("public");
  });

  it("protects everything else, including unknown and recovery paths", () => {
    for (const p of [
      "/",
      "/dashboard",
      "/reset-password",
      "/api/anything",
      "/jobs/123",
      "/Login",
    ]) {
      expect(classifyPath(p)).toBe("protected");
    }
  });

  it("does not let a lookalike prefix become public", () => {
    expect(classifyPath("/authentic")).toBe("protected");
    expect(classifyPath("/auth")).toBe("protected");
  });
});

describe("hasAuthCookie", () => {
  it("detects Supabase auth cookies, including chunked ones", () => {
    expect(hasAuthCookie(["theme", "sb-abc-auth-token"])).toBe(true);
    expect(hasAuthCookie(["sb-abc-auth-token.0", "sb-abc-auth-token.1"])).toBe(true);
  });
  it("ignores unrelated cookies", () => {
    expect(hasAuthCookie(["theme", "session", "sb-abc-other"])).toBe(false);
  });
});

describe("auth schemas", () => {
  it("normalizes email on sign-in and does not impose strength rules", () => {
    const r = signInSchema.parse({ email: "  USER@Example.COM ", password: "x" });
    expect(r.email).toBe("user@example.com");
  });

  it("rejects an invalid email and an empty password on sign-in", () => {
    const r = signInSchema.safeParse({ email: "nope", password: "" });
    expect(r.success).toBe(false);
  });

  it("enforces password length, letter and number on sign-up", () => {
    const base = { email: "a@b.co", confirmPassword: "" };
    const attempt = (password: string) =>
      signUpSchema.safeParse({ ...base, password, confirmPassword: password }).success;
    expect(attempt("short1")).toBe(false);
    expect(attempt("alllettersnodigits")).toBe(false);
    expect(attempt("1234567890123")).toBe(false);
    expect(attempt("goodpassword1")).toBe(true);
    expect(attempt("a1".repeat(40))).toBe(false); // over 72 chars
  });

  it("requires matching confirmation and reports it on the right field", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.co",
      password: "goodpassword1",
      confirmPassword: "different1234",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.confirmPassword).toBeDefined();
  });

  it("validates forgot and reset payloads", () => {
    expect(forgotPasswordSchema.safeParse({ email: "x" }).success).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ password: "goodpassword1", confirmPassword: "goodpassword1" })
        .success,
    ).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit, then blocks until the window resets", () => {
    let now = 1_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(true);
    const blocked = limiter.check("k");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(60_000);

    now += 60_000;
    expect(limiter.check("k").ok).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("b").ok).toBe(true);
    expect(limiter.check("a").ok).toBe(false);
  });

  it("stays bounded under a flood of distinct keys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) limiter.check(`key-${i}`);
    // The oldest keys were evicted, so an early key is allowed again.
    expect(limiter.check("key-0").ok).toBe(true);
  });
});
