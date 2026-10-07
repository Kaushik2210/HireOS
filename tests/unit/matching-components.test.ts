// @vitest-environment node
import { describe, expect, it } from "vitest";
import { COMPONENT_IDS, COMPONENT_WEIGHTS, LABEL_THRESHOLDS, labelFor } from "@/lib/matching/types";
import { degreeLevel } from "@/services/matching/candidate";
import {
  educationComponent,
  experienceComponent,
  keywordsComponent,
  locationComponent,
  projectsComponent,
  seniorityComponent,
  skillsComponent,
} from "@/services/matching/components";
import { educationRequirement, experienceRequirement } from "@/services/matching/requirements";
import { NOW, candidateFrom, makeJob } from "../fixtures/matching";

describe("weights and labels", () => {
  it("has seven components whose weights sum to exactly 100", () => {
    expect(COMPONENT_IDS).toHaveLength(7);
    expect(Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it.each([
    [100, "strong"],
    [80, "strong"],
    [79, "good"],
    [65, "good"],
    [64, "stretch"],
    [45, "stretch"],
    [44, "low"],
    [0, "low"],
  ] as const)("labels %i as %s", (strength, label) => {
    expect(labelFor(strength)).toBe(label);
  });

  it("keeps the thresholds the product spec states", () => {
    expect(LABEL_THRESHOLDS).toEqual({ strong: 80, good: 65, stretch: 45 });
  });
});

describe("skills component", () => {
  const job = makeJob({
    required_skills: ["Python", "Django", "Docker"],
    preferred_skills: ["Apache Kafka"],
  });

  it("scores 100 when every skill is held at a high level", async () => {
    const c = await candidateFrom({
      skills: [
        ["Python", "advanced"],
        ["Django", "expert"],
        ["Docker", "advanced"],
        ["Kafka", "advanced"],
      ],
    });
    expect(skillsComponent(job, c).component.score).toBe(100);
  });

  it("scores 0 when none are held, and says so in plain words", async () => {
    const c = await candidateFrom({ skills: [["Excel", "advanced"]] });
    const r = skillsComponent(job, c);
    expect(r.component.score).toBe(0);
    expect(r.component.summary).toBe("0 of 3 required skills found in your verified profile.");
    expect(r.missingRequired).toEqual(["Python", "Django", "Docker"]);
    expect(r.requiredCoverage).toBe(0);
  });

  it("uses the exact required-skill wording the product promises", async () => {
    const c = await candidateFrom({ skills: [["Python", "advanced"]] });
    const gap = skillsComponent(job, c).gaps.find((g) => g.text.startsWith("Docker"))!;
    expect(gap.text).toBe(
      "Docker is required by this job but was not found in your verified profile. If you have genuinely used it, add the experience.",
    );
    expect(gap).toMatchObject({ kind: "required_skill", severity: "high" });
  });

  it("gives partial credit by level, and half weight to nice-to-haves", async () => {
    const onlyRequired = makeJob({ required_skills: ["Python"] });
    const score = async (level: "beginner" | "intermediate" | "advanced") =>
      skillsComponent(onlyRequired, await candidateFrom({ skills: [["Python", level]] })).component
        .score;
    expect(await score("beginner")).toBe(60);
    expect(await score("intermediate")).toBe(85);
    expect(await score("advanced")).toBe(100);

    const mixed = makeJob({ required_skills: ["Python"], preferred_skills: ["Docker"] });
    // Python advanced (1.0 of 1) and Docker missing (0 of 0.5): 1.0 / 1.5
    expect(
      skillsComponent(mixed, await candidateFrom({ skills: [["Python", "advanced"]] })).component
        .score,
    ).toBe(67);
  });

  it("flags a required skill held only at beginner level as weak", async () => {
    const c = await candidateFrom({ skills: [["Python", "beginner"]] });
    const gap = skillsComponent(makeJob({ required_skills: ["Python"] }), c).gaps[0]!;
    expect(gap).toMatchObject({ kind: "weak_skill", severity: "medium" });
    expect(gap.text).toContain("beginner level");
  });

  it("counts a skill evidenced only by a project or role at working-knowledge credit", async () => {
    const c = await candidateFrom({ projects: [{ name: "Tracker", tech: ["Docker"] }] });
    const r = skillsComponent(makeJob({ required_skills: ["Docker"] }), c);
    expect(r.component.score).toBe(85);
    expect(r.component.inputs[0]!.value).toContain('Used in "Tracker"');
    expect(r.why[0]!.source_ref).toMatchObject({ entity: "projects" });
  });

  it("matches aliases and canonical names the same way", async () => {
    const c = await candidateFrom({ skills: [["postgres", "advanced"]] }); // saved as a plain skill row
    expect(skillsComponent(makeJob({ required_skills: ["PostgreSQL"] }), c).component.score).toBe(
      100,
    );
  });

  it("is not applicable when the posting names no skills", async () => {
    const r = skillsComponent(makeJob(), await candidateFrom({ skills: [["Python", "advanced"]] }));
    expect(r.component).toMatchObject({ applicable: false, score: null });
    expect(r.requiredCoverage).toBeNull();
  });

  it("ties every 'why' to a verified item", async () => {
    const c = await candidateFrom({
      skills: [
        ["Python", "advanced"],
        ["Django", "advanced"],
      ],
    });
    for (const w of skillsComponent(job, c).why) expect(w.source_ref).not.toBeNull();
  });

  it("never lets unconfirmed skills count, and points them out instead", async () => {
    const c = await candidateFrom({
      skills: [
        ["Python", "advanced"],
        ["Docker", "advanced", false],
      ],
    });
    const r = skillsComponent(job, c);
    expect(r.missingRequired).toContain("Docker");
    const gap = r.gaps.find((g) => g.text.startsWith("Docker"))!;
    expect(gap.text).toBe(
      "Docker appears in an unconfirmed item from your resume. Review and confirm it to count it.",
    );
  });

  it("mentions a same-category skill as context without crediting it", async () => {
    const c = await candidateFrom({ skills: [["PostgreSQL", "advanced"]] });
    const r = skillsComponent(makeJob({ required_skills: ["MySQL"] }), c);
    expect(r.component.score).toBe(0);
    expect(r.gaps[0]!.suggestion).toMatch(/PostgreSQL.*not the same skill/);
  });
});

describe("projects component", () => {
  const job = makeJob({ required_skills: ["Python", "Django", "Docker", "Redis"] });

  it("scores 0 with a clear gap when there are no verified projects", async () => {
    const r = projectsComponent(job, await candidateFrom({ skills: [["Python", "advanced"]] }));
    expect(r.component.score).toBe(0);
    expect(r.gaps[0]!.text).toBe("You have no verified projects that use this job's skills.");
  });

  it("covers the job's skills across the best two projects", async () => {
    const c = await candidateFrom({
      projects: [
        { name: "One", tech: ["Python", "Django"] },
        { name: "Two", tech: ["Docker"] },
        { name: "Three", tech: ["Excel"] },
      ],
    });
    const r = projectsComponent(job, c);
    expect(r.component.score).toBe(75); // 3 of 4 skills
    expect(r.why.map((w) => w.source_ref?.entity)).toEqual(["projects", "projects"]);
    expect(r.component.inputs.map((i) => i.label)).toContain("Project: One");
  });

  it("reads skills out of project text, not only the tech list", async () => {
    const c = await candidateFrom({
      projects: [{ name: "Cache layer", highlights: ["Added a Redis cache in front of the API"] }],
    });
    expect(projectsComponent(job, c).component.score).toBe(25);
  });

  it("excludes unconfirmed projects", async () => {
    const c = await candidateFrom({
      projects: [
        { name: "Maybe", tech: ["Python", "Django", "Docker", "Redis"], confirmed: false },
      ],
    });
    expect(projectsComponent(job, c).component.score).toBe(0);
  });

  it("is not applicable when the posting names no skills", async () => {
    expect(projectsComponent(makeJob(), await candidateFrom({})).component.applicable).toBe(false);
  });
});

describe("experience component", () => {
  it("merges overlapping roles so time is never counted twice", async () => {
    const c = await candidateFrom({
      experiences: [
        { title: "Dev", organization: "A", start: "2024-01", end: "2024-12" },
        { title: "Dev", organization: "B", start: "2024-07", end: "2025-06" },
      ],
    });
    expect(c.experienceMonths).toBe(18); // Jan 2024 to Jun 2025
  });

  it("counts a current role up to the given date", async () => {
    const c = await candidateFrom({
      experiences: [{ title: "Dev", organization: "A", start: "2026-01", current: true }],
    });
    expect(c.experienceMonths).toBe(10); // Jan to Oct 2026 inclusive
  });

  it("does not count leadership or volunteer roles as professional experience", async () => {
    const c = await candidateFrom({
      experiences: [
        {
          title: "Club lead",
          organization: "Club",
          kind: "leadership",
          start: "2023-01",
          end: "2024-12",
        },
        {
          title: "Intern",
          organization: "Acme",
          kind: "internship",
          start: "2025-05",
          end: "2025-07",
        },
      ],
    });
    expect(c.experienceMonths).toBe(3);
    const r = experienceComponent(makeJob({ min_years: 1 }), c);
    expect(r.component.inputs.map((i) => i.label)).toContain("Not counted");
  });

  it("scores in proportion to the years asked for, and states both numbers", async () => {
    const c = await candidateFrom({
      experiences: [{ title: "Dev", organization: "A", start: "2025-10", end: "2026-09" }],
    });
    const r = experienceComponent(makeJob({ min_years: 2 }), c);
    expect(r.component.score).toBe(50);
    expect(r.component.summary).toBe("1.0 of 2 years asked for.");
    expect(r.gaps[0]).toMatchObject({ kind: "experience", severity: "medium" });
    expect(r.gaps[0]!.suggestion).toMatch(/may still screen/);
  });

  it("is a full score when no minimum is asked for, and infers one from the level otherwise", async () => {
    const c = await candidateFrom({});
    expect(experienceComponent(makeJob({ min_years: 0 }), c).component.score).toBe(100);
    expect(experienceRequirement({ min_years: null, seniority: "senior" })).toEqual({
      years: 5,
      source: "from level",
    });
    expect(
      experienceComponent(makeJob({ min_years: null, seniority: null }), c).component.applicable,
    ).toBe(false);
  });
});

describe("keywords component", () => {
  it("looks for the job's skills anywhere in verified text, including prose and certificates", async () => {
    const c = await candidateFrom({
      skills: [["Python", "advanced"]],
      experiences: [
        {
          title: "Dev",
          organization: "A",
          start: "2025-01",
          end: "2025-06",
          highlights: ["Containerized services with Docker"],
        },
      ],
    });
    const r = keywordsComponent(makeJob({ required_skills: ["Python", "Docker", "Redis"] }), c);
    expect(r.covered).toEqual(["Python", "Docker"]);
    expect(r.missing).toEqual(["Redis"]);
    expect(r.component.score).toBe(67);
  });

  it("is not applicable without keywords", async () => {
    expect(keywordsComponent(makeJob(), await candidateFrom({})).component.applicable).toBe(false);
  });
});

describe("education component", () => {
  it("reads the degree level a posting asks for", () => {
    expect(
      educationRequirement(makeJob({ requirements: ["Bachelor's degree in computer science"] })),
    ).toMatchObject({ level: 2 });
    expect(
      educationRequirement(makeJob({ requirements: ["Master's degree preferred"] })),
    ).toMatchObject({ level: 3 });
    expect(
      educationRequirement(makeJob({ requirements: ["B.Tech or equivalent experience"] })),
    ).toMatchObject({ level: 2, flexible: true });
    expect(
      educationRequirement(makeJob({ requirements: ["Currently pursuing a degree"] })),
    ).toMatchObject({ level: 2, allowsOngoing: true });
    expect(
      educationRequirement(makeJob({ requirements: ["Recent graduate welcome", "Strong Python"] })),
    ).toBeNull();
    expect(educationRequirement(makeJob({ requirements: [] }))).toBeNull();
  });

  it("maps degree text to levels", () => {
    expect(degreeLevel("Master of Computer Applications")).toBe(3);
    expect(degreeLevel("MCA")).toBe(3);
    expect(degreeLevel("B.Tech in Computer Science")).toBe(2);
    expect(degreeLevel("Bachelor of Science")).toBe(2);
    expect(degreeLevel("Ph.D")).toBe(4);
    expect(degreeLevel("Diploma in Electronics")).toBe(1);
    expect(degreeLevel("Higher Secondary")).toBe(0);
  });

  const asks = (text: string) => makeJob({ requirements: [text] });

  it("is not applicable when the job asks for no degree", async () => {
    expect(educationComponent(makeJob(), await candidateFrom({})).component.applicable).toBe(false);
  });

  it("gives full credit for a completed degree at or above the level", async () => {
    const c = await candidateFrom({
      education: [{ degree: "Master of Computer Applications", start: "2022-08", end: "2024-06" }],
    });
    expect(
      educationComponent(asks("Bachelor's degree in a related field"), c).component.score,
    ).toBe(100);
  });

  it("gives slightly less for a degree still in progress, unless the posting welcomes students", async () => {
    const c = await candidateFrom({
      education: [{ degree: "Bachelor of Technology", start: "2023-08", current: true }],
    });
    expect(educationComponent(asks("Bachelor's degree"), c).component.score).toBe(80);
    expect(
      educationComponent(asks("Currently pursuing a bachelor's degree"), c).component.score,
    ).toBe(100);
  });

  it("scores a level short lower, and softer when equivalent experience is allowed", async () => {
    const c = await candidateFrom({
      education: [{ degree: "Bachelor of Technology", start: "2018-08", end: "2022-05" }],
    });
    expect(educationComponent(asks("Master's degree"), c).component.score).toBe(40);
    expect(
      educationComponent(asks("Master's degree or equivalent experience"), c).component.score,
    ).toBe(70);
  });

  it("scores 0 with a clear gap when there is no verified education", async () => {
    const r = educationComponent(asks("Bachelor's degree"), await candidateFrom({}));
    expect(r.component.score).toBe(0);
    expect(r.gaps[0]).toMatchObject({ kind: "education", severity: "high" });
    expect(r.gaps[0]!.text).toContain("not found in your verified education");
  });
});

describe("location component", () => {
  const prefs = {
    work_modes: ["hybrid"],
    preferred_locations: ["Pune", "Bengaluru"],
    open_to_relocate: false,
  };

  it("is not applicable without saved preferences or without anything to compare", async () => {
    expect(
      locationComponent(makeJob(), await candidateFrom({ profile: null })).component.applicable,
    ).toBe(false);
    expect(locationComponent(makeJob(), await candidateFrom({})).component.applicable).toBe(false);
    expect(
      locationComponent(
        makeJob({ location: null, work_mode: null }),
        await candidateFrom({ profile: prefs }),
      ).component.applicable,
    ).toBe(false);
  });

  it("fits a remote job when remote is acceptable, and is lower when it was not listed", async () => {
    const remote = makeJob({ work_mode: "remote", location: "Remote (India)" });
    expect(
      locationComponent(
        remote,
        await candidateFrom({ profile: { ...prefs, work_modes: ["remote", "hybrid"] } }),
      ).component.score,
    ).toBe(100);
    expect(locationComponent(remote, await candidateFrom({ profile: prefs })).component.score).toBe(
      40,
    );
  });

  it("matches a preferred city, treating spelling variants as the same place", async () => {
    const c = await candidateFrom({ profile: prefs });
    expect(locationComponent(makeJob({ location: "Pune, India" }), c).component.score).toBe(100);
    expect(locationComponent(makeJob({ location: "Bangalore" }), c).component.score).toBe(100);
  });

  it("scores a different city low, higher if open to relocating, and says why", async () => {
    const job = makeJob({ location: "Mumbai, India" });
    const stay = locationComponent(job, await candidateFrom({ profile: prefs }));
    expect(stay.component.score).toBe(25);
    expect(stay.gaps[0]!.text).toContain("you have not said you would relocate");
    const move = locationComponent(
      job,
      await candidateFrom({ profile: { ...prefs, open_to_relocate: true } }),
    );
    expect(move.component.score).toBe(70);
    expect(move.gaps).toEqual([]);
  });

  it("flags a work mode outside the saved preferences", async () => {
    const r = locationComponent(
      makeJob({ work_mode: "onsite", location: "Pune" }),
      await candidateFrom({ profile: prefs }),
    );
    expect(r.component.score).toBe(65);
    expect(r.gaps.some((g) => g.text.includes("onsite role"))).toBe(true);
  });
});

describe("seniority component", () => {
  const withLevel = (level: string) =>
    candidateFrom({ profile: { experience_level: level }, skills: [["Python", "advanced"]] });
  const at = (level: string) => makeJob({ seniority: level as never });

  it.each([
    ["junior", "junior", 100],
    ["entry", "junior", 90], // one level below the candidate
    ["junior", "entry", 60], // one level above
    ["mid", "entry", 30], // two above
    ["senior", "entry", 10], // three above
    ["junior", "senior", 60], // two below
    ["lead", "junior", 10],
  ] as const)("a %s job for an %s candidate scores %i", async (jobLevel, candLevel, expected) => {
    expect(seniorityComponent(at(jobLevel), await withLevel(candLevel)).component.score).toBe(
      expected,
    );
  });

  it("is not applicable when either side is unknown", async () => {
    expect(
      seniorityComponent(makeJob({ seniority: null }), await withLevel("junior")).component
        .applicable,
    ).toBe(false);
    expect(
      seniorityComponent(at("junior"), await candidateFrom({ profile: null })).component.applicable,
    ).toBe(false);
  });

  it("estimates a level from experience when the profile does not state one", async () => {
    const c = await candidateFrom({
      profile: { experience_level: null },
      experiences: [{ title: "Dev", organization: "A", start: "2024-01", end: "2025-12" }],
    });
    expect(c.level).toEqual({ value: "junior", source: "derived" });
    expect(seniorityComponent(at("junior"), c).component.inputs[1]!.value).toContain(
      "estimated from your experience",
    );
  });

  it("notes a role well below the candidate's level as a concern, not a gap", async () => {
    const r = seniorityComponent(at("entry"), await withLevel("senior"));
    expect(r.gaps).toEqual([]);
    expect(r.concerns[0]).toMatch(/may be below your current level/);
  });
});

describe("the candidate view", () => {
  it("reads only confirmed items", async () => {
    const c = await candidateFrom({
      skills: [
        ["Python", "advanced"],
        ["Rust", "advanced", false],
      ],
    });
    expect([...c.skills.keys()]).toEqual(["python"]);
    expect(c.pendingSkillKeys.has("rust")).toBe(true);
    expect(c.hasVerifiedData).toBe(true);
  });

  it("has no verified data for an empty or fully unconfirmed profile", async () => {
    expect((await candidateFrom({})).hasVerifiedData).toBe(false);
    expect((await candidateFrom({ skills: [["Python", "advanced", false]] })).hasVerifiedData).toBe(
      false,
    );
  });

  it("has a hash that changes when scoring inputs change and not otherwise", async () => {
    const a = await candidateFrom({ skills: [["Python", "advanced"]] });
    const same = await candidateFrom({ skills: [["Python", "advanced"]] });
    const levelChanged = await candidateFrom({ skills: [["Python", "expert"]] });
    const skillAdded = await candidateFrom({
      skills: [
        ["Python", "advanced"],
        ["Go", "advanced"],
      ],
    });
    expect(a.hash).toBe(same.hash);
    expect(new Set([a.hash, levelChanged.hash, skillAdded.hash]).size).toBe(3);
  });

  it("changes the hash month to month while a role is ongoing", async () => {
    const spec = {
      experiences: [{ title: "Dev", organization: "A", start: "2026-01", current: true }],
    };
    const september = await candidateFrom(spec, new Date("2026-09-15T00:00:00Z"));
    const october = await candidateFrom(spec, NOW);
    expect(september.hash).not.toBe(october.hash);
  });
});
