import { createHash } from "node:crypto";
import type { ProfileSnapshot } from "@/db/profile/store";
import { locationKey } from "@/lib/jobs/keys";
import type { SkillLevel } from "@/lib/profile/constants";
import type { EXPERIENCE_LEVELS } from "@/lib/profile/constants";
import { normalizeKey, normalizeSkill } from "@/lib/skills/catalog";
import { scanCatalogSkills } from "@/lib/skills/scan";
import { verifiedSnapshot } from "@/services/profile/verified";

type Level = (typeof EXPERIENCE_LEVELS)[number];

export const LEVEL_ORDER: Record<Level, number> = {
  student: 0,
  entry: 1,
  junior: 2,
  mid: 3,
  senior: 4,
  lead: 5,
};

export interface Ref {
  entity: string;
  id: string;
  /** Short human label, such as a project name. */
  label: string;
}

export interface CandidateSkill {
  name: string;
  key: string;
  /** From the skills list. Null when the skill is only evidenced by a project or role. */
  level: SkillLevel | null;
  /** The skills row, when there is one. */
  ref: Ref | null;
  /** Verified projects and roles that name this skill. */
  usedIn: Ref[];
}

export interface CandidateProject {
  ref: Ref;
  skillKeys: Set<string>;
  skillNames: string[];
}

export interface CandidateRole {
  ref: Ref;
  kind: string;
  months: number;
}

export interface CandidateDegree {
  ref: Ref;
  /** 0 none/school, 1 diploma, 2 bachelor, 3 master, 4 doctorate */
  level: number;
  ongoing: boolean;
  text: string;
}

export interface Candidate {
  /** True when at least one verified item exists that scoring can use. */
  hasVerifiedData: boolean;
  skills: Map<string, CandidateSkill>;
  projects: CandidateProject[];
  roles: CandidateRole[];
  degrees: CandidateDegree[];
  /** Every skill mentioned anywhere in verified text, not only in the skills list. */
  mentionedKeys: Set<string>;
  /** Whole months of professional experience (jobs and internships), overlaps merged. */
  experienceMonths: number;
  level: { value: Level; source: "profile" | "derived" } | null;
  prefs: {
    workModes: string[];
    locations: string[];
    locationKeys: string[];
    relocate: boolean;
    salaryMin: number | null;
    salaryMax: number | null;
    currency: string;
    period: string;
  } | null;
  targetRoles: string[];
  /** Skills present only in unconfirmed (resume-proposed) items. They do not count yet. */
  pendingSkillKeys: Set<string>;
  /** Changes whenever anything scoring depends on changes. */
  hash: string;
}

const monthIndex = (value: string) =>
  Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
const nowIndex = (now: Date) => now.getUTCFullYear() * 12 + now.getUTCMonth();

export function degreeLevel(text: string): number {
  const t = text.toLowerCase();
  if (/ph\.?\s?d|doctor/.test(t)) return 4;
  if (
    /master|\bm\.?\s?tech\b|\bm\.?\s?sc\b|\bm\.?\s?c\.?\s?a\b|\bmba\b|\bm\.?\s?e\b|\bm\.?\s?com\b/.test(
      t,
    )
  )
    return 3;
  if (
    /bachelor|\bb\.?\s?tech\b|\bb\.?\s?sc\b|\bb\.?\s?c\.?\s?a\b|\bb\.?\s?e\b|\bbba\b|\bb\.?\s?com\b|\bb\.?\s?a\b/.test(
      t,
    )
  )
    return 2;
  if (/diploma|associate/.test(t)) return 1;
  return 0;
}

function derivedLevel(months: number, studying: boolean): Level {
  const years = months / 12;
  if (months === 0) return studying ? "student" : "entry";
  if (years < 1) return "entry";
  if (years < 2.5) return "junior";
  if (years < 5) return "mid";
  return "senior";
}

