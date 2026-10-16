// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_COOKIE } from "@/lib/auth/demo";

let supabaseConfigured = true;
let client: { auth: { getUser: ReturnType<typeof vi.fn>; mfa?: unknown } } | null = null;
let demoCookie: string | undefined;

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}

let currentPath: string | null = null;

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "x-current-path" ? currentPath : null),
  }),
  cookies: async () => ({
    get: (name: string) =>
      name === DEMO_COOKIE && demoCookie ? { name, value: demoCookie } : undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/env", () => ({ getCapabilities: () => ({ supabase: supabaseConfigured }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));

const { getCurrentUser, getSessionState, requireSecondStepUser, requireUser } =
  await import("@/lib/auth/session");

const VALID_DEMO_ID = "7b0f6c36-4a52-4f5e-9d4d-0d3f6d1f6a11";

beforeEach(() => {
  supabaseConfigured = true;
  demoCookie = undefined;
  client = { auth: { getUser: vi.fn() } };
});

describe("getCurrentUser", () => {
  it("returns a demo user, derived from the cookie, when no backend is configured", async () => {
    supabaseConfigured = false;
    demoCookie = VALID_DEMO_ID;
    const user = await getCurrentUser();
    expect(user).toMatchObject({ isDemo: true, email: null });
    expect(user!.id).toBeTruthy();
    // The same visitor always maps to the same sandbox, and a different one to another.
    expect((await getCurrentUser())!.id).toBe(user!.id);
    demoCookie = "7b0f6c36-4a52-4f5e-9d4d-0d3f6d1f6a12";
    expect((await getCurrentUser())!.id).not.toBe(user!.id);
  });

  it("never lets a forged cookie pick a real account's id", async () => {
    supabaseConfigured = false;
    demoCookie = "00000000-0000-4000-8000-0000000000aa";
    const forged = await getCurrentUser();
    expect(forged!.isDemo).toBe(true);
    expect(forged!.id).not.toBe(demoCookie);
  });

  it("asks the auth server and returns the verified user", async () => {
    client!.auth.getUser.mockResolvedValue({
      data: { user: { id: "u-1", email: "a@example.test" } },
      error: null,
    });
    expect(await getCurrentUser()).toEqual({ id: "u-1", email: "a@example.test", isDemo: false });
  });

  it("returns null when the token is rejected or there is no user", async () => {
    client!.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "bad" } });
    expect(await getCurrentUser()).toBeNull();
    client!.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await getCurrentUser()).toBeNull();
  });

  it("does not treat a signed-out visitor as a demo user when the backend is configured", async () => {
    demoCookie = VALID_DEMO_ID;
    client!.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("requireUser", () => {
  it("sends a signed-out visitor to sign in", async () => {
    client!.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireUser()).rejects.toMatchObject({ to: "/login" });
  });

  it("returns the user when signed in", async () => {
    client!.auth.getUser.mockResolvedValue({ data: { user: { id: "u-2", email: null } } });
    await expect(requireUser()).resolves.toMatchObject({ id: "u-2", isDemo: false });
  });
});

describe("two-step sign-in", () => {
  const totp = (status: "verified" | "unverified") => ({ factor_type: "totp", status });
  const withFactors = (factors: unknown[], currentLevel: "aal1" | "aal2") => {
    client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u-3", email: "m@example.test", factors } },
          error: null,
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel } }),
        },
      },
    } as never;
  };

  it("is not signed in until the code has been entered", async () => {
    withFactors([totp("verified")], "aal1");
    expect(await getCurrentUser()).toBeNull();
    expect((await getSessionState()).kind).toBe("second_step");
    currentPath = "/reset-password";
    await expect(requireUser()).rejects.toMatchObject({
      to: "/login/verify?next=%2Freset-password",
    });
    // A path that is not a safe in-app address is dropped, not echoed.
    currentPath = "//evil.test/x";
    await expect(requireUser()).rejects.toMatchObject({ to: "/login/verify?next=%2Fdashboard" });
    currentPath = null;
    await expect(requireUser()).rejects.toMatchObject({ to: "/login/verify?next=%2Fdashboard" });
  });

  it("is signed in once the session has been raised by a code", async () => {
    withFactors([totp("verified")], "aal2");
    expect(await getCurrentUser()).toMatchObject({ id: "u-3" });
  });

  it("ignores a setup that was started but never confirmed", async () => {
    withFactors([totp("unverified")], "aal1");
    expect(await getCurrentUser()).toMatchObject({ id: "u-3" });
  });

  it("needs no code when there is no second step at all", async () => {
    withFactors([], "aal1");
    const lookup = (
      client as unknown as {
        auth: { mfa: { getAuthenticatorAssuranceLevel: ReturnType<typeof vi.fn> } };
      }
    ).auth.mfa.getAuthenticatorAssuranceLevel;
    expect((await getSessionState()).kind).toBe("signed_in");
    // An account that never turned it on is never asked: the level is not even looked up.
    expect(lookup).not.toHaveBeenCalled();
  });

  it("lets only a person who owes a code onto the code page", async () => {
    withFactors([totp("verified")], "aal1");
    await expect(requireSecondStepUser()).resolves.toMatchObject({ id: "u-3" });

    withFactors([totp("verified")], "aal2");
    await expect(requireSecondStepUser()).rejects.toMatchObject({ to: "/dashboard" });

    client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    };
    await expect(requireSecondStepUser()).rejects.toMatchObject({ to: "/login" });
  });
});
