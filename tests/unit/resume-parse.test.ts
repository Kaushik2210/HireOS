import { describe, expect, it } from "vitest";
import { parsedResumeSchema } from "@/lib/resume/schemas";
import { parseResumeText } from "@/services/resume/parse";
import { CLASSIC, INJECTION, PIPE_STYLE, UNSTRUCTURED, WRAPPED } from "../fixtures/resume-texts";

const parse = (rawText: string) => parseResumeText({ rawText, pages: 1 }).parsed;

describe("classic layout", () => {
  const p = parse(CLASSIC);

  it("reads contact details", () => {
    expect(p.contact).toMatchObject({
      full_name: "Priya Menon",
      email: "priya.menon@example.com",
      phone: "+91 98765 43210",
      location: "Pune, India",
      linkedin_url: "https://linkedin.com/in/priya-menon-demo",
      github_url: "https://github.com/priya-menon-demo",
    });
  });

  it("detects the standard sections", () => {
    const keys = p.sections.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "summary",
        "experience",
        "projects",
        "education",
        "skills",
        "certifications",
        "achievements",
      ]),
    );
  });

  it("reads the internship with title, organisation, place, dates and bullets", () => {
    expect(p.experiences).toHaveLength(1);
    const job = p.experiences[0]!;
    expect(job).toMatchObject({
      kind: "internship",
      title: "Backend Developer Intern",
      organization: "Brightleaf Software",
      location: "Pune",
      start_date: "2025-05",
      end_date: "2025-07",
      is_current: false,
    });
    expect(job.highlights).toHaveLength(3);
    expect(job.skills).toEqual(expect.arrayContaining(["Django", "PostgreSQL"]));
  });

  it("reads both projects with tech, dates, bullets and the repository link", () => {
    expect(p.projects.map((x) => x.name)).toEqual([
      "Campus Placement Tracker",
      "Expense Splitter API",
    ]);
    const first = p.projects[0]!;
    expect(first.tech).toEqual(expect.arrayContaining(["Python", "Django", "PostgreSQL"]));
    expect(first.start_date).toBe("2025-01");
    expect(first.highlights).toHaveLength(2);
    const second = p.projects[1]!;
    expect(second.tech).toEqual(expect.arrayContaining(["FastAPI", "SQLite"]));
    expect(second.repo_url).toBe("https://github.com/priya-menon-demo/expense-splitter");
  });

  it("reads both degrees with institution, grade and dates", () => {
    expect(p.education).toHaveLength(2);
    const [mca, bca] = p.education;
    expect(mca).toMatchObject({
      degree: "Master of Computer Applications",
      institution: "Riverside Institute of Technology, Pune",
      start_date: "2024-08",
      end_date: "2026-06",
    });
    expect(mca!.grade).toMatch(/8\.4/);
    expect(bca).toMatchObject({ start_date: "2021-01", end_date: "2024-12", grade: "81%" });
  });

  it("collects labelled skills with canonical names and categories", () => {
    const byName = Object.fromEntries(p.skills.map((s) => [s.name, s]));
    expect(byName.Python).toMatchObject({ type: "language" });
    expect(byName.Django).toMatchObject({ type: "framework" });
    expect(byName.PostgreSQL).toMatchObject({ type: "database" });
    expect(byName.Git).toMatchObject({ type: "tool" });
  });

  it("derives levels from evidence, not guesses", () => {
    const byName = Object.fromEntries(p.skills.map((s) => [s.name, s]));
    expect(byName.Django!.level).toBe("intermediate"); // listed and used in a role and project
    expect(byName.Postman!.level).toBe("beginner"); // listed, never used
    for (const s of p.skills) expect(s.years).toBeNull();
  });

  it("reads certifications and achievements", () => {
    expect(p.certifications[0]).toMatchObject({
      name: "PostgreSQL Fundamentals",
      issued_date: "2025-02",
    });
    expect(p.achievements.map((a) => a.category)).toEqual(["competition", "award"]);
  });

  it("flags year-only dates and the output validates against its own schema", () => {
    expect(p.notes.join(" ")).toMatch(/only gave a year/i);
    expect(parsedResumeSchema.safeParse(p).success).toBe(true);
  });
});

