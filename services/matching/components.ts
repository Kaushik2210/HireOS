import { locationKey } from "@/lib/jobs/keys";
import type { Job } from "@/lib/jobs/schemas";
import {
  COMPONENT_LABELS,
  COMPONENT_WEIGHTS,
  type ComponentId,
  type Evidence,
  type Gap,
  type MatchComponent,
} from "@/lib/matching/types";
import type { SkillLevel } from "@/lib/profile/constants";
import { findCatalogSkill, normalizeKey } from "@/lib/skills/catalog";
import { LEVEL_ORDER, type Candidate } from "@/services/matching/candidate";
import { educationRequirement, experienceRequirement } from "@/services/matching/requirements";

export interface Part {
  component: MatchComponent;
  why: Evidence[];
  gaps: Gap[];
  concerns: string[];
}

const round = (n: number) => Math.round(n);
const clampScore = (n: number) => Math.min(100, Math.max(0, round(n)));
const list = (items: string[]) => items.join(", ");

const LEVEL_TEXT: Record<string, string> = {
  student: "student",
  entry: "entry level",
  junior: "junior",
  mid: "mid level",
  senior: "senior",
  lead: "lead",
};

function base(id: ComponentId): Pick<MatchComponent, "id" | "label" | "weight"> {
  return { id, label: COMPONENT_LABELS[id], weight: COMPONENT_WEIGHTS[id] };
}

function notApplicable(
  id: ComponentId,
  summary: string,
  inputs: MatchComponent["inputs"] = [],
): Part {
  return {
    component: { ...base(id), applicable: false, score: null, summary, inputs },
    why: [],
    gaps: [],
    concerns: [],
  };
}

/* ------------------------------------------------------------------ skills */

/** Credit for a skill you hold: level matters, and use in a project or role counts as working knowledge. */
const LEVEL_CREDIT: Record<SkillLevel, number> = {
  beginner: 0.6,
  intermediate: 0.85,
  advanced: 1,
  expert: 1,
};
const USED_ONLY_CREDIT = 0.85;

export interface SkillsPart extends Part {
  requiredCoverage: number | null;
  missingRequired: string[];
}

export function skillsComponent(job: Job, c: Candidate): SkillsPart {
  const required = job.required_skills;
  const preferred = job.preferred_skills;
  if (required.length + preferred.length === 0) {
    return {
      ...notApplicable("skills", "This posting does not name specific skills to compare."),
      requiredCoverage: null,
      missingRequired: [],
    };
  }

  const inputs: MatchComponent["inputs"] = [];
  const why: Evidence[] = [];
  const gaps: Gap[] = [];
  let earned = 0;
  let possible = 0;
  let requiredFound = 0;
  const missingRequired: string[] = [];

  const consider = (name: string, isRequired: boolean) => {
    const weight = isRequired ? 1 : 0.5;
    possible += weight;
    const have = c.skills.get(normalizeKey(name));
    const credit = have ? (have.level ? LEVEL_CREDIT[have.level] : USED_ONLY_CREDIT) : 0;
    earned += weight * credit;
    const kind = isRequired ? "Required" : "Nice to have";

    if (!have) {
      inputs.push({ label: `${kind}: ${name}`, value: "Not found in your verified profile" });
      if (isRequired) missingRequired.push(name);
      const pending = c.pendingSkillKeys.has(normalizeKey(name));
      if (isRequired) {
        gaps.push({
          kind: "required_skill",
          severity: "high",
          text: pending
            ? `${name} appears in an unconfirmed item from your resume. Review and confirm it to count it.`
            : `${name} is required by this job but was not found in your verified profile. If you have genuinely used it, add the experience.`,
          suggestion: relatedSkillNote(name, c),
        });
      } else {
        gaps.push({
          kind: "preferred_skill",
          severity: "low",
          text: pending
            ? `${name} (nice to have) appears in an unconfirmed item from your resume. Confirm it to count it.`
            : `${name} is a nice-to-have that was not found in your verified profile.`,
          suggestion: null,
        });
      }
      return;
    }

    if (isRequired) requiredFound += 1;
    if (have.level) {
      inputs.push({
        label: `${kind}: ${name}`,
        value: `${LEVEL_TEXT[have.level] ?? have.level} (skills list)`,
      });
      if (isRequired && have.ref) {
        why.push({
          text: `You list ${name} at ${have.level} level, and this job requires it.`,
          source_ref: refOf(have.ref),
        });
      }
      if (isRequired && have.level === "beginner") {
        gaps.push({
          kind: "weak_skill",
          severity: "medium",
          text: `You list ${name} at beginner level, and this job lists it as required.`,
          suggestion:
            "A project that uses it, or more practice, may strengthen this before you apply.",
        });
      }
    } else {
      const used = have.usedIn[0];
      inputs.push({
        label: `${kind}: ${name}`,
        value: `Used in ${used ? `"${used.label}"` : "your work"} (not in your skills list)`,
      });
      if (isRequired && used) {
        why.push({
          text: `${name} appears in ${used.entity === "projects" ? "your project" : "your role"} "${used.label}".`,
          source_ref: refOf(used),
        });
      }
    }
  };

  for (const name of required) consider(name, true);
  for (const name of preferred) consider(name, false);

  const score = clampScore((100 * earned) / possible);
  const summary =
    required.length > 0
      ? `${requiredFound} of ${required.length} required skills found in your verified profile.`
      : `${preferred.length === 0 ? 0 : round((earned / possible) * preferred.length)} of ${preferred.length} listed skills found.`;

  return {
    component: { ...base("skills"), applicable: true, score, summary, inputs },
    why: why.slice(0, 6),
    gaps,
    concerns: [],
    requiredCoverage: required.length > 0 ? requiredFound / required.length : null,
    missingRequired,
  };
}

