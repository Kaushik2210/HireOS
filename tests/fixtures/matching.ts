import { MemoryProfileStore } from "@/db/profile/memory-store";
import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import {
  careerGoalSchema,
  educationSchema,
  experienceSchema,
  profileSchema,
  projectSchema,
  skillSchema,
} from "@/lib/profile/schemas";
import { buildCandidate, type Candidate } from "@/services/matching/candidate";

export const NOW = new Date("2026-10-06T00:00:00Z");

type SkillSpec = [
  name: string,
  level: "beginner" | "intermediate" | "advanced" | "expert",
  confirmed?: boolean,
];

export interface CandidateSpec {
  skills?: SkillSpec[];
  projects?: {
    name: string;
    tech?: string[];
    highlights?: string[];
    description?: string;
    confirmed?: boolean;
  }[];
  experiences?: {
    title: string;
    organization: string;
    kind?: "work" | "internship" | "leadership" | "volunteer";
    start: string;
    end?: string;
    current?: boolean;
    skills?: string[];
    highlights?: string[];
    confirmed?: boolean;
  }[];
  education?: {
    degree: string;
    institution?: string;
    start?: string;
    end?: string;
    current?: boolean;
    field?: string;
  }[];
  profile?: Record<string, unknown> | null;
  goals?: Record<string, unknown>;
}

/** Builds a snapshot through the real store so items get real ids and confirmed flags. */
export async function snapshotFrom(spec: CandidateSpec): Promise<ProfileSnapshot> {
  const store = new MemoryProfileStore(null);
  const u = "candidate";
  for (const [name, level, confirmed = true] of spec.skills ?? []) {
    await store.createItem(u, "skills", skillSchema.parse({ name, type: "tool", level }), {
      source: confirmed ? "manual" : "resume",
      confirmed,
    });
  }
  for (const p of spec.projects ?? []) {
    await store.createItem(
      u,
      "projects",
      projectSchema.parse({
        name: p.name,
        tech: p.tech ?? [],
        highlights: p.highlights ?? [],
        description: p.description,
      }),
      { confirmed: p.confirmed ?? true, source: p.confirmed === false ? "resume" : "manual" },
    );
  }
  for (const e of spec.experiences ?? []) {
    await store.createItem(
      u,
      "experiences",
      experienceSchema.parse({
        kind: e.kind ?? "work",
        title: e.title,
        organization: e.organization,
        start_date: e.start,
        end_date: e.end,
        is_current: e.current ?? false,
        skills: e.skills ?? [],
        highlights: e.highlights ?? [],
      }),
      { confirmed: e.confirmed ?? true, source: e.confirmed === false ? "resume" : "manual" },
    );
  }
  for (const d of spec.education ?? []) {
    await store.createItem(
      u,
      "education",
      educationSchema.parse({
        institution: d.institution ?? "Test University",
        degree: d.degree,
        field_of_study: d.field,
        start_date: d.start,
        end_date: d.end,
        is_current: d.current ?? false,
      }),
    );
  }
  if (spec.profile !== null) {
    await store.saveSingleton(
      u,
      "profiles",
      profileSchema.parse({ full_name: "Test Candidate", ...(spec.profile ?? {}) }),
    );
  }
  if (spec.goals) await store.saveSingleton(u, "career_goals", careerGoalSchema.parse(spec.goals));
  return store.getSnapshot(u);
}

export async function candidateFrom(spec: CandidateSpec, now: Date = NOW): Promise<Candidate> {
  return buildCandidate(await snapshotFrom(spec), now);
}

export function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    owner_user_id: null,
    source_key: "demo",
    fingerprint: "a".repeat(64),
    is_demo: false,
    also_listed_on: [],
    discovered_at: "2026-10-01T00:00:00Z",
    company_name: "Acme",
    title: "Backend Engineer",
    location: "Pune, India",
    work_mode: "hybrid",
    job_type: "full_time",
    seniority: "junior",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: "A backend role.",
    requirements: [],
    responsibilities: [],
    required_skills: [],
    preferred_skills: [],
    min_years: null,
    apply_url: null,
    posted_at: null,
    external_id: null,
    ...over,
  };
}
