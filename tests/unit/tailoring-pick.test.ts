// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { allPickKeys, excludedFrom, pickableSections } from "@/services/tailoring/pick";
import { buildResume } from "@/services/tailoring/resume";

async function master() {
  const snapshot = await new MemoryProfileStore("asha").getSnapshot("u");
  const built = buildResume(snapshot, null);
  if (!built.ok) throw new Error(built.reason);
  return built.doc;
}

describe("pickableSections", () => {
  it("lists what can be left out, section by section, omitting empty ones", async () => {
    const sections = pickableSections(await master());
    const titles = sections.map((s) => s.title);
    expect(titles).toContain("Skills");
    expect(titles).toContain("Experience");
    expect(new Set(titles).size).toBe(titles.length);
    expect(sections.every((s) => s.items.length > 0)).toBe(true);
  });

  it("gives every item and bullet a distinct key", async () => {
    const keys = allPickKeys(pickableSections(await master()));
    expect(keys.length).toBeGreaterThan(5);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("offers bullets only for highlights that really exist on the item", async () => {
    const sections = pickableSections(await master());
    for (const section of sections) {
      for (const item of section.items) {
        for (const bullet of item.bullets) {
          expect(bullet.key).toMatch(new RegExp(`^${item.key}#h\\d+$`));
        }
      }
    }
  });
});

describe("excludedFrom", () => {
  it("turns the checked boxes into what to leave out", async () => {
    const sections = pickableSections(await master());
    const all = allPickKeys(sections);
    expect(excludedFrom(sections, all)).toEqual([]);
    expect(excludedFrom(sections, [])).toEqual(all);
    expect(excludedFrom(sections, all.slice(1))).toEqual([all[0]]);
  });

  it("ignores keys that do not exist, so a forged list cannot name anything else", async () => {
    const sections = pickableSections(await master());
    const all = allPickKeys(sections);
    const result = excludedFrom(sections, ["not-a-real-key", ...all.slice(2)]);
    expect(result).toEqual(all.slice(0, 2));
    expect(result).not.toContain("not-a-real-key");
  });
});