const refOf = (ref: { entity: string; id: string }) => ({ entity: ref.entity, id: ref.id });

/** A same-category skill you do hold, mentioned as context only. It never earns credit. */
function relatedSkillNote(name: string, c: Candidate): string | null {
  const type = findCatalogSkill(name)?.type;
  if (!type) return null;
  const related = [...c.skills.values()].find(
    (s) => s.ref && findCatalogSkill(s.name)?.type === type && s.key !== normalizeKey(name),
  );
  return related
    ? `You list ${related.name}, which is in the same category. That may help, but it is not the same skill.`
    : null;
}

/* ---------------------------------------------------------------- projects */

export function projectsComponent(job: Job, c: Candidate): Part {
  const targets = job.required_skills.length > 0 ? job.required_skills : job.preferred_skills;
  if (targets.length === 0)
    return notApplicable(
      "projects",
      "This posting does not name skills to compare projects against.",
    );

  const targetKeys = targets.map((t) => normalizeKey(t));
  const inputs: MatchComponent["inputs"] = [
    {
      label: "Skills compared",
      value: `${job.required_skills.length > 0 ? "Required" : "Listed"}: ${list(targets)}`,
    },
  ];

  if (c.projects.length === 0) {
    inputs.push({ label: "Your projects", value: "None in your verified profile" });
    return {
      component: {
        ...base("projects"),
        applicable: true,
        score: 0,
        summary: "No verified projects to compare.",
        inputs,
      },
      why: [],
      gaps: [
        {
          kind: "experience",
          severity: "medium",
          text: "You have no verified projects that use this job's skills.",
          suggestion:
            "A small project built with these tools can show evidence a resume line cannot.",
        },
      ],
      concerns: [],
    };
  }

  // Greedily pick up to two projects that together cover the most of the job's skills.
  const covered = new Set<string>();
  const chosen: { name: string; ref: { entity: string; id: string }; adds: string[] }[] = [];
  const pool = [...c.projects];
  for (let round = 0; round < 2; round++) {
    let best: { index: number; adds: string[] } | null = null;
    pool.forEach((p, index) => {
      const adds = targetKeys.filter((k) => p.skillKeys.has(k) && !covered.has(k));
      if (adds.length > 0 && (!best || adds.length > best.adds.length)) best = { index, adds };
    });
    if (!best) break;
    const picked = pool.splice((best as { index: number }).index, 1)[0]!;
    for (const k of (best as { adds: string[] }).adds) covered.add(k);
    chosen.push({
      name: picked.ref.label,
      ref: refOf(picked.ref),
      adds: (best as { adds: string[] }).adds.map((k) => targets[targetKeys.indexOf(k)]!),
    });
  }

  const score = clampScore((100 * covered.size) / targets.length);
  for (const p of chosen)
    inputs.push({ label: `Project: ${p.name}`, value: `Uses ${list(p.adds)}` });
  if (chosen.length === 0)
    inputs.push({ label: "Your projects", value: "None use the skills this job names" });

  return {
    component: {
      ...base("projects"),
      applicable: true,
      score,
      summary:
        chosen.length === 0
          ? "None of your verified projects use the skills this job names."
          : `Your best ${chosen.length === 1 ? "project covers" : "projects together cover"} ${covered.size} of ${targets.length} skills.`,
      inputs,
    },
    why: chosen.map((p) => ({
      text: `Your project "${p.name}" uses ${list(p.adds)}, which this job asks for.`,
      source_ref: p.ref,
    })),
    gaps:
      chosen.length === 0
        ? [
            {
              kind: "experience",
              severity: "low",
              text: "None of your verified projects use the skills this job names.",
              suggestion: null,
            },
          ]
        : [],
    concerns: [],
  };
}

