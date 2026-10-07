import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import type { CollectionItem } from "@/lib/profile/schemas";
import { SKILL_LEVELS } from "@/lib/profile/constants";
import { normalizeKey, normalizeSkill } from "@/lib/skills/catalog";
import { scanCatalogSkills } from "@/lib/skills/scan";
import {
  LIMITS,
  TAILOR_VERSION,
  type Change,
  type Claim,
  type Entry,
  type MissingRequirement,
  type ResumeDoc,
  type SourceRef,
} from "@/lib/tailoring/types";
import { verifiedSnapshot } from "@/services/profile/verified";
import { formatDateLine } from "@/services/tailoring/dates";

export interface BuildOptions {
  /** Item ids to leave out, and `itemId#hN` to leave out one bullet. Chosen by the user. */
  exclude?: ReadonlySet<string>;
}

export type BuildResult =
  | { ok: true; doc: ResumeDoc; changes: Change[]; missing: MissingRequirement[] }
  | { ok: false; reason: "no_profile" | "nothing_verified" };

const keyOf = (name: string) => normalizeKey(normalizeSkill(name).name);

/** Skill keys named by a piece of text or a tag list. */
function keysIn(text: string, tags: readonly string[] = []): Set<string> {
  const keys = new Set<string>(tags.map(keyOf));
  for (const found of scanCatalogSkills(text)) keys.add(normalizeKey(found.name));
  return keys;
}

interface JobKeys {
  required: Map<string, string>;
  preferred: Map<string, string>;
}

function jobKeys(job: Job | null): JobKeys {
  const required = new Map<string, string>();
  const preferred = new Map<string, string>();
  if (job) {
    for (const s of job.required_skills) required.set(keyOf(s), normalizeSkill(s).name);
    for (const s of job.preferred_skills) {
      const k = keyOf(s);
      if (!required.has(k)) preferred.set(k, normalizeSkill(s).name);
    }
  }
  return { required, preferred };
}

/** Required skills count fully and preferred ones half, as in scoring. */
function relevance(keys: Set<string>, job: JobKeys): number {
  let total = 0;
  for (const k of keys) {
    if (job.required.has(k)) total += 1;
    else if (job.preferred.has(k)) total += 0.5;
  }
  return total;
}

function matchedNames(keys: Set<string>, job: JobKeys): string[] {
  return [...keys]
    .filter((k) => job.required.has(k) || job.preferred.has(k))
    .map((k) => job.required.get(k) ?? job.preferred.get(k)!)
    .sort((a, b) => a.localeCompare(b));
}

const claim = (
  kind: Claim["kind"],
  entity: SourceRef["entity"],
  id: string,
  fields: string[],
  text: string,
): Claim => ({
  id: `${entity}:${id}:${fields.join("+")}`,
  kind,
  text,
  refs: [{ entity, id, fields }],
});

/** Newest first: ongoing items, then by end date, then by start date. */
function recency(a: { is_current: boolean; end_date: string | null; start_date: string | null }) {
  return `${a.is_current ? "9999-99" : (a.end_date ?? "0000-00")}|${a.start_date ?? "0000-00"}`;
}
const byRecency = <T extends Parameters<typeof recency>[0]>(a: T, b: T) =>
  recency(b).localeCompare(recency(a));

const LEVEL_RANK = Object.fromEntries(SKILL_LEVELS.map((l, i) => [l, i])) as Record<string, number>;

function detailClaim(
  entity: SourceRef["entity"],
  id: string,
  parts: { fields: string[]; text: string }[],
  dateFields: string[],
  dateText: string,
): Claim | null {
  const texts = [dateText, ...parts.map((p) => p.text)].filter(Boolean);
  if (texts.length === 0) return null;
  const fields = [...(dateText ? dateFields : []), ...parts.flatMap((p) => p.fields)];
  return claim("detail", entity, id, fields, texts.join(" · "));
}

