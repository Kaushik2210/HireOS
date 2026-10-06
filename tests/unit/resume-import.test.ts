// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { MAX_ITEMS_PER_COLLECTION } from "@/lib/profile/constants";
import { skillSchema } from "@/lib/profile/schemas";
import { verifiedSnapshot } from "@/services/profile/verified";
import { applyImportPlan, buildImportPlan } from "@/services/resume/import";
import { parseResumeText } from "@/services/resume/parse";
import { computeCompleteness } from "@/services/profile/completeness";
import { CLASSIC } from "../fixtures/resume-texts";

const parsed = () => parseResumeText({ rawText: CLASSIC, pages: 1 }).parsed;
const blank = () => new MemoryProfileStore(null);
const skill = (name: string) => skillSchema.parse({ name, type: "language", level: "advanced" });

describe("buildImportPlan", () => {
  it("plans every parsed item for an empty profile, and a profile from the contact block", async () => {
    const store = blank();
    const plan = buildImportPlan(parsed(), await store.getSnapshot("u"));
    expect(plan.items.experiences).toHaveLength(1);
    expect(plan.items.projects).toHaveLength(2);
    expect(plan.items.education).toHaveLength(2);
    expect(plan.items.skills.length).toBeGreaterThan(8);
    expect(plan.profile).toMatchObject({ full_name: "Priya Menon", location: "Pune, India" });
    expect(plan.total).toBe(Object.values(plan.items).reduce((n, list) => n + list.length, 0));
  });

  it("does not plan a profile when one already exists", async () => {
    const store = new MemoryProfileStore("asha");
    const plan = buildImportPlan(parsed(), await store.getSnapshot("u"));
    expect(plan.profile).toBeNull();
  });

  it("skips entries the profile already has, ignoring case", async () => {
    const store = blank();
    await store.createItem("u", "skills", skill("python"));
    const plan = buildImportPlan(parsed(), await store.getSnapshot("u"));
    expect(plan.items.skills.map((s) => String(s.name))).not.toContain("Python");
    expect(plan.duplicates.skills).toBe(1);
  });

  it("recognises an existing experience by organisation, title and start date", async () => {
    const store = new MemoryProfileStore(null);
    const [job] = parsed().experiences;
    await store.createItem("u", "experiences", job as never);
    const plan = buildImportPlan(parsed(), await store.getSnapshot("u"));
    expect(plan.items.experiences).toHaveLength(0);
    expect(plan.duplicates.experiences).toBe(1);
  });

  it("stops at the per-section limit instead of overflowing it", async () => {
    const store = blank();
    for (let i = 0; i < MAX_ITEMS_PER_COLLECTION - 1; i++) {
      await store.createItem("u", "skills", skill(`Filler ${i}`));
    }
    const plan = buildImportPlan(parsed(), await store.getSnapshot("u"));
    expect(plan.items.skills).toHaveLength(1);
    expect(plan.overLimit.skills).toBeGreaterThan(0);
  });

  it("is pure: planning writes nothing", async () => {
    const store = blank();
    buildImportPlan(parsed(), await store.getSnapshot("u"));
    expect((await store.getSnapshot("u")).skills).toEqual([]);
  });
});

describe("applyImportPlan and the integrity rule", () => {
  it("creates every item as an unconfirmed resume proposal", async () => {
    const store = blank();
    const plan = buildImportPlan(parsed(), await store.getSnapshot("u"));
    const result = await applyImportPlan(store, "u", plan);

    expect(result.total).toBe(plan.total);
    expect(result.profileCreated).toBe(true);

    const snap = await store.getSnapshot("u");
    const everything = [
      ...snap.education,
      ...snap.experiences,
      ...snap.projects,
      ...snap.certifications,
      ...snap.skills,
      ...snap.achievements,
    ];
    expect(everything.length).toBe(result.total);
    for (const item of everything)
      expect(item).toMatchObject({ source: "resume", confirmed: false });
  });

  it("keeps imported items out of the verified view and the completeness score until confirmed", async () => {
    const store = blank();
    await applyImportPlan(store, "u", buildImportPlan(parsed(), await store.getSnapshot("u")));
    const snap = await store.getSnapshot("u");

    const verified = verifiedSnapshot(snap);
    expect(verified.skills).toEqual([]);
    expect(verified.experiences).toEqual([]);
    const before = computeCompleteness(snap).score;

    expect(await store.confirmAll("u")).toBeGreaterThan(0);
    const after = computeCompleteness(await store.getSnapshot("u")).score;
    expect(after).toBeGreaterThan(before);
  });

  it("is safe to run twice: the second run adds nothing", async () => {
    const store = blank();
    await applyImportPlan(store, "u", buildImportPlan(parsed(), await store.getSnapshot("u")));
    const second = buildImportPlan(parsed(), await store.getSnapshot("u"));
    expect(second.total).toBe(0);
    expect(second.profile).toBeNull();
    const result = await applyImportPlan(store, "u", second);
    expect(result.total).toBe(0);
  });

  it("counts a duplicate that appears between planning and writing instead of failing", async () => {
    const store = blank();
    const plan = buildImportPlan(parsed(), await store.getSnapshot("u"));
    await store.createItem("u", "skills", skill("Python")); // arrives after planning
    const result = await applyImportPlan(store, "u", plan);
    expect(result.duplicates).toBeGreaterThanOrEqual(1);
    expect(result.total).toBe(plan.total - 1);
  });
});

describe("confirming items", () => {
  it("confirms one item, ignores unknown ids, and is scoped to the owner", async () => {
    const store = blank();
    const item = await store.createItem("owner", "skills", skill("Go"), {
      source: "resume",
      confirmed: false,
    });
    expect(await store.confirmItem("intruder", "skills", item.id)).toBe(false);
    expect(await store.confirmItem("owner", "skills", crypto.randomUUID())).toBe(false);
    expect((await store.getSnapshot("owner")).skills[0]?.confirmed).toBe(false);

    expect(await store.confirmItem("owner", "skills", item.id)).toBe(true);
    expect((await store.getSnapshot("owner")).skills[0]?.confirmed).toBe(true);
  });

  it("confirmAll reports how many changed and leaves other users alone", async () => {
    const store = blank();
    await store.createItem("a", "skills", skill("Go"), { source: "resume", confirmed: false });
    await store.createItem("a", "skills", skill("Rust"), { source: "resume", confirmed: false });
    await store.createItem("a", "skills", skill("C++"));
    await store.createItem("b", "skills", skill("Zig"), { source: "resume", confirmed: false });

    expect(await store.confirmAll("a")).toBe(2);
    expect(await store.confirmAll("a")).toBe(0);
    expect((await store.getSnapshot("b")).skills[0]?.confirmed).toBe(false);
  });
});
