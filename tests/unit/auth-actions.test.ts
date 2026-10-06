// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = {
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    getUser: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
  },
};

let configured = true;
const createClient = vi.fn(async () => (configured ? supabase : null));
const recordAudit = vi.fn(async () => {});
const requireUser = vi.fn(async () => ({ id: "user-1", email: "a@b.co", isDemo: false }));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));
vi.mock("@/services/audit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...(a as [])),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/features/auth/request-context", () => ({
  getClientIp: async () => "203.0.113.9",
  getAppUrl: () => "https://app.example.test",
}));

const actions = await import("@/features/auth/actions");
const limiters = await import("@/features/auth/limiters");

const GOOD = { email: "user@example.com", password: "correct-horse-1" };

async function redirectTarget(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  configured = true;
  for (const l of Object.values(limiters)) l.reset();
});

describe("signInAction", () => {
  it("returns field errors for invalid input without contacting the auth backend", async () => {
    const r = await actions.signInAction({ email: "nope", password: "" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.fieldErrors?.email).toBeDefined();
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("reports demo mode when no backend is configured", async () => {
    configured = false;
    const r = await actions.signInAction(GOOD);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/demo mode/i);
  });

  it("gives one identical message for wrong password and unknown email (no enumeration)", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });
    const wrong = await actions.signInAction(GOOD);
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: "user_not_found", message: "User not found" },
    });
    const unknown = await actions.signInAction({ ...GOOD, email: "ghost@example.com" });
    expect(wrong).toEqual(unknown);
    expect(wrong).toEqual({ ok: false, error: "Invalid email or password." });
    expect(recordAudit).toHaveBeenCalledWith("auth.sign_in_failed", null);
  });

  it("reports a backend outage as unavailable, not as bad credentials", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" },
    });
    const r = await actions.signInAction(GOOD);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/temporarily unavailable/i);
    expect(recordAudit).not.toHaveBeenCalledWith("auth.sign_in_failed", null);
  });

  it("redirects to the requested in-app path after success and audits it", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    expect(await redirectTarget(actions.signInAction(GOOD, "/jobs?x=1"))).toBe("/jobs?x=1");
    expect(recordAudit).toHaveBeenCalledWith("auth.sign_in", "u1");
  });

  it.each(["https://evil.example", "//evil.example", "javascript:alert(1)"])(
    "ignores the hostile next value %s",
    async (next) => {
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: { id: "u1" } },
        error: null,
      });
      expect(await redirectTarget(actions.signInAction(GOOD, next))).toBe("/dashboard");
    },
  );

  it("rate-limits repeated attempts against one email", async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", message: "x" },
    });
    for (let i = 0; i < 6; i++) await actions.signInAction(GOOD);
    const blocked = await actions.signInAction(GOOD);
    expect(blocked).toMatchObject({ ok: false });
    if (!blocked.ok) expect(blocked.error).toMatch(/too many attempts/i);
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledTimes(6);
  });
});

describe("signUpAction", () => {
  const input = {
    email: "new@example.com",
    password: "goodpassword1",
    confirmPassword: "goodpassword1",
  };

  it("returns the same message whether or not the email already exists", async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: { id: "u1" }, session: null },
      error: null,
    });
    const fresh = await actions.signUpAction(input);
    supabase.auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const existing = await actions.signUpAction(input);
    expect(fresh).toEqual(existing);
    expect(fresh).toMatchObject({ ok: true });
  });

  it("builds the confirmation link from the configured app URL, not request data", async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: { id: "u1" }, session: null },
      error: null,
    });
    await actions.signUpAction(input);
    expect(supabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { emailRedirectTo: "https://app.example.test/auth/callback?next=/dashboard" },
      }),
    );
  });

  it("surfaces weak or breached passwords clearly", async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "weak_password", message: "x" },
    });
    const r = await actions.signUpAction(input);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/too weak/i);
  });

  it("redirects straight in when confirmation is disabled and a session exists", async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: { id: "u1" }, session: { access_token: "t" } },
      error: null,
    });
    expect(await redirectTarget(actions.signUpAction(input))).toBe("/dashboard");
  });
});

describe("requestPasswordResetAction", () => {
  it("always answers the same way and never reveals whether the account exists", async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    const a = await actions.requestPasswordResetAction({ email: "real@example.com" });
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "User not found" } });
    const b = await actions.requestPasswordResetAction({ email: "ghost@example.com" });
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true });
  });

  it("limits reset emails per address", async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    for (let i = 0; i < 3; i++)
      await actions.requestPasswordResetAction({ email: "x@example.com" });
    const r = await actions.requestPasswordResetAction({ email: "x@example.com" });
    expect(r).toMatchObject({ ok: false });
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledTimes(3);
  });
});

describe("updatePasswordAction", () => {
  const input = { password: "newpassword123", confirmPassword: "newpassword123" };

  it("requires an authenticated session", async () => {
    requireUser.mockImplementationOnce(async () => {
      throw new RedirectSignal("/login");
    });
    expect(await redirectTarget(actions.updatePasswordAction(input))).toBe("/login");
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("updates the password, audits it, and returns to the app", async () => {
    supabase.auth.updateUser.mockResolvedValue({ error: null });
    expect(await redirectTarget(actions.updatePasswordAction(input))).toBe("/dashboard");
    expect(recordAudit).toHaveBeenCalledWith("auth.password_updated", "user-1");
  });

  it("rejects mismatched confirmation before touching the backend", async () => {
    const r = await actions.updatePasswordAction({ ...input, confirmPassword: "different12345" });
    expect(r).toMatchObject({ ok: false });
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("signOutAction", () => {
  it("signs out, audits the user, and goes to the login page", async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    supabase.auth.signOut.mockResolvedValue({ error: null });
    expect(await redirectTarget(actions.signOutAction())).toBe("/login");
    expect(recordAudit).toHaveBeenCalledWith("auth.sign_out", "u1");
  });
});
