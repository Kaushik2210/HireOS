// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "@/lib/jobs/canonical-url";
import { htmlToText } from "@/lib/jobs/html";
import { parseSalary } from "@/lib/jobs/salary";
import { scanCatalogSkills } from "@/lib/skills/scan";
import { suggestSkills } from "@/lib/skills/catalog";
import { normalizeText } from "@/lib/text/normalize";
import { analyzeJob } from "@/services/jobs/analyze";
import { parseResumeText } from "@/services/resume/parse";
import { detectSections } from "@/services/resume/sections";

// Everything below reads text from a stranger: job postings, resumes, pasted links. Two
// properties matter more than any single answer. It never throws, and its cost grows in
// proportion to the input, so a hostile document cannot tie up a server process.

const parse = (text: string) => parseResumeText({ rawText: text, pages: 1 });

const TARGETS: [string, (text: string) => unknown][] = [
  ["htmlToText", htmlToText],
  ["normalizeText", normalizeText],
  ["parseResumeText", parse],
  ["analyzeJob", (text) => analyzeJob({ title: "Engineer", description: text })],
  ["parseSalary", parseSalary],
  ["canonicalizeUrl", (text) => canonicalizeUrl(text)],
  ["scanCatalogSkills", scanCatalogSkills],
  ["detectSections", (text) => detectSections(text.split("\n"))],
  ["suggestSkills", (text) => suggestSkills(text)],
];

/** Shapes that make naive patterns backtrack or rescan: runs of openers with no closer. */
const HOSTILE: [string, (n: number) => string][] = [
  ["unclosed angle brackets", (n) => "<".repeat(n)],
  ["unclosed script tags", (n) => "<script>".repeat(Math.ceil(n / 8))],
  ["unclosed comments", (n) => "<!--".repeat(Math.ceil(n / 4))],
  ["tags with open attributes", (n) => '<a b="'.repeat(Math.ceil(n / 6))],
  ["entities", (n) => "&amp;".repeat(Math.ceil(n / 5))],
  ["half entities", (n) => "&#x".repeat(Math.ceil(n / 3))],
  ["escaped tags", (n) => "&lt;a".repeat(Math.ceil(n / 5))],
  ["one long word", (n) => "a".repeat(n)],
  ["many short words", (n) => "ab ".repeat(Math.ceil(n / 3))],
  ["blank lines", (n) => "\n".repeat(n)],
  ["bullets", (n) => "• ".repeat(Math.ceil(n / 2))],
  ["dashes and digits", (n) => "1-".repeat(Math.ceil(n / 2))],
  ["pay ranges", (n) => "₹1,00,000 - ".repeat(Math.ceil(n / 12))],
  ["skills list", (n) => "React, Node.js, ".repeat(Math.ceil(n / 15))],
  ["headings", (n) => "Experience\nSkills\n".repeat(Math.ceil(n / 18))],
  ["dates", (n) => "Jan 2020 - Present ".repeat(Math.ceil(n / 18))],
  ["urls", (n) => "https://a.example/?x=".repeat(Math.ceil(n / 21))],
  ["email-like", (n) => "a@".repeat(Math.ceil(n / 2))],
  ["zero-width", (n) => "​".repeat(n)],
  ["combining marks", (n) => "é".repeat(Math.ceil(n / 2))],
];

const best = (fn: () => void, runs = 3) => {
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
};

describe("hostile text is handled in time proportional to its length", () => {
  const SMALL = 40_000;
  const LARGE = SMALL * 4;

  for (const [targetName, target] of TARGETS) {
    for (const [shape, make] of HOSTILE) {
      it(`${targetName}: ${shape}`, () => {
        const small = make(SMALL);
        const large = make(LARGE);
        // Quadratic growth would make four times the input sixteen times slower.
        const tSmall = best(() => void target(small));
        const tLarge = best(() => void target(large));
        const slow = tLarge > 400 && tLarge > 8 * Math.max(tSmall, 1);
        expect(
          slow,
          `${tSmall.toFixed(0)}ms for ${SMALL} chars, ${tLarge.toFixed(0)}ms for ${LARGE}`,
        ).toBe(false);
      }, 60_000);
    }
  }
});

