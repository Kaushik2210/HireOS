// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { limitAction, resetActionLimits } from "@/lib/security/action-limits";

beforeEach(() => resetActionLimits());

describe("limitAction", () => {
  it("lets ordinary use through", async () => {
    for (let i = 0; i < 100; i++) expect(await limitAction("user-1")).toBeNull();
  });

  it("stops a flood of changes from one person without touching anyone else", async () => {
    for (let i = 0; i < 180; i++) expect(await limitAction("user-flood")).toBeNull();
    const refused = await limitAction("user-flood");
    expect(refused).toEqual({ ok: false, error: expect.stringContaining("very quickly") });
    expect(await limitAction("user-other")).toBeNull();
  });

  it("holds building work to a tighter budget than plain edits", async () => {
    for (let i = 0; i < 60; i++) expect(await limitAction("user-heavy", "heavy")).toBeNull();
    expect(await limitAction("user-heavy", "heavy")).not.toBeNull();
    // Edits are counted separately, so a person who has built a lot can still tidy up.
    expect(await limitAction("user-heavy", "write")).toBeNull();
  });

  it("does not leak how the limit works in its message", async () => {
    for (let i = 0; i < 181; i++) await limitAction("user-msg");
    const refused = await limitAction("user-msg");
    expect(JSON.stringify(refused)).not.toMatch(/180|60|window|per minute/i);
  });
});
