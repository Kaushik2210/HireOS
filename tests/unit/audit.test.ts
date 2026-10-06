// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { recordAudit, type AuditClient } from "@/services/audit";

function fakeClient(result: { error: { message: string } | null } | Error) {
  const insert = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const client: AuditClient = { from: () => ({ insert }) };
  return { client, insert };
}

describe("recordAudit", () => {
  it("writes the action, user id and metadata", async () => {
    const { client, insert } = fakeClient({ error: null });
    await recordAudit("auth.sign_in", "u1", { method: "password" }, client);
    expect(insert).toHaveBeenCalledWith({
      user_id: "u1",
      action: "auth.sign_in",
      metadata: { method: "password" },
    });
  });

  it("does nothing, and does not throw, when no admin client is configured", async () => {
    await expect(recordAudit("auth.sign_in", "u1", {}, null)).resolves.toBeUndefined();
  });

  it("swallows database errors so an audit outage cannot block sign-in", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ error: { message: "db down" } });
    await expect(recordAudit("auth.sign_in", "u1", {}, client)).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("swallows thrown errors and never logs error details or user data", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(new Error("secret-token-leak user@example.com"));
    await recordAudit("auth.sign_in_failed", null, {}, client);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("secret-token-leak");
    expect(logged).not.toContain("user@example.com");
    spy.mockRestore();
  });
});
