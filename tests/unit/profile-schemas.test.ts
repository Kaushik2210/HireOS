import { describe, expect, it } from "vitest";
import {
  careerGoalSchema,
  certificationSchema,
  educationSchema,
  experienceSchema,
  profileSchema,
  projectSchema,
  skillSchema,
} from "@/lib/profile/schemas";

const issues = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (r.success ? [] : r.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`));

describe("shared field rules", () => {
  it("turns blank optional text into null and trims", () => {
    const r = projectSchema.parse({ name: "  HireOS  ", role: "   ", description: "" });
    expect(r.name).toBe("HireOS");
    expect(r.role).toBeNull();
    expect(r.description).toBeNull();
  });

  it("requires the main text field", () => {
    expect(issues(projectSchema.safeParse({ name: "   " }))).toContain(
      "name: Enter the project name",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://x.test",
    "example.com",
    "http://a b.test",
  ])("rejects the link %j", (bad) => {
    expect(projectSchema.safeParse({ name: "P", url: bad }).success).toBe(false);
  });

  it("accepts http and https links and blank links", () => {
    expect(projectSchema.safeParse({ name: "P", url: "https://example.com/a?b=1" }).success).toBe(
      true,
    );
    expect(projectSchema.safeParse({ name: "P", url: "http://example.com" }).success).toBe(true);
    expect(projectSchema.parse({ name: "P", url: "" }).url).toBeNull();
  });

  it("validates months and bounds them sensibly", () => {
    const base = { institution: "X", degree: "Y" };
    expect(educationSchema.safeParse({ ...base, start_date: "2024-13" }).success).toBe(false);
    expect(educationSchema.safeParse({ ...base, start_date: "24-01" }).success).toBe(false);
    expect(educationSchema.safeParse({ ...base, start_date: "1950-01" }).success).toBe(false);
    expect(educationSchema.safeParse({ ...base, start_date: "2999-01" }).success).toBe(false);
    expect(educationSchema.safeParse({ ...base, start_date: "2024-01" }).success).toBe(true);
  });

  it("de-duplicates list entries and enforces size caps", () => {
    const r = projectSchema.parse({ name: "P", tech: ["React", "React", "Node.js"] });
    expect(r.tech).toEqual(["React", "Node.js"]);
    const eleven = Array.from({ length: 11 }, (_, i) => `bullet ${i}`);
    expect(projectSchema.safeParse({ name: "P", highlights: eleven }).success).toBe(false);
    expect(projectSchema.safeParse({ name: "P", highlights: ["x".repeat(301)] }).success).toBe(
      false,
    );
  });
});

describe("date ranges", () => {
  const base = { organization: "Acme", title: "Intern", kind: "internship" as const };

  it("rejects an end before the start", () => {
    const r = experienceSchema.safeParse({ ...base, start_date: "2024-06", end_date: "2024-01" });
    expect(issues(r)).toContain("end_date: End date must be after the start date");
  });

  it("rejects an end date on something marked ongoing", () => {
    const r = experienceSchema.safeParse({
      ...base,
      start_date: "2024-01",
      end_date: "2024-06",
      is_current: true,
    });
    expect(r.success).toBe(false);
  });

  it("accepts an ongoing item with no end date and an equal start and end", () => {
    expect(
      experienceSchema.safeParse({ ...base, start_date: "2024-01", is_current: true }).success,
    ).toBe(true);
    expect(
      experienceSchema.safeParse({ ...base, start_date: "2024-01", end_date: "2024-01" }).success,
    ).toBe(true);
  });

  it("checks certificate expiry against issue date", () => {
    const r = certificationSchema.safeParse({
      name: "C",
      issued_date: "2024-05",
      expires_date: "2023-05",
    });
    expect(r.success).toBe(false);
  });
});

describe("skillSchema", () => {
  it("requires a known type and level", () => {
    expect(skillSchema.safeParse({ name: "Go", type: "wizard", level: "advanced" }).success).toBe(
      false,
    );
    expect(skillSchema.safeParse({ name: "Go", type: "language", level: "godlike" }).success).toBe(
      false,
    );
  });

  it("bounds years and allows it to be empty", () => {
    const ok = { name: "Go", type: "language", level: "advanced" } as const;
    expect(skillSchema.parse({ ...ok }).years).toBeNull();
    expect(skillSchema.parse({ ...ok, years: 2.5 }).years).toBe(2.5);
    expect(skillSchema.safeParse({ ...ok, years: -1 }).success).toBe(false);
    expect(skillSchema.safeParse({ ...ok, years: 51 }).success).toBe(false);
  });
});

describe("profileSchema", () => {
  it("applies defaults and normalizes currency", () => {
    const r = profileSchema.parse({ full_name: "Asha", salary_currency: " inr " });
    expect(r.salary_currency).toBe("INR");
    expect(r.salary_period).toBe("year");
    expect(r.work_modes).toEqual([]);
    expect(r.open_to_relocate).toBe(false);
  });

  it("rejects a salary range that is backwards, and a bad currency", () => {
    expect(
      profileSchema.safeParse({
        full_name: "A",
        expected_salary_min: 900,
        expected_salary_max: 100,
      }).success,
    ).toBe(false);
    expect(profileSchema.safeParse({ full_name: "A", salary_currency: "rupees" }).success).toBe(
      false,
    );
  });

  it("only allows known work modes and job types", () => {
    expect(profileSchema.safeParse({ full_name: "A", work_modes: ["teleport"] }).success).toBe(
      false,
    );
    expect(profileSchema.safeParse({ full_name: "A", job_types: ["unpaid-forever"] }).success).toBe(
      false,
    );
  });

  it("requires a name", () => {
    expect(profileSchema.safeParse({ full_name: "" }).success).toBe(false);
  });
});

describe("careerGoalSchema", () => {
  it("caps roles at five and bounds the timeline", () => {
    expect(
      careerGoalSchema.safeParse({ target_roles: ["a", "b", "c", "d", "e", "f"] }).success,
    ).toBe(false);
    expect(careerGoalSchema.safeParse({ timeline_months: 0 }).success).toBe(false);
    expect(careerGoalSchema.safeParse({ timeline_months: 121 }).success).toBe(false);
    expect(careerGoalSchema.parse({ timeline_months: 6 }).timeline_months).toBe(6);
  });
});
