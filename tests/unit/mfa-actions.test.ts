// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmEnrollSchema, totpCodeSchema, verifyCodeSchema } from "@/lib/auth/mfa";

type TestUser = { id: string; email: string | null; isDemo: boolean };
let user: TestUser = { id: "u-1", email: "a@example.test", isDemo: false };
let secondStepUser: TestUser | null = user;
const recordAudit = vi.fn();
const revalidatePath = vi.fn();

const mfa = {
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
};

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => user,
  requireSecondStepUser: async () => {
    if (!secondStepUser) throw new RedirectSignal("/login");
    return secondStepUser;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { mfa } }),
}));
vi.mock("@/services/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

const actions = await import("@/features/account/mfa-actions");
const { resetActionLimits } = await import("@/lib/security/action-limits");

const FACTOR = "5b0f6c36-4a52-4f5e-9d4d-0d3f6d1f6a11";
const ok = { data: {}, error: null };

async function redirected(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
}

beforeEach(() => {
  user = { id: `u-${crypto.randomUUID()}`, email: "a@example.test", isDemo: false };
  secondStepUser = user;
  recordAudit.mockReset();
  revalidatePath.mockReset();
  for (const fn of Object.values(mfa)) fn.mockReset();
  mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
  mfa.challengeAndVerify.mockResolvedValue(ok);
  mfa.unenroll.mockResolvedValue(ok);
  resetActionLimits();
});

describe("code format", () => {
  it("accepts six digits, with or without grouping spaces", () => {
    expect(totpCodeSchema.parse("123456")).toBe("123456");
    expect(totpCodeSchema.parse(" 123 456 ")).toBe("123456");
  });

  it("rejects anything else", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5a", "１２３４５６", "123-456"]) {
      expect(totpCodeSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(verifyCodeSchema.safeParse({}).success).toBe(false);
    expect(confirmEnrollSchema.safeParse({ factorId: "not-a-uuid", code: "123456" }).success).toBe(
      false,
    );
  });
});

describe("startEnrollmentAction", () => {
  const enrolled = {
    data: {
      id: FACTOR,
      totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "ABCDEF234567" },
    },
    error: null,
  };

  it("returns the picture and the key, and clears an abandoned earlier attempt first", async () => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: "old", status: "unverified" }], totp: [] },
      error: null,
    });
    mfa.enroll.mockResolvedValue(enrolled);
    const result = await actions.startEnrollmentAction();
    expect(result).toEqual({
      ok: true,
      details: {
        factorId: FACTOR,
        qrImage: "data:image/svg+xml;utf8,<svg/>",
        secret: "ABCDEF234567",
      },
    });
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "old" });
    expect(mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: "totp" }));
  });

  it("refuses when it is already on, and in a demo sandbox", async () => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: FACTOR }], totp: [{ id: FACTOR }] },
      error: null,
    });
    expect((await actions.startEnrollmentAction()).ok).toBe(false);
    expect(mfa.enroll).not.toHaveBeenCalled();

    user = { id: "demo", email: null, isDemo: true };
    expect((await actions.startEnrollmentAction()).ok).toBe(false);
  });

  it("reports an unavailable backend plainly", async () => {
    mfa.enroll.mockResolvedValue({ data: null, error: { message: "mfa_totp_enroll_not_enabled" } });
    const result = await actions.startEnrollmentAction();
    expect(result).toEqual({ ok: false, error: expect.stringContaining("not available") });
    expect(JSON.stringify(result)).not.toContain("mfa_totp");
  });
});

describe("confirmEnrollmentAction", () => {
  it("turns it on with a correct code and records it", async () => {
    const result = await actions.confirmEnrollmentAction({ factorId: FACTOR, code: "123 456" });
    expect(result.ok).toBe(true);
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: FACTOR, code: "123456" });
    expect(recordAudit).toHaveBeenCalledWith("account.mfa_enabled", user.id);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("does not turn it on with a wrong code, and says nothing about why", async () => {
    mfa.challengeAndVerify.mockResolvedValue({
      data: null,
      error: { message: "Invalid TOTP code" },
    });
    const result = await actions.confirmEnrollmentAction({ factorId: FACTOR, code: "000000" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("did not work") });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejects malformed input before talking to the backend", async () => {
    expect((await actions.confirmEnrollmentAction({ factorId: FACTOR, code: "12" })).ok).toBe(
      false,
    );
    expect((await actions.confirmEnrollmentAction({ code: "123456" })).ok).toBe(false);
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("slows guessing: after eight tries in a window it stops asking the backend", async () => {
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad" } });
    for (let i = 0; i < 8; i++) {
      await actions.confirmEnrollmentAction({ factorId: FACTOR, code: "000000" });
    }
    const blocked = await actions.confirmEnrollmentAction({ factorId: FACTOR, code: "123456" });
    expect(blocked).toEqual({ ok: false, error: expect.stringContaining("Too many") });
    expect(mfa.challengeAndVerify).toHaveBeenCalledTimes(8);
  });
});

describe("disableMfaAction", () => {
  beforeEach(() => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: FACTOR }], totp: [{ id: FACTOR }] },
      error: null,
    });
  });

  it("needs a current code, then removes the factor", async () => {
    const result = await actions.disableMfaAction({ code: "654321" });
    expect(result.ok).toBe(true);
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: FACTOR, code: "654321" });
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: FACTOR });
    expect(recordAudit).toHaveBeenCalledWith("account.mfa_disabled", user.id);
  });

  it("leaves it on when the code is wrong", async () => {
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad" } });
    expect((await actions.disableMfaAction({ code: "111111" })).ok).toBe(false);
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it("says so when it was not on", async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
    expect(await actions.disableMfaAction({ code: "123456" })).toEqual({
      ok: false,
      error: "Two-step sign-in is not on.",
    });
  });
});

describe("verifyLoginCodeAction", () => {
  beforeEach(() => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: FACTOR }], totp: [{ id: FACTOR }] },
      error: null,
    });
  });

  it("opens the app, at the page they asked for, after a correct code", async () => {
    const to = await redirected(actions.verifyLoginCodeAction({ code: "123456" }, "/jobs?q=x"));
    expect(to).toBe("/jobs?q=x");
    expect(recordAudit).toHaveBeenCalledWith("auth.sign_in", user.id, { second_step: true });
  });

  it("never follows an off-site destination", async () => {
    for (const next of ["https://evil.test", "//evil.test", "/\\evil.test"]) {
      expect(await redirected(actions.verifyLoginCodeAction({ code: "123456" }, next))).toBe(
        "/dashboard",
      );
    }
  });

  it("stays on the code page after a wrong code, and records the failure", async () => {
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad" } });
    const result = await actions.verifyLoginCodeAction({ code: "000000" }, "/jobs");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("did not work") });
    expect(recordAudit).toHaveBeenCalledWith("auth.mfa_failed", user.id);
  });

  it("is only for someone who has passed the password step", async () => {
    secondStepUser = null;
    expect(await redirected(actions.verifyLoginCodeAction({ code: "123456" }))).toBe("/login");
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("locks out guessing: eight wrong codes, then no more attempts reach the backend", async () => {
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad" } });
    for (let i = 0; i < 8; i++) await actions.verifyLoginCodeAction({ code: "000000" });
    mfa.challengeAndVerify.mockResolvedValue(ok);
    const result = await actions.verifyLoginCodeAction({ code: "123456" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Too many") });
  });
});