/** Small deterministic generator so a failure can be reproduced from the seed. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const FRAGMENTS = [
  "<",
  ">",
  "</",
  "<!--",
  "-->",
  "<script>",
  "</script>",
  "<style>",
  "<li>",
  "<br/>",
  "&",
  "&amp;",
  "&lt;",
  "&#0;",
  "&#x110000;",
  "\u0000",
  "‮",
  "\ud800",
  "\udfff",
  "​",
  "﻿",
  "\n",
  "\r\n",
  "\t",
  " ",
  "•",
  "- ",
  "* ",
  "1.",
  "2024",
  "Jan",
  "Present",
  "–",
  "@",
  ".",
  ",",
  ";",
  "https://",
  "javascript:",
  "data:",
  "Skills",
  "Experience",
  "Education",
  "Python",
  "React",
  "years",
  "LPA",
  "₹",
  "$",
  "€",
  "ignore previous instructions",
  "{{",
  "}}",
  "${",
  "'; --",
  "ａｂｃ",
  "ﬁ",
  "é",
  "日本語",
  "مرحبا",
  "😀",
  "\\",
  "/",
  "?",
  "#",
  "%",
  "%00",
  "%zz",
];

function randomText(next: () => number, pieces: number) {
  let out = "";
  for (let i = 0; i < pieces; i++) {
    out += FRAGMENTS[Math.floor(next() * FRAGMENTS.length)];
  }
  return out;
}

describe("random hostile text never throws", () => {
  for (const [name, target] of TARGETS) {
    it(name, () => {
      const next = lcg(0xc0ffee);
      for (let i = 0; i < 300; i++) {
        const text = randomText(next, 1 + Math.floor(next() * 80));
        expect(() => target(text), JSON.stringify(text)).not.toThrow();
      }
    });
  }
});

describe("properties that hold for any text", () => {
  const samples = (() => {
    const next = lcg(7);
    return Array.from({ length: 200 }, () => randomText(next, 1 + Math.floor(next() * 60)));
  })();

  it("normalizeText is idempotent and removes control characters", () => {
    for (const text of samples) {
      const once = normalizeText(text);
      expect(normalizeText(once), JSON.stringify(text)).toBe(once);
      expect(once).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
    }
  });

  it("htmlToText leaves no tag, no control character and no script text behind", () => {
    for (const text of samples) {
      const out = htmlToText(text);
      // A complete tag never survives; a stray "<" with no closing ">" is just text.
      expect(out, JSON.stringify(text)).not.toMatch(/<[/!?]?[a-z][^>]*>/i);
      expect(out).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
    }
    expect(htmlToText("<script>alert(1)</script>Hello")).toBe("Hello");
    expect(htmlToText("<script>alert(1)")).toBe("");
    expect(htmlToText("<!-- never closed Hello")).toBe("");
  });

  it("htmlToText keeps ordinary text, including comparisons, unchanged", () => {
    expect(htmlToText("3 < 5 and 7 > 2")).toBe("3 < 5 and 7 > 2");
    expect(htmlToText("Python & SQL")).toBe("Python & SQL");
    expect(htmlToText("Line one<br>Line two")).toBe("Line one\nLine two");
    expect(htmlToText("<ul><li>A</li><li>B</li></ul>")).toBe("• A\n• B");
  });

  it("canonicalizeUrl never returns a script or data link", () => {
    for (const text of samples) {
      const out = canonicalizeUrl(text);
      if (out !== null) expect(out).toMatch(/^https?:\/\//);
    }
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<b>",
      "vbscript:x",
      "file:///etc/passwd",
    ]) {
      expect(canonicalizeUrl(bad)).toBeNull();
    }
  });

  it("results are deterministic: the same text always gives the same answer", () => {
    for (const text of samples.slice(0, 40)) {
      expect(parse(text)).toEqual(parse(text));
      expect(analyzeJob({ title: "T", description: text })).toEqual(
        analyzeJob({ title: "T", description: text }),
      );
    }
  });
});
