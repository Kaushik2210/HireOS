// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestUser,
  liveReady,
  PASSWORD,
  removeTestUsers,
  URL,
  type TestUser,
} from "./helpers";
import { totpCode } from "./totp";

// Two-step sign-in against a real Supabase Auth service: the behaviour the app relies on,
// not a fake of it. Needs authenticator (TOTP) sign-in enabled, which the repository's local
// config does.

const suite = liveReady ? describe : describe.skip;

suite(`live two-step sign-in (${URL || "not configured"})`, () => {
  let user: TestUser;
  let secret = "";
  let factorId = "";

  const freshClient = () =>
    createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  /** Signs in with the password only, as the app's first step does. */
  async function passwordOnly() {
    const client = freshClient();
    const signedIn = await client.auth.signInWithPassword({
      email: user.email,
      password: PASSWORD,
    });
    if (signedIn.error) throw new Error("password sign-in failed");
    return { client, user: signedIn.data.user };
  }

  beforeAll(async () => {
    user = await createTestUser("mfa");
  }, 60_000);

  afterAll(async () => {
    await removeTestUsers(user);
  }, 60_000);

  it("starts with no second step, and a password alone is a full session", async () => {
    const { client } = await passwordOnly();
    const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(data?.currentLevel).toBe("aal1");
    expect(data?.nextLevel).toBe("aal1");
  });

  it("enrols an authenticator and gives the app a picture and a key to show", async () => {
    const enrolled = await user.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    expect(enrolled.error).toBeNull();
    factorId = enrolled.data!.id;
    secret = enrolled.data!.totp.secret;
    expect(enrolled.data!.totp.qr_code).toMatch(/^data:image\/svg\+xml/);
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  });

  it("does not count the setup until the first correct code, and refuses a wrong one", async () => {
    const before = await user.client.auth.getUser();
    expect((before.data.user?.factors ?? []).some((f) => f.status === "verified")).toBe(false);

    const wrong = await user.client.auth.mfa.challengeAndVerify({ factorId, code: "000000" });
    expect(wrong.error).not.toBeNull();

    const right = await user.client.auth.mfa.challengeAndVerify({
      factorId,
      code: totpCode(secret),
    });
    expect(right.error).toBeNull();
    const level = await user.client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(level.data?.currentLevel).toBe("aal2");
  });

  it("then a password alone gives only the first level, and the user carries the factor", async () => {
    const { client, user: signedIn } = await passwordOnly();

    // The sign-in action decides to ask for a code from exactly this.
    expect(
      (signedIn?.factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified"),
    ).toBe(true);
    // And so does a fresh read of the user, which is what every request relies on.
    const read = await client.auth.getUser();
    expect(
      (read.data.user?.factors ?? []).some(
        (f) => f.factor_type === "totp" && f.status === "verified",
      ),
    ).toBe(true);

    const level = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(level.data?.currentLevel).toBe("aal1");
    expect(level.data?.nextLevel).toBe("aal2");
  });

  it("a wrong code does not raise the session; the right one does", async () => {
    const { client } = await passwordOnly();
    const bad = await client.auth.mfa.challengeAndVerify({ factorId, code: "123456" });
    // (A one-in-a-million coincidence would make this flaky: use a code that cannot be valid.)
    const valid = new Set([-1, 0, 1].map((o) => totpCode(secret, Date.now(), o)));
    if (!valid.has("123456")) expect(bad.error).not.toBeNull();
    expect((await client.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel).toBe(
      "aal1",
    );

    const good = await client.auth.mfa.challengeAndVerify({ factorId, code: totpCode(secret) });
    expect(good.error).toBeNull();
    expect((await client.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel).toBe(
      "aal2",
    );
  });

  it("only a raised session can turn it off", async () => {
    const { client } = await passwordOnly();
    const refused = await client.auth.mfa.unenroll({ factorId });
    expect(refused.error).not.toBeNull();

    await client.auth.mfa.challengeAndVerify({ factorId, code: totpCode(secret) });
    const removed = await client.auth.mfa.unenroll({ factorId });
    expect(removed.error).toBeNull();

    const { client: after } = await passwordOnly();
    const level = await after.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(level.data?.nextLevel).toBe("aal1");
  });
});
