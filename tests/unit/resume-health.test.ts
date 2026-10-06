import { describe, expect, it } from "vitest";
import { resumeHealthSchema } from "@/lib/resume/schemas";
import { computeResumeHealth } from "@/services/resume/health";
import { parseResumeText } from "@/services/resume/parse";
import { CLASSIC, UNSTRUCTURED, WRAPPED } from "../fixtures/resume-texts";

const health = (rawText: string, pages = 1) => {
  const { text, parsed } = parseResumeText({ rawText, pages });
  return { health: computeResumeHealth({ text, parsed }), parsed };
};
const checkOf = (h: ReturnType<typeof health>["health"], id: string) =>
  h.groups.flatMap((g) => g.checks).find((c) => c.id === id)!;

describe("resume health", () => {
  it("has the six groups with weights that sum to 100", () => {
    const { health: h } = health(CLASSIC);
    expect(h.groups.map((g) => g.id)).toEqual([
      "ats",
      "structure",
      "impact",
      "readability",
      "skills",
      "keywords",
    ]);
    expect(h.groups.reduce((sum, g) => sum + g.weight, 0)).toBe(100);
  });

  it("produces output that validates against its own schema", () => {
    for (const text of [CLASSIC, WRAPPED, UNSTRUCTURED, ""]) {
      expect(resumeHealthSchema.safeParse(health(text).health).success).toBe(true);
    }
  });

  it("gives every check evidence, and a hint only when something is missing", () => {
    const { health: h } = health(CLASSIC);
    for (const c of h.groups.flatMap((g) => g.checks)) {
      expect(c.evidence.length).toBeGreaterThan(0);
      if (c.progress >= 1) expect(c.hint).toBe("");
      else expect(c.hint.length).toBeGreaterThan(0);
    }
  });

  it("scores a well-formed resume well and an unstructured one poorly", () => {
    const good = health(CLASSIC).health.score;
    const poor = health(UNSTRUCTURED).health.score;
    expect(good).toBeGreaterThanOrEqual(70);
    expect(poor).toBeLessThanOrEqual(35);
    expect(good).toBeGreaterThan(poor);
  });

  it("is deterministic", () => {
    expect(health(CLASSIC).health).toEqual(health(CLASSIC).health);
  });

  it("scores the overall result as the weighted mean of the groups", () => {
    const { health: h } = health(CLASSIC);
    const expected = Math.round(h.groups.reduce((s, g) => s + (g.weight * g.score) / 100, 0));
    expect(h.score).toBe(expected);
  });
});

describe("individual checks", () => {
  it("flags a missing email and phone", () => {
    const { health: h } = health("Name Here\n\nSKILLS\nLanguages: Python");
    expect(checkOf(h, "email").progress).toBe(0);
    expect(checkOf(h, "phone").progress).toBe(0);
  });

  it("penalises many pages", () => {
    expect(checkOf(health(CLASSIC, 1).health, "length").progress).toBe(1);
    expect(checkOf(health(CLASSIC, 3).health, "length").progress).toBe(0.5);
    expect(checkOf(health(CLASSIC, 6).health, "length").progress).toBe(0);
  });

  it("detects almost no readable text (a scanned document)", () => {
    const h = health("x", 2).health;
    expect(checkOf(h, "text").progress).toBeLessThan(0.05);
    expect(checkOf(h, "text").hint).toMatch(/scanned|image/i);
  });

  it("measures quantified results and ignores version numbers", () => {
    const text = [
      "Name Here",
      "n@e.co",
      "",
      "PROJECTS",
      "Alpha | Python",
      "• Built a service using Python 3 and HTML5 for the team",
      "• Cut load time by 40% across 12 pages",
    ].join("\n");
    const c = checkOf(health(text).health, "numbers");
    expect(c.evidence).toMatch(/^1 of 2 bullets include a number/);
  });

  it("measures action verbs", () => {
    const text = [
      "Name Here",
      "",
      "PROJECTS",
      "Alpha | Python",
      "• Built a thing that works",
      "• Responsible for a thing that works",
    ].join("\n");
    expect(checkOf(health(text).health, "verbs").evidence).toMatch(/^1 of 2/);
  });

  it("says so when there are no bullets rather than scoring them", () => {
    const h = health("Name Here\n\nSKILLS\nLanguages: Python").health;
    expect(checkOf(h, "numbers").progress).toBe(0);
    expect(checkOf(h, "numbers").evidence).toMatch(/no bullet points/i);
  });

  it("flags first-person phrasing", () => {
    const text = "Name Here\n\nSUMMARY\nI built my own app and I like my work. Please hire me.";
    expect(checkOf(health(text).health, "first-person").progress).toBeLessThan(1);
  });

  it("checks that roles are newest first", () => {
    const text = [
      "Name Here",
      "",
      "EXPERIENCE",
      "Engineer | Old Co | Jan 2018 - Dec 2019",
      "• Built a thing",
      "Engineer | New Co | Jan 2022 - Dec 2023",
      "• Built another thing",
    ].join("\n");
    expect(checkOf(health(text).health, "order").progress).toBe(0);
    expect(checkOf(health(CLASSIC).health, "order").progress).toBe(1);
  });

  it("reports general keyword breadth honestly as not job-specific", () => {
    const c = checkOf(health(CLASSIC).health, "keyword-breadth");
    expect(c.evidence).toMatch(/recognised skills and tools/);
    expect(c.hint === "" || /specific job/i.test(c.hint)).toBe(true);
  });
});