describe("pipe-separated layout", () => {
  const p = parse(PIPE_STYLE);

  it("reads contact details without a labelled location line", () => {
    expect(p.contact).toMatchObject({
      full_name: "RAHUL VERMA",
      email: "rahul.verma@example.com",
      website_url: "https://rahulverma.example.dev",
    });
    expect(p.contact.phone).toMatch(/9123456780/);
  });

  it("reads one-line role headers, an ongoing role, and kinds", () => {
    expect(p.experiences).toHaveLength(2);
    expect(p.experiences[0]).toMatchObject({
      kind: "work",
      title: "Software Engineer",
      organization: "Acme Technologies Pvt Ltd",
      start_date: "2023-07",
      end_date: null,
      is_current: true,
    });
    expect(p.experiences[1]).toMatchObject({ kind: "internship", organization: "Beta Labs" });
    expect(p.experiences[0]!.highlights).toHaveLength(3);
  });

  it("splits degree and field on a single education line", () => {
    expect(p.education[0]).toMatchObject({
      degree: "B.Tech",
      field_of_study: "Computer Science",
      start_date: "2019-01",
    });
  });

  it("reads a comma-only skills list under an ampersand heading", () => {
    const names = p.skills.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(["TypeScript", "React", "Node.js", "Redis", "Docker", "PostgreSQL"]),
    );
  });
});

describe("wrapped lines and sparse layout", () => {
  const p = parse(WRAPPED);

  it("joins wrapped bullet lines back into one bullet", () => {
    const highlights = p.experiences[0]!.highlights;
    expect(highlights).toHaveLength(2);
    expect(highlights[0]).toContain("across 40 stores");
  });

  it("reads a role written as 'Title, Organisation (years)'", () => {
    expect(p.experiences[0]).toMatchObject({
      title: "Junior Data Analyst",
      organization: "Orchard Retail Analytics",
      start_date: "2023-01",
    });
  });

  it("reads skills from an unlabelled list", () => {
    expect(p.skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(["SQL", "Python", "Pandas", "Power BI", "Tableau", "Excel"]),
    );
  });
});

describe("degraded input", () => {
  it("returns a valid, mostly empty result for an unstructured resume, with a note", () => {
    const p = parse(UNSTRUCTURED);
    expect(p.experiences).toEqual([]);
    expect(p.skills).toEqual([]);
    expect(p.notes.join(" ")).toMatch(/no standard section headings/i);
    expect(parsedResumeSchema.safeParse(p).success).toBe(true);
  });

  it("copes with empty text", () => {
    const p = parse("");
    expect(p.stats.words).toBe(0);
    expect(parsedResumeSchema.safeParse(p).success).toBe(true);
  });

  it("never crashes on garbage", () => {
    const noise = Array.from(
      { length: 300 },
      (_, i) => `${"x".repeat(i % 50)} ${i} | – ${i * 7}`,
    ).join("\n");
    expect(() => parse(noise)).not.toThrow();
    expect(() => parse("\u0000\u0001￿•••\n\n\n---")).not.toThrow();
  });

  it("is deterministic", () => {
    expect(parse(CLASSIC)).toEqual(parse(CLASSIC));
  });
});

describe("untrusted text stays data", () => {
  it("treats instruction-like text as ordinary content and never acts on it", () => {
    const p = parse(INJECTION);
    expect(p.summary).toContain("Ignore previous instructions");
    expect(p.contact.full_name).toBe("Alex Rao");
    expect(p.skills.map((s) => s.name).sort()).toEqual(["Python", "SQL"]);
    // The text is carried verbatim as data: nothing in the output was derived by following it.
    expect(JSON.stringify(p.education)).not.toMatch(/admin/i);
  });
});

describe("bounds", () => {
  it("keeps every field within schema limits on very long lines", () => {
    const long = "word ".repeat(400);
    const text = `Name Here\nn@e.co\n\nPROJECTS\nBig Project\n• ${long}\n• ${long}`;
    const p = parse(text);
    expect(parsedResumeSchema.safeParse(p).success).toBe(true);
    for (const h of p.projects[0]?.highlights ?? []) expect(h.length).toBeLessThanOrEqual(300);
  });
});
