// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
let env: { NEXT_PUBLIC_SUPABASE_URL?: string; NEXT_PUBLIC_SUPABASE_ANON_KEY?: string } = {};

vi.mock("@/lib/env", () => ({ getServerEnv: () => env }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims } }),
}));

const { proxy } = await import("@/proxy");

const CONFIGURED = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

function request(path: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  env = CONFIGURED;
});

const signedIn = () =>
  getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
const signedOut = () => getClaims.mockResolvedValue({ data: null, error: null });

describe("proxy", () => {
  it("passes everything through in demo mode (no auth backend)", async () => {
    env = {};
    const res = await proxy(request("/dashboard"));
    expect(res.status).toBe(200);
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("redirects a signed-out visitor from a protected page to login, keeping the destination", async () => {
    signedOut();
    const res = await proxy(request("/jobs?status=open"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/jobs?status=open");
    expect(location.searchParams.get("reason")).toBeNull();
  });

  it("does not add a next param for the root path", async () => {
    signedOut();
    const res = await proxy(request("/"));
    expect(new URL(res.headers.get("location")!).searchParams.has("next")).toBe(false);
  });

  it("flags an expired session when a stale auth cookie is present", async () => {
    signedOut();
    const res = await proxy(request("/dashboard", { "sb-proj-auth-token": "stale" }));
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("reason")).toBe("expired");
  });

  it("lets signed-out visitors reach the login page and the auth callback", async () => {
    signedOut();
    expect((await proxy(request("/login"))).status).toBe(200);
    expect((await proxy(request("/auth/callback?code=abc"))).status).toBe(200);
  });

  it("sends a signed-in user away from the guest-only pages", async () => {
    signedIn();
    for (const p of ["/login", "/signup", "/forgot-password"]) {
      const res = await proxy(request(p));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    }
  });

  it("lets a signed-in user reach protected pages, including password reset", async () => {
    signedIn();
    expect((await proxy(request("/dashboard"))).status).toBe(200);
    expect((await proxy(request("/reset-password"))).status).toBe(200);
  });

  it("blocks reset-password for signed-out visitors", async () => {
    signedOut();
    const res = await proxy(request("/reset-password"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});