/** Union of month ranges, so two overlapping roles are not counted twice. */
function mergedMonths(ranges: [number, number][]): number {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -2;
  for (const [s, e] of sorted) {
    if (s > curEnd + 1) {
      if (curStart >= 0) total += curEnd - curStart + 1;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curStart >= 0) total += curEnd - curStart + 1;
  return total;
}

const canonical = (name: string) => normalizeSkill(name).name;
const keyOf = (name: string) => normalizeKey(canonical(name));

/**
 * Reduces a profile to what scoring needs. Only confirmed items are read: anything still
 * awaiting the user's confirmation is left out (its skills are noted separately), because
 * unconfirmed data must never support a claim.
 */
export function buildCandidate(snapshot: ProfileSnapshot, now: Date = new Date()): Candidate {
  const v = verifiedSnapshot(snapshot);
  const today = nowIndex(now);

  const skills = new Map<string, CandidateSkill>();
  const touch = (name: string, ref: Ref | null, used: Ref | null, level: SkillLevel | null) => {
    const display = canonical(name);
    const key = normalizeKey(display);
    const existing = skills.get(key) ?? { name: display, key, level: null, ref: null, usedIn: [] };
    if (ref) {
      existing.ref = ref;
      existing.level = level;
    }
    if (used && !existing.usedIn.some((u) => u.id === used.id)) existing.usedIn.push(used);
    skills.set(key, existing);
  };

  for (const s of v.skills)
    touch(s.name, { entity: "skills", id: s.id, label: s.name }, null, s.level);

  const mentioned = new Set<string>(v.skills.map((s) => keyOf(s.name)));
  const corpus: string[] = [v.profile?.headline ?? "", v.profile?.summary ?? ""];

  const projects: CandidateProject[] = v.projects.map((p) => {
    const ref: Ref = { entity: "projects", id: p.id, label: p.name };
    const text = [p.name, p.description ?? "", ...p.highlights, ...p.tech].join("\n");
    corpus.push(text);
    const names = new Set<string>(p.tech.map(canonical));
    for (const found of scanCatalogSkills(text)) names.add(found.name);
    for (const n of names) {
      touch(n, null, ref, null);
      mentioned.add(normalizeKey(n));
    }
    return { ref, skillKeys: new Set([...names].map(normalizeKey)), skillNames: [...names] };
  });

  const roleRanges: [number, number][] = [];
  const roles = v.experiences.map((e) => {
    const ref: Ref = { entity: "experiences", id: e.id, label: `${e.title}, ${e.organization}` };
    const text = [e.title, e.organization, ...e.highlights, ...e.skills].join("\n");
    corpus.push(text);
    const names = new Set<string>(e.skills.map(canonical));
    for (const found of scanCatalogSkills(text)) names.add(found.name);
    for (const n of names) {
      touch(n, null, ref, null);
      mentioned.add(normalizeKey(n));
    }

    let months = 0;
    if (e.start_date) {
      const start = monthIndex(e.start_date);
      const end = e.is_current || !e.end_date ? today : monthIndex(e.end_date);
      months = Math.max(0, end - start + 1);
      // Only paid or internship work counts toward professional experience.
      if ((e.kind === "work" || e.kind === "internship") && end >= start)
        roleRanges.push([start, end]);
    }
    return { ref, kind: e.kind, months };
  });

  const degrees: CandidateDegree[] = v.education.map((e) => {
    const text = `${e.degree} ${e.field_of_study ?? ""}`.trim();
    corpus.push([e.degree, e.field_of_study ?? "", e.institution, ...e.highlights].join("\n"));
    return {
      ref: { entity: "education", id: e.id, label: `${e.degree}, ${e.institution}` },
      level: degreeLevel(text),
      ongoing: e.is_current || (e.end_date !== null && monthIndex(e.end_date) > today),
      text,
    };
  });

  for (const c of v.certifications) corpus.push(`${c.name} ${c.issuer ?? ""}`);
  for (const a of v.achievements) corpus.push(`${a.title} ${a.description ?? ""}`);
  for (const found of scanCatalogSkills(corpus.join("\n"))) mentioned.add(normalizeKey(found.name));

  const pendingSkillKeys = new Set(
    snapshot.skills.filter((s) => !s.confirmed).map((s) => keyOf(s.name)),
  );
  for (const key of skills.keys()) pendingSkillKeys.delete(key);

  const experienceMonths = mergedMonths(roleRanges);
  const profile = v.profile;
  const level: Candidate["level"] = profile?.experience_level
    ? { value: profile.experience_level, source: "profile" }
    : v.experiences.length > 0 || v.education.length > 0
      ? {
          value: derivedLevel(
            experienceMonths,
            degrees.some((d) => d.ongoing),
          ),
          source: "derived",
        }
      : null;

  const prefs: Candidate["prefs"] = profile
    ? {
        workModes: profile.work_modes,
        locations: profile.preferred_locations,
        locationKeys: profile.preferred_locations.map((l) => locationKey(l)).filter(Boolean),
        relocate: profile.open_to_relocate,
        salaryMin: profile.expected_salary_min,
        salaryMax: profile.expected_salary_max,
        currency: profile.salary_currency,
        period: profile.salary_period,
      }
    : null;

  const hasVerifiedData =
    v.skills.length > 0 ||
    v.projects.length > 0 ||
    v.experiences.length > 0 ||
    v.education.length > 0;

  const candidate: Candidate = {
    hasVerifiedData,
    skills,
    projects,
    roles,
    degrees,
    mentionedKeys: mentioned,
    experienceMonths,
    level,
    prefs,
    targetRoles: v.goals?.target_roles ?? [],
    pendingSkillKeys,
    hash: "",
  };
  candidate.hash = hashCandidate(
    candidate,
    roleRanges.length > 0 && v.experiences.some((e) => e.is_current) ? today : null,
  );
  return candidate;
}

/** Order-independent fingerprint of everything scoring reads. */
function hashCandidate(c: Candidate, currentMonth: number | null): string {
  const sorted = (items: string[]) => [...items].sort();
  const payload = {
    skills: sorted(
      [...c.skills.values()].map((s) => `${s.key}:${s.level ?? "-"}:${s.usedIn.length}`),
    ),
    projects: sorted(c.projects.map((p) => `${p.ref.id}:${sorted([...p.skillKeys]).join(",")}`)),
    roles: sorted(c.roles.map((r) => `${r.ref.id}:${r.kind}:${r.months}`)),
    degrees: sorted(c.degrees.map((d) => `${d.ref.id}:${d.level}:${d.ongoing}`)),
    mentioned: sorted([...c.mentionedKeys]),
    months: c.experienceMonths,
    level: c.level?.value ?? null,
    prefs: c.prefs,
    targets: c.targetRoles,
    pending: sorted([...c.pendingSkillKeys]),
    // A current role grows each month, so the hash must too.
    month: currentMonth,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