/* -------------------------------------------------------------- experience */

export function experienceComponent(job: Job, c: Candidate): Part {
  const req = experienceRequirement(job);
  if (!req)
    return notApplicable("experience", "This posting does not state how much experience it wants.");

  const years = c.experienceMonths / 12;
  const roleCount = c.roles.filter((r) => r.kind === "work" || r.kind === "internship").length;
  const inputs: MatchComponent["inputs"] = [
    {
      label: "Asked for",
      value: `${req.years === 0 ? "No minimum" : `${req.years}+ years`} (${req.source === "stated" ? "stated in the posting" : "typical for the listed level"})`,
    },
    {
      label: "Your verified experience",
      value: `${years.toFixed(1)} years across ${roleCount} ${roleCount === 1 ? "role" : "roles"}, overlaps counted once`,
    },
  ];
  if (c.roles.some((r) => r.kind === "leadership" || r.kind === "volunteer")) {
    inputs.push({ label: "Not counted", value: "Leadership and volunteer roles" });
  }

  const score = req.years === 0 ? 100 : clampScore((100 * years) / req.years);
  const gaps: Gap[] = [];
  const why: Evidence[] = [];

  if (req.years > 0 && years < req.years) {
    const ratio = years / req.years;
    gaps.push({
      kind: "experience",
      severity: ratio < 0.34 ? "high" : ratio < 0.67 ? "medium" : "low",
      text: `The job asks for about ${req.years} ${req.years === 1 ? "year" : "years"}; your verified roles add up to about ${years.toFixed(1)} years.`,
      suggestion:
        "Internships and projects can partly offset this, but the posting may still screen on years.",
    });
  } else if (roleCount > 0 && req.years > 0) {
    const role = c.roles.find((r) => r.kind === "work" || r.kind === "internship");
    if (role)
      why.push({
        text: `Your verified experience of about ${years.toFixed(1)} years meets the ${req.years}+ years asked for.`,
        source_ref: refOf(role.ref),
      });
  }

  return {
    component: {
      ...base("experience"),
      applicable: true,
      score,
      summary:
        req.years === 0
          ? "No minimum experience is asked for."
          : `${years.toFixed(1)} of ${req.years} years asked for.`,
      inputs,
    },
    why,
    gaps,
    concerns: [],
  };
}

/* ---------------------------------------------------------------- keywords */

export interface KeywordsPart extends Part {
  covered: string[];
  missing: string[];
}