export function buildResume(
  snapshot: ProfileSnapshot,
  job: Job | null,
  options: BuildOptions = {},
): BuildResult {
  const v = verifiedSnapshot(snapshot);
  const profile = v.profile;
  if (!profile) return { ok: false, reason: "no_profile" };
  const itemCount =
    v.skills.length +
    v.experiences.length +
    v.projects.length +
    v.education.length +
    v.certifications.length +
    v.achievements.length;
  if (itemCount === 0) return { ok: false, reason: "nothing_verified" };

  const exclude = options.exclude ?? new Set<string>();
  const jk = jobKeys(job);
  const tailoring = job !== null;
  const changes: Change[] = [];
  const caps = tailoring
    ? LIMITS
    : {
        skills: Infinity,
        bulletsPerEntry: Infinity,
        projects: Infinity,
        certifications: Infinity,
        achievements: Infinity,
      };

  /* ---------- header and summary ---------- */
  const header: ResumeDoc["header"] = {
    name: claim("heading", "profiles", profile.id, ["full_name"], profile.full_name),
    headline: profile.headline
      ? claim("headline", "profiles", profile.id, ["headline"], profile.headline)
      : null,
    details: [
      ["location", profile.location],
      ["linkedin_url", profile.linkedin_url],
      ["github_url", profile.github_url],
      ["website_url", profile.website_url],
    ].flatMap(([field, value]) =>
      value ? [claim("detail", "profiles", profile.id, [field!], value)] : [],
    ),
  };
  const summary = profile.summary
    ? claim("summary", "profiles", profile.id, ["summary"], profile.summary)
    : null;

  /* ---------- skills ---------- */
  const baseSkills = [...v.skills]
    .filter((s) => !exclude.has(s.id))
    .sort(
      (a, b) =>
        (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0) || a.name.localeCompare(b.name),
    );
  const tier = (name: string) =>
    jk.required.has(keyOf(name)) ? 0 : jk.preferred.has(keyOf(name)) ? 1 : 2;
  const orderedSkills = tailoring
    ? [...baseSkills].sort((a, b) => tier(a.name) - tier(b.name))
    : baseSkills;
  const shownSkills = orderedSkills.slice(0, caps.skills);
  if (tailoring) {
    orderedSkills.forEach((s, i) => {
      const t = tier(s.name);
      const before = baseSkills.indexOf(s);
      if (t < 2 && i < before) {
        changes.push({
          kind: "skill_first",
          section: "Skills",
          subject: s.name,
          reason: `Moved toward the front: this job ${t === 0 ? "requires" : "lists"} ${s.name}${t === 1 ? " as a nice-to-have" : ""}.`,
          ref: { entity: "skills", id: s.id },
        });
      }
    });
    for (const s of orderedSkills.slice(caps.skills)) {
      changes.push({
        kind: "skill_later",
        section: "Skills",
        subject: s.name,
        reason: `Not shown: the resume lists at most ${LIMITS.skills} skills, and this job does not ask for ${s.name}.`,
        ref: { entity: "skills", id: s.id },
      });
    }
  }
  const skills = shownSkills.map((s) => claim("skill", "skills", s.id, ["name"], s.name));

  /* ---------- helpers for entries ---------- */
  const bulletClaims = (
    entity: SourceRef["entity"],
    item: { id: string; highlights: string[] },
    label: string,
    section: string,
  ): Claim[] => {
    const indexed: { text: string; i: number }[] = [];
    item.highlights.forEach((text, i) => {
      if (!exclude.has(`${item.id}#h${i}`)) {
        indexed.push({ text, i });
        return;
      }
      changes.push({
        kind: "item_excluded",
        section,
        subject: label,
        reason: `You left out bullet ${i + 1}.`,
        ref: { entity, id: item.id },
      });
    });
    let ordered: { text: string; i: number }[] = indexed;
    if (tailoring) {
      const scored = indexed.map((b) => ({
        ...b,
        score: relevance(keysIn(b.text), jk),
      }));
      const ranked = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
      const moved = ranked.some((b, pos) => b.i !== indexed[pos]!.i);
      const kept = ranked.slice(0, caps.bulletsPerEntry);
      const dropped = ranked.slice(caps.bulletsPerEntry);
      if (moved && kept.some((b) => b.score > 0)) {
        changes.push({
          kind: "bullets_reordered",
          section,
          subject: label,
          reason:
            "Bullets that mention this job's skills now come first. The wording is unchanged.",
          ref: { entity, id: item.id },
        });
      }
      for (const b of dropped) {
        changes.push({
          kind: "bullet_left_out",
          section,
          subject: label,
          reason: `Left out "${b.text.length > 70 ? `${b.text.slice(0, 67)}...` : b.text}": it relates less to this job than the ${caps.bulletsPerEntry} kept.`,
          ref: { entity, id: item.id },
        });
      }
      ordered = kept;
    }
    return ordered.map(({ text, i }) =>
      claim("bullet", entity, item.id, [`highlights.${i}`], text),
    );
  };

  const entryRef = (entity: string, id: string) => ({ entity, id });

  /* ---------- experience (all roles stay; order is chronological) ---------- */
  const experience: Entry[] = [...v.experiences]
    .sort(byRecency)
    .filter((e) => {
      if (!exclude.has(e.id)) return true;
      changes.push({
        kind: "item_excluded",
        section: "Experience",
        subject: `${e.title}, ${e.organization}`,
        reason: "You left this out.",
        ref: entryRef("experiences", e.id),
      });
      return false;
    })
    .map((e) => {
      const label = `${e.title}, ${e.organization}`;
      return {
        ref: entryRef("experiences", e.id),
        heading: claim("heading", "experiences", e.id, ["title", "organization"], label),
        detail: detailClaim(
          "experiences",
          e.id,
          e.location ? [{ fields: ["location"], text: e.location }] : [],
          ["start_date", "end_date", "is_current"],
          formatDateLine(e.start_date, e.end_date, e.is_current),
        ),
        bullets: bulletClaims("experiences", e, label, "Experience"),
      };
    });

  /* ---------- projects ---------- */
  const projectKeys = (p: CollectionItem<"projects">) =>
    keysIn([p.name, p.description ?? "", ...p.highlights].join("\n"), p.tech);
  const candidates = [...v.projects].sort(byRecency).filter((p) => {
    if (!exclude.has(p.id)) return true;
    changes.push({
      kind: "item_excluded",
      section: "Projects",
      subject: p.name,
      reason: "You left this out.",
      ref: entryRef("projects", p.id),
    });
    return false;
  });
  let chosenProjects = candidates;
  if (tailoring) {
    const scored = candidates.map((p, idx) => ({
      p,
      idx,
      keys: projectKeys(p),
      score: relevance(projectKeys(p), jk),
    }));
    const relevant = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.idx - b.idx);
    const pick = relevant.length > 0 ? relevant.slice(0, caps.projects) : scored.slice(0, 2);
    const pickedIds = new Set(pick.map((s) => s.p.id));
    for (const s of pick) {
      const names = matchedNames(s.keys, jk);
      changes.push({
        kind: "project_included",
        section: "Projects",
        subject: s.p.name,
        reason:
          names.length > 0
            ? `Included: it uses ${names.join(", ")}, which this job asks for.`
            : "Included as one of your most recent projects: none of your projects uses this job's skills.",
        ref: entryRef("projects", s.p.id),
      });
    }
    for (const s of scored.filter((x) => !pickedIds.has(x.p.id))) {
      changes.push({
        kind: "project_left_out",
        section: "Projects",
        subject: s.p.name,
        reason:
          s.score === 0
            ? "Left out: it uses none of the skills this job asks for. It stays in your profile."
            : `Left out: the resume shows your ${caps.projects} most relevant projects. It stays in your profile.`,
        ref: entryRef("projects", s.p.id),
      });
    }
    chosenProjects = pick.map((s) => s.p);
  }
  const projects: Entry[] = chosenProjects.map((p) => {
    const bullets = bulletClaims("projects", p, p.name, "Projects");
    if (p.description)
      bullets.unshift(claim("bullet", "projects", p.id, ["description"], p.description));
    return {
      ref: entryRef("projects", p.id),
      heading: claim("heading", "projects", p.id, ["name"], p.name),
      detail: detailClaim(
        "projects",
        p.id,
        [
          ...(p.role ? [{ fields: ["role"], text: p.role }] : []),
          ...(p.tech.length > 0 ? [{ fields: ["tech"], text: p.tech.join(", ") }] : []),
        ],
        ["start_date", "end_date", "is_current"],
        formatDateLine(p.start_date, p.end_date, p.is_current),
      ),
      bullets,
    };
  });

  /* ---------- education ---------- */
  const education: Entry[] = [...v.education]
    .sort(byRecency)
    .filter((e) => {
      if (!exclude.has(e.id)) return true;
      changes.push({
        kind: "item_excluded",
        section: "Education",
        subject: `${e.degree}, ${e.institution}`,
        reason: "You left this out.",
        ref: entryRef("education", e.id),
      });
      return false;
    })
    .map((e) => {
      const fields = e.field_of_study
        ? ["degree", "field_of_study", "institution"]
        : ["degree", "institution"];
      const text = e.field_of_study
        ? `${e.degree} in ${e.field_of_study}, ${e.institution}`
        : `${e.degree}, ${e.institution}`;
      return {
        ref: entryRef("education", e.id),
        heading: claim("heading", "education", e.id, fields, text),
        detail: detailClaim(
          "education",
          e.id,
          e.grade ? [{ fields: ["grade"], text: e.grade }] : [],
          ["start_date", "end_date", "is_current"],
          formatDateLine(e.start_date, e.end_date, e.is_current),
        ),
        bullets: bulletClaims("education", e, e.degree, "Education"),
      };
    });

  /* ---------- certifications ---------- */
  const certs = v.certifications.filter((c) => {
    if (!exclude.has(c.id)) return true;
    changes.push({
      kind: "item_excluded",
      section: "Certifications",
      subject: c.name,
      reason: "You left this out.",
      ref: entryRef("certifications", c.id),
    });
    return false;
  });
  const certKeys = (c: { name: string; issuer: string | null }) =>
    keysIn(`${c.name} ${c.issuer ?? ""}`);
  const orderedCerts = tailoring
    ? [...certs].sort((a, b) => relevance(certKeys(b), jk) - relevance(certKeys(a), jk))
    : certs;
  for (const c of orderedCerts.slice(caps.certifications)) {
    changes.push({
      kind: "entry_left_out",
      section: "Certifications",
      subject: c.name,
      reason: `Not shown: the resume lists at most ${LIMITS.certifications} certifications. It stays in your profile.`,
      ref: entryRef("certifications", c.id),
    });
  }
  const certifications: Entry[] = orderedCerts.slice(0, caps.certifications).map((c) => ({
    ref: entryRef("certifications", c.id),
    heading: claim("heading", "certifications", c.id, ["name"], c.name),
    detail: detailClaim(
      "certifications",
      c.id,
      c.issuer ? [{ fields: ["issuer"], text: c.issuer }] : [],
      ["issued_date"],
      c.issued_date ? formatDateLine(c.issued_date, null, false, "Issued ") : "",
    ),
    bullets: [],
  }));

  /* ---------- achievements ---------- */
  const achs = v.achievements.filter((a) => {
    if (!exclude.has(a.id)) return true;
    changes.push({
      kind: "item_excluded",
      section: "Achievements",
      subject: a.title,
      reason: "You left this out.",
      ref: entryRef("achievements", a.id),
    });
    return false;
  });
  const achKeys = (a: { title: string; description: string | null }) =>
    keysIn(`${a.title} ${a.description ?? ""}`);
  const orderedAchs = tailoring
    ? [...achs].sort((a, b) => relevance(achKeys(b), jk) - relevance(achKeys(a), jk))
    : achs;
  for (const a of orderedAchs.slice(caps.achievements)) {
    changes.push({
      kind: "entry_left_out",
      section: "Achievements",
      subject: a.title,
      reason: `Not shown: the resume lists at most ${LIMITS.achievements} achievements. It stays in your profile.`,
      ref: entryRef("achievements", a.id),
    });
  }
  const achievements: Entry[] = orderedAchs.slice(0, caps.achievements).map((a) => ({
    ref: entryRef("achievements", a.id),
    heading: claim("heading", "achievements", a.id, ["title"], a.title),
    detail: null,
    bullets: a.description
      ? [claim("bullet", "achievements", a.id, ["description"], a.description)]
      : [],
  }));

  /* ---------- requirements the profile cannot support ---------- */
  const have = new Set<string>([
    ...v.skills.map((s) => keyOf(s.name)),
    ...v.projects.flatMap((p) => [...projectKeys(p)]),
    ...v.experiences.flatMap((e) => [...keysIn(e.highlights.join("\n"), e.skills)]),
  ]);
  const missing: MissingRequirement[] = [];
  if (job) {
    for (const [k, name] of jk.required) {
      if (!have.has(k)) {
        missing.push({
          skill: name,
          required: true,
          text: `${name} is required by this job but was not found in your verified profile. If you have genuinely used it, add the experience.`,
        });
      }
    }
    for (const [k, name] of jk.preferred) {
      if (!have.has(k)) {
        missing.push({
          skill: name,
          required: false,
          text: `${name} is a nice-to-have for this job and was not found in your verified profile.`,
        });
      }
    }
  }

  return {
    ok: true,
    doc: {
      tailor_version: TAILOR_VERSION,
      header,
      summary,
      skills,
      experience,
      projects,
      education,
      certifications,
      achievements,
    },
    changes,
    missing,
  };
}
