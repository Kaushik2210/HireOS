import { describe, expect, it } from "vitest";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { EMPTY_SNAPSHOT } from "@/db/profile/store";
import { DEMO_PERSONAS } from "@/db/seed/demo-personas";
import { computeCompleteness } from "@/services/profile/completeness";
import { pendingCount, verifiedSnapshot } from "@/services/profile/verified";

async function snapshotFor(personaId: string | null) {
  const store = new MemoryProfileStore(personaId);
  return { store, snapshot: await store.getSnapshot("u1") };
}

describe("computeCompleteness", () => {
  it("scores an empty profile at zero with next steps", () => {
    const r = computeCompleteness(EMPTY_SNAPSHOT);
    expect(r.score).toBe(0);
    expect(r.nextSteps).toHaveLength(3);
  });

  it("has weights that sum to exactly 100", () => {
    const r = computeCompleteness(EMPTY_SNAPSHOT);
    expect(r.criteria.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
  });

  it("gives every criterion evidence and a hint", () => {
    for (const c of computeCompleteness(EMPTY_SNAPSHOT).criteria) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.hint.length).toBeGreaterThan(0);
    }
  });

  it("scores complete demo personas highly, and is deterministic", async () => {
    for (const persona of DEMO_PERSONAS) {
      const { snapshot } = await snapshotFor(persona.id);
      const a = computeCompleteness(snapshot);
      const b = computeCompleteness(snapshot);
      expect(a).toEqual(b);
      expect(a.score, persona.id).toBeGreaterThanOrEqual(85);
      expect(a.score).toBeLessThanOrEqual(100);
    }
  });

  it("awards partial credit and names the biggest remaining gaps first", async () => {
    const { store } = await snapshotFor(null);
    await store.saveSingleton("u1", "profiles", {
      full_name: "A",
      headline: null,
      summary: "x".repeat(40),
      location: null,
      linkedin_url: null,
      github_url: null,
      website_url: null,
      experience_level: null,
      work_modes: [],
      job_types: [],
      preferred_locations: [],
      open_to_relocate: false,
      expected_salary_min: null,
      expected_salary_max: null,
      salary_currency: "INR",
      salary_period: "year",
    });
    const r = computeCompleteness(await store.getSnapshot("u1"));
    const summary = r.criteria.find((c) => c.id === "summary")!;
    expect(summary.progress).toBeCloseTo(0.5);
    expect(r.score).toBe(10); // name 5 + half the summary (5)
    const lost = r.nextSteps.map((c) => c.weight * (1 - c.progress));
    expect([...lost].sort((a, b) => b - a)).toEqual(lost);
  });

  it("counts only confirmed items, so unconfirmed resume items cannot inflate the score", async () => {
    const { store } = await snapshotFor(null);
    const skill = { name: "Go", type: "language", level: "advanced", years: null } as const;
    for (let i = 0; i < 8; i++) {
      await store.createItem(
        "u1",
        "skills",
        { ...skill, name: `Skill ${i}` },
        { source: "resume", confirmed: false },
      );
    }
    const snapshot = await store.getSnapshot("u1");
    expect(computeCompleteness(snapshot).criteria.find((c) => c.id === "skills")!.progress).toBe(0);
    expect(pendingCount(snapshot)).toBe(8);
    expect(verifiedSnapshot(snapshot).skills).toHaveLength(0);
  });
});
