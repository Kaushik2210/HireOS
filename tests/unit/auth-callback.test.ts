// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let appUrl: string | undefined;
const exchange = vi.fn();

vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_URL: appUrl }) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

const { GET } = await import("@/app/auth/callback/route");

const call = (url: string) => GET(new NextRequest(url));

beforeEach(() => {
  appUrl = undefined;
  exchange.mockReset().mockResolvedValue({ error: null });
});

describe("GET /auth/callback", () => {
  it("sends the person on to the requested page after a good code", async () => {
    const res = await call("https://app.test/auth/callback?code=abc&next=/jobs");
    expect(res.headers.get("location")).toBe("https://app.test/jobs");
    expect(exchange).toHaveBeenCalledWith("abc");
  });

  it("redirects to the configured address, not to whatever Host the request claims", async () => {
    appUrl = "https://hireos.example/";
    const res = await call("https://evil.test/auth/callback?code=abc&next=/dashboard");
    expect(res.headers.get("location")).toBe("https://hireos.example/dashboard");
  });

  it("never follows an off-site next value", async () => {
    for (const next of ["//evil.test", "https://evil.test", "/\evil.test"]) {
      const res = await call(
        `https://app.test/auth/callback?code=abc&next=${encodeURIComponent(next)}`,
      );
      const location = new URL(res.headers.get("location")!);
      expect(location.origin).toBe("https://app.test");
    }
  });

  it("sends a missing or rejected code back to sign-in with a generic notice", async () => {
    let res = await call("https://app.test/auth/callback");
    expect(res.headers.get("location")).toBe("https://app.test/login?error=callback");
    exchange.mockResolvedValue({ error: { message: "bad code from provider" } });
    res = await call("https://app.test/auth/callback?code=nope");
    expect(res.headers.get("location")).toBe("https://app.test/login?error=callback");
    expect(res.headers.get("location")).not.toContain("provider");
  });
});