export function keywordsComponent(job: Job, c: Candidate): KeywordsPart {
  const keywords = [...new Set([...job.required_skills, ...job.preferred_skills])];
  if (keywords.length === 0) {
    return {
      ...notApplicable("keywords", "This posting has no keywords to look for."),
      covered: [],
      missing: [],
    };
  }
  const covered = keywords.filter((k) => c.mentionedKeys.has(normalizeKey(k)));
  const missing = keywords.filter((k) => !c.mentionedKeys.has(normalizeKey(k)));
  return {
    component: {
      ...base("keywords"),
      applicable: true,
      score: clampScore((100 * covered.length) / keywords.length),
      summary: `${covered.length} of ${keywords.length} of the posting's keywords appear somewhere in your verified profile.`,
      inputs: [
        { label: "Found", value: covered.length > 0 ? list(covered) : "None" },
        { label: "Not found", value: missing.length > 0 ? list(missing) : "None" },
      ],
    },
    why: [],
    gaps: [],
    concerns: [],
    covered,
    missing,
  };
}

/* --------------------------------------------------------------- education */

export function educationComponent(job: Job, c: Candidate): Part {
  const req = educationRequirement(job);
  if (!req) return notApplicable("education", "This posting does not ask for a specific degree.");

  const levelName = ["", "a diploma", "a bachelor's degree", "a master's degree", "a doctorate"][
    req.level
  ]!;
  const inputs: MatchComponent["inputs"] = [{ label: "Asked for", value: req.text }];

  let best = 0;
  let bestDegree = null as (typeof c.degrees)[number] | null;
  for (const d of c.degrees) {
    let credit = 0;
    if (d.level >= req.level) credit = d.ongoing && !req.allowsOngoing ? 0.8 : 1;
    else if (d.level === req.level - 1) credit = req.flexible ? 0.7 : 0.4;
    if (credit > best) {
      best = credit;
      bestDegree = d;
    }
  }

  inputs.push({
    label: "Your verified education",
    value:
      c.degrees.length === 0
        ? "None in your verified profile"
        : c.degrees.map((d) => `${d.text}${d.ongoing ? " (in progress)" : ""}`).join("; "),
  });

  const gaps: Gap[] = [];
  if (best < 1) {
    gaps.push({
      kind: "education",
      severity: best === 0 ? "high" : "medium",
      text:
        best === 0
          ? `The job asks for ${levelName}, which was not found in your verified education.`
          : `The job asks for ${levelName}; your verified education may fall slightly short or still be in progress.`,
      suggestion: req.flexible
        ? "The posting mentions equivalent experience, so relevant work may count."
        : null,
    });
  }

  return {
    component: {
      ...base("education"),
      applicable: true,
      score: clampScore(best * 100),
      summary:
        best >= 1
          ? "Your verified education meets the stated requirement."
          : best > 0
            ? "Close to the stated requirement."
            : "The stated degree requirement is not covered.",
      inputs,
    },
    why:
      bestDegree && best >= 0.8
        ? [
            {
              text: `Your ${bestDegree.text}${bestDegree.ongoing ? " (in progress)" : ""} meets the degree this job asks for.`,
              source_ref: refOf(bestDegree.ref),
            },
          ]
        : [],
    gaps,
    concerns: [],
  };
}

/* ---------------------------------------------------------------- location */

