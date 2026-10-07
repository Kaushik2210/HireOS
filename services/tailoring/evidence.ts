import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import { normalizeKey, normalizeSkill } from "@/lib/skills/catalog";
import { scanCatalogSkills } from "@/lib/skills/scan";
import type { Claim, SourceRef } from "@/lib/tailoring/types";

/** Sentence builders shared by the cover letter and outreach drafts. */

const keyOf = (name: string) => normalizeKey(normalizeSkill(name).name);

const keysIn = (text: string, tags: readonly string[] = []) => {
  const keys = new Set<string>(tags.map(keyOf));
  for (const found of scanCatalogSkills(text)) keys.add(normalizeKey(found.name));
  return keys;
};

export const sentence = (id: string, text: string, refs: SourceRef[]): Claim => ({
  id,
  kind: "sentence",
  text,
  refs,
});

/** Ends a quoted highlight as a sentence without changing its words. */
export const finish = (text: string) =>
  /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const jobRef = (job: Job, fields: string[]): SourceRef => ({
  entity: "jobs",
  id: job.id,
  fields,
});

export interface Evidence {
  /** One sentence quoting the most relevant project line, or null. */
  project: Claim | null;
  /** One sentence quoting the most relevant role line, or null. */
  role: Claim | null;
  /** Skills the posting asks for that the person has, best first. */
  owned: { id: string; name: string }[];
  /** The sentence listing those skills, or null when none match. */
  skills: Claim | null;
}

/**
 * Picks the verified project, role and skills that best match a posting. Every sentence is
 * fixed wording around verbatim profile text, with refs to the items it came from.
 * `snapshot` must already be the verified snapshot.
 */
export function pickEvidence(v: ProfileSnapshot, job: Job, skillLead: string): Evidence {
  const wanted = new Map<string, number>();
  for (const s of job.required_skills) wanted.set(keyOf(s), 1);
  for (const s of job.preferred_skills) if (!wanted.has(keyOf(s))) wanted.set(keyOf(s), 0.5);
  const score = (keys: Set<string>) => [...keys].reduce((t, k) => t + (wanted.get(k) ?? 0), 0);

  const bestLine = (highlights: string[], fallback: string | null) => {
    const options = highlights.map((text, i) => ({
      text,
      field: `highlights.${i}`,
      s: score(keysIn(text)),
    }));
    if (options.length === 0 && fallback) return { text: fallback, field: "description", s: 0 };
    return options.sort((a, b) => b.s - a.s)[0] ?? null;
  };

  let project: Claim | null = null;
  const best = v.projects
    .map((p) => ({
      p,
      s: score(keysIn([p.name, p.description ?? "", ...p.highlights].join("\n"), p.tech)),
    }))
    .sort((a, b) => b.s - a.s)[0];
  if (best) {
    const line = bestLine(best.p.highlights, best.p.description);
    if (line) {
      project = sentence(
        `project:${best.p.id}`,
        `One example is my project ${best.p.name}: ${finish(line.text)}`,
        [{ entity: "projects", id: best.p.id, fields: ["name", line.field] }],
      );
    }
  }

  let role: Claim | null = null;
  const bestRole = v.experiences
    .map((e) => ({ e, s: score(keysIn(e.highlights.join("\n"), e.skills)) }))
    .sort((a, b) => b.s - a.s)[0];
  if (bestRole) {
    const line = bestLine(bestRole.e.highlights, null);
    if (line) {
      role = sentence(
        `role:${bestRole.e.id}`,
        `As ${bestRole.e.title} at ${bestRole.e.organization}: ${finish(line.text)}`,
        [
          {
            entity: "experiences",
            id: bestRole.e.id,
            fields: ["title", "organization", line.field],
          },
        ],
      );
    }
  }

  const owned = v.skills
    .map((s) => ({ s, w: wanted.get(keyOf(s.name)) ?? 0 }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w || a.s.name.localeCompare(b.s.name))
    .slice(0, 6);
  const skills =
    owned.length > 0
      ? sentence(
          "skills",
          `${skillLead} ${joinList(owned.map((x) => x.s.name))}.`,
          owned.map((x) => ({ entity: "skills" as const, id: x.s.id, fields: ["name"] })),
        )
      : null;

  return { project, role, owned: owned.map((x) => ({ id: x.s.id, name: x.s.name })), skills };
}
