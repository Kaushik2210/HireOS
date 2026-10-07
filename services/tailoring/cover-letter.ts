import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import { normalizeKey, normalizeSkill } from "@/lib/skills/catalog";
import { scanCatalogSkills } from "@/lib/skills/scan";
import { TAILOR_VERSION, type Claim, type LetterDoc, type SourceRef } from "@/lib/tailoring/types";
import { verifiedSnapshot } from "@/services/profile/verified";

export type LetterResult =
  | { ok: true; doc: LetterDoc; skillsUsed: string[] }
  | { ok: false; reason: "no_profile" | "nothing_verified" };

const keyOf = (name: string) => normalizeKey(normalizeSkill(name).name);

const keysIn = (text: string, tags: readonly string[] = []) => {
  const keys = new Set<string>(tags.map(keyOf));
  for (const found of scanCatalogSkills(text)) keys.add(normalizeKey(found.name));
  return keys;
};

const sentence = (id: string, text: string, refs: SourceRef[]): Claim => ({
  id,
  kind: "sentence",
  text,
  refs,
});

/** Ends a quoted highlight as a sentence without changing its words. */
const finish = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * A short cover letter built from sentences with fixed wording around verbatim pieces of
 * the verified profile. It never mentions a skill the person lacks, and never claims
 * enthusiasm, years or results that the profile does not contain.
 */
export function buildCoverLetter(snapshot: ProfileSnapshot, job: Job): LetterResult {
  const v = verifiedSnapshot(snapshot);
  if (!v.profile) return { ok: false, reason: "no_profile" };
  if (v.skills.length + v.projects.length + v.experiences.length === 0) {
    return { ok: false, reason: "nothing_verified" };
  }

  const wanted = new Map<string, number>();
  for (const s of job.required_skills) wanted.set(keyOf(s), 1);
  for (const s of job.preferred_skills) if (!wanted.has(keyOf(s))) wanted.set(keyOf(s), 0.5);
  const score = (keys: Set<string>) => [...keys].reduce((t, k) => t + (wanted.get(k) ?? 0), 0);

  const jobRef = (fields: string[]): SourceRef => ({ entity: "jobs", id: job.id, fields });
  const paragraphs: Claim[][] = [];

  paragraphs.push([sentence("greeting", "Dear Hiring Team,", [jobRef(["company_name"])])]);
  paragraphs.push([
    sentence("opening", `I am writing to apply for the ${job.title} role at ${job.company_name}.`, [
      jobRef(["title", "company_name"]),
    ]),
  ]);

  /* ---------- evidence: one project and one role, each with its most relevant line ---------- */
  const evidence: Claim[] = [];

  const bestLine = (highlights: string[], fallback: string | null) => {
    const options = highlights.map((text, i) => ({
      text,
      field: `highlights.${i}`,
      s: score(keysIn(text)),
    }));
    if (options.length === 0 && fallback) return { text: fallback, field: "description", s: 0 };
    return options.sort((a, b) => b.s - a.s)[0] ?? null;
  };

  const projects = v.projects
    .map((p) => ({
      p,
      s: score(keysIn([p.name, p.description ?? "", ...p.highlights].join("\n"), p.tech)),
    }))
    .sort((a, b) => b.s - a.s);
  const project = projects[0];
  if (project) {
    const line = bestLine(project.p.highlights, project.p.description);
    if (line) {
      evidence.push(
        sentence(
          `project:${project.p.id}`,
          `One example is my project ${project.p.name}: ${finish(line.text)}`,
          [{ entity: "projects", id: project.p.id, fields: ["name", line.field] }],
        ),
      );
    }
  }

  const roles = v.experiences
    .map((e) => ({ e, s: score(keysIn(e.highlights.join("\n"), e.skills)) }))
    .sort((a, b) => b.s - a.s);
  const role = roles[0];
  if (role) {
    const line = bestLine(role.e.highlights, null);
    if (line) {
      evidence.push(
        sentence(
          `role:${role.e.id}`,
          `As ${role.e.title} at ${role.e.organization}: ${finish(line.text)}`,
          [{ entity: "experiences", id: role.e.id, fields: ["title", "organization", line.field] }],
        ),
      );
    }
  }
  if (evidence.length > 0) paragraphs.push(evidence);

  /* ---------- skills the posting asks for that the person has ---------- */
  const owned = v.skills
    .map((s) => ({ s, w: wanted.get(keyOf(s.name)) ?? 0 }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w || a.s.name.localeCompare(b.s.name))
    .slice(0, 6);
  if (owned.length > 0) {
    paragraphs.push([
      sentence(
        "skills",
        `The skills in your posting that I have worked with include ${joinList(owned.map((x) => x.s.name))}.`,
        owned.map((x) => ({ entity: "skills" as const, id: x.s.id, fields: ["name"] })),
      ),
    ]);
  }

  paragraphs.push([
    sentence("closing", "Thank you for your time and consideration.", [jobRef(["company_name"])]),
  ]);
  paragraphs.push([
    sentence("signoff", `Sincerely,\n${v.profile.full_name}`, [
      { entity: "profiles", id: v.profile.id, fields: ["full_name"] },
    ]),
  ]);

  const text = paragraphs.map((p) => p.map((c) => c.text).join(" ")).join("\n\n");
  return {
    ok: true,
    doc: { tailor_version: TAILOR_VERSION, paragraphs, text, edited: false },
    skillsUsed: owned.map((x) => x.s.name),
  };
}
