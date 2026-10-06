import { describe, expect, it } from "vitest";
import {
  SKILL_CATALOG,
  findCatalogSkill,
  normalizeKey,
  normalizeSkill,
  suggestSkills,
} from "@/lib/skills/catalog";

describe("skill catalog integrity", () => {
  it("has unique slugs and unique canonical names", () => {
    expect(new Set(SKILL_CATALOG.map((s) => s.slug)).size).toBe(SKILL_CATALOG.length);
    expect(new Set(SKILL_CATALOG.map((s) => normalizeKey(s.name))).size).toBe(SKILL_CATALOG.length);
  });

  it("never lets an alias shadow a different skill's canonical name or alias", () => {
    const seen = new Map<string, string>();
    for (const skill of SKILL_CATALOG) {
      for (const key of [skill.name, ...skill.aliases].map(normalizeKey)) {
        const owner = seen.get(key);
        expect(
          owner === undefined || owner === skill.slug,
          `${key} claimed by ${owner} and ${skill.slug}`,
        ).toBe(true);
        seen.set(key, skill.slug);
      }
    }
  });

  it("produces safe, URL-friendly slugs for symbol-heavy names", () => {
    expect(findCatalogSkill("C++")?.slug).toBe("cplusplus");
    expect(findCatalogSkill("C#")?.slug).toBe("csharp");
    expect(findCatalogSkill(".NET")?.slug).toBe("dotnet");
    expect(findCatalogSkill("Node.js")?.slug).toBe("nodedotjs");
    for (const s of SKILL_CATALOG) expect(s.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("normalizeSkill", () => {
  it.each([
    ["js", "JavaScript"],
    ["JS", "JavaScript"],
    ["  nodejs  ", "Node.js"],
    ["Postgres", "PostgreSQL"],
    ["k8s", "Kubernetes"],
    ["golang", "Go"],
    ["react.js", "React"],
    ["amazon   web services", "AWS"],
  ])("maps %j to %s", (input, canonical) => {
    const r = normalizeSkill(input);
    expect(r.name).toBe(canonical);
    expect(r.recognised).toBe(true);
    expect(r.type).not.toBeNull();
  });

  it("keeps unknown skills as the user typed them, with spacing cleaned", () => {
    const r = normalizeSkill("  Obscure   Framework ");
    expect(r).toEqual({ name: "Obscure Framework", slug: null, type: null, recognised: false });
  });

  it("does not fuzzy-match: near misses stay unrecognised", () => {
    expect(normalizeSkill("Pythn").recognised).toBe(false);
    expect(normalizeSkill("Java Script Pro").recognised).toBe(false);
  });

  it("does not treat Java and JavaScript as the same skill", () => {
    expect(normalizeSkill("Java").name).toBe("Java");
    expect(normalizeSkill("JavaScript").name).toBe("JavaScript");
  });
});

describe("suggestSkills", () => {
  it("ranks prefix matches first and respects the limit", () => {
    const names = suggestSkills("py").map((s) => s.name);
    expect(names[0]).toBe("Python");
    expect(suggestSkills("a", 3).length).toBeLessThanOrEqual(3);
  });

  it("returns nothing for blank input", () => {
    expect(suggestSkills("   ")).toEqual([]);
  });
});