export function locationComponent(job: Job, c: Candidate): Part {
  const prefs = c.prefs;
  if (!prefs) return notApplicable("location", "Save your job preferences to compare locations.");

  const jobKey = locationKey(job.location);
  const mode = job.work_mode;
  if (!mode && !jobKey)
    return notApplicable("location", "This posting states neither a location nor a work mode.");
  if (prefs.workModes.length === 0 && prefs.locationKeys.length === 0 && !prefs.relocate) {
    return notApplicable("location", "You have not saved work-mode or location preferences yet.");
  }

  const modeOk = !mode || prefs.workModes.length === 0 || prefs.workModes.includes(mode);
  const isRemote = mode === "remote" || jobKey === "remote";
  const inputs: MatchComponent["inputs"] = [
    { label: "Job", value: `${job.location ?? "No location stated"}${mode ? `, ${mode}` : ""}` },
    {
      label: "Your preferences",
      value: `${prefs.locations.length > 0 ? list(prefs.locations) : "No locations saved"}${prefs.workModes.length > 0 ? `; ${list(prefs.workModes)}` : ""}${prefs.relocate ? "; open to relocating" : ""}`,
    },
  ];

  let score: number;
  let summary: string;
  const gaps: Gap[] = [];
  const why: Evidence[] = [];

  if (isRemote) {
    score = modeOk ? 100 : 40;
    summary = modeOk
      ? "A remote role, which fits your preferences."
      : "A remote role, but you did not list remote as a preference.";
  } else if (prefs.locationKeys.length === 0) {
    score = modeOk ? 80 : 40;
    summary = "No preferred locations saved, so only the work mode was compared.";
  } else if (jobKey && prefs.locationKeys.includes(jobKey)) {
    score = modeOk ? 100 : 65;
    summary = "The job is in one of your preferred locations.";
    why.push({
      text: `This job is in ${job.location}, one of your preferred locations.`,
      source_ref: null,
    });
  } else if (!jobKey) {
    score = modeOk ? 80 : 40;
    summary = "The posting does not state a location.";
  } else if (prefs.relocate) {
    score = modeOk ? 70 : 45;
    summary = "Not in a preferred location, but you are open to relocating.";
  } else {
    score = modeOk ? 25 : 15;
    summary = "Not in any of your preferred locations.";
    gaps.push({
      kind: "location",
      severity: "medium",
      text: `This job is in ${job.location}; your preferred locations are ${list(prefs.locations)}, and you have not said you would relocate.`,
      suggestion: null,
    });
  }

  if (!modeOk && mode) {
    gaps.push({
      kind: "location",
      severity: "low",
      text: `This is a ${mode} role; your saved work-mode preferences are ${list(prefs.workModes)}.`,
      suggestion: null,
    });
  }

  return {
    component: { ...base("location"), applicable: true, score, summary, inputs },
    why,
    gaps,
    concerns: [],
  };
}

/* --------------------------------------------------------------- seniority */

export function seniorityComponent(job: Job, c: Candidate): Part {
  if (!job.seniority) return notApplicable("seniority", "This posting does not state a level.");
  if (!c.level)
    return notApplicable("seniority", "Add education or experience so your level can be read.");

  const diff = LEVEL_ORDER[job.seniority] - LEVEL_ORDER[c.level.value];
  const score =
    diff === 0 ? 100 : diff === -1 ? 90 : diff <= -2 ? 60 : diff === 1 ? 60 : diff === 2 ? 30 : 10;
  const inputs: MatchComponent["inputs"] = [
    { label: "Level of the job", value: LEVEL_TEXT[job.seniority] ?? job.seniority },
    {
      label: "Your level",
      value: `${LEVEL_TEXT[c.level.value]} (${c.level.source === "profile" ? "from your profile" : "estimated from your experience"})`,
    },
  ];

  const gaps: Gap[] = [];
  const concerns: string[] = [];
  if (diff >= 1) {
    gaps.push({
      kind: "seniority",
      severity: diff >= 3 ? "high" : diff === 2 ? "medium" : "low",
      text: `This role is listed at ${LEVEL_TEXT[job.seniority]} level; your profile reads as ${LEVEL_TEXT[c.level.value]}.`,
      suggestion: diff === 1 ? "One level up is often reachable with strong projects." : null,
    });
  } else if (diff <= -2) {
    concerns.push(
      `This role is listed at ${LEVEL_TEXT[job.seniority]} level, which may be below your current level.`,
    );
  }

  return {
    component: {
      ...base("seniority"),
      applicable: true,
      score,
      summary:
        diff === 0
          ? "The level matches yours."
          : diff > 0
            ? "The role is above your current level."
            : "The role is below your current level.",
      inputs,
    },
    why:
      diff === 0
        ? [
            {
              text: `This ${LEVEL_TEXT[job.seniority]} role is at the level your profile describes.`,
              source_ref: null,
            },
          ]
        : [],
    gaps,
    concerns,
  };
}
