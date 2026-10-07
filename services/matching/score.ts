import type { Job } from "@/lib/jobs/schemas";
import { titleKey } from "@/lib/jobs/keys";
import {
  SCORER_VERSION,
  SKILL_CAP,
  labelFor,
  type Evidence,
  type Gap,
  type MatchResult,
} from "@/lib/matching/types";
import type { Candidate } from "@/services/matching/candidate";
import {
  educationComponent,
  experienceComponent,
  keywordsComponent,
  locationComponent,
  projectsComponent,
  seniorityComponent,
  skillsComponent,
  type Part,
} from "@/services/matching/components";

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Scoring needs at least one verified item. Without one there is nothing to compare. */
export const canScore = (candidate: Candidate) => candidate.hasVerifiedData;

const toYearly = (amount: number, period: string | null) =>
  period === "month" ? amount * 12 : amount;

/** A hedged note when stated pay may sit below what the person said they expect. Not scored. */
function payConcern(job: Job, c: Candidate): string | null {
  const prefs = c.prefs;
  if (!prefs || prefs.salaryMin === null || !job.salary_currency) return null;
  if (job.salary_currency !== prefs.currency) return null;
  const top = job.salary_max ?? job.salary_min;
  if (top === null) return null;
  const jobTop = toYearly(top, job.salary_period);
  const wanted = toYearly(prefs.salaryMin, prefs.period);
  if (jobTop >= wanted) return null;
  return `The stated pay may be below your expected minimum (${prefs.currency} ${wanted.toLocaleString("en-IN")} a year).`;
}

/** The person's own target roles, matched against the title. Evidence only; it is not scored. */
function roleFit(job: Job, c: Candidate): Evidence | null {
  const jobTitle = titleKey(job.title);
  const hit = c.targetRoles.find((role) => {
    const key = titleKey(role);
    return key.length > 0 && (jobTitle.includes(key) || key.includes(jobTitle));
  });
  return hit
    ? { text: `The title matches one of your target roles: ${hit}.`, source_ref: null }
    : null;
}

/**
 * Application Strength for one job and one candidate.
 *
 * Seven components each score 0 to 100 from stored facts. Components the posting gives no
 * basis for are left out and the rest are rescaled, so a job is never marked down for
 * something it does not ask. The result states every input it compared. If too few required
 * skills are found, the total is capped so other components cannot hide that gap.
 *
 * Deterministic: the same job and verified profile always give the same result.
 */
export function scoreJob(job: Job, candidate: Candidate): MatchResult {
  const skills = skillsComponent(job, candidate);
  const keywords = keywordsComponent(job, candidate);
  const parts: Part[] = [
    skills,
    projectsComponent(job, candidate),
    experienceComponent(job, candidate),
    keywords,
    educationComponent(job, candidate),
    locationComponent(job, candidate),
    seniorityComponent(job, candidate),
  ];

  const applicable = parts.filter((p) => p.component.applicable && p.component.score !== null);
  const totalWeight = applicable.reduce((sum, p) => sum + p.component.weight, 0);
  const weighted = applicable.reduce(
    (sum, p) => sum + p.component.weight * (p.component.score ?? 0),
    0,
  );
  const raw = totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);

  let strength = raw;
  let cap: MatchResult["cap"] = { applied: false, reason: null };
  if (
    skills.requiredCoverage !== null &&
    job.required_skills.length >= SKILL_CAP.minRequiredSkills &&
    skills.requiredCoverage < SKILL_CAP.minCoverage &&
    raw > SKILL_CAP.maxStrength
  ) {
    strength = SKILL_CAP.maxStrength;
    cap = {
      applied: true,
      reason: `Capped at ${SKILL_CAP.maxStrength}: fewer than ${Math.round(SKILL_CAP.minCoverage * 100)}% of this job's required skills were found in your verified profile, so other strengths cannot make up for that.`,
    };
  }

  const why: Evidence[] = [];
  const fit = roleFit(job, candidate);
  if (fit) why.push(fit);
  why.push(...parts.flatMap((p) => p.why));

  const gaps: Gap[] = parts
    .flatMap((p) => p.gaps)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const concerns = parts.flatMap((p) => p.concerns);
  if (candidate.targetRoles.length > 0 && !fit) {
    concerns.push(
      `This title does not match your target roles (${candidate.targetRoles.join(", ")}), so check it is a direction you want.`,
    );
  }
  const pay = payConcern(job, candidate);
  if (pay) concerns.push(pay);

  const label = labelFor(strength);
  return {
    scorer_version: SCORER_VERSION,
    strength,
    label,
    cap,
    components: parts.map((p) => p.component),
    why,
    gaps,
    keywords: { covered: keywords.covered, missing: keywords.missing },
    concerns,
    action: recommend(label, gaps, keywords.missing, skills.missingRequired),
  };
}

function recommend(
  label: MatchResult["label"],
  gaps: Gap[],
  missingKeywords: string[],
  missingRequired: string[],
): MatchResult["action"] {
  // A compact summary: missing required skills as one phrase, then the biggest other gap.
  const parts: string[] = [];
  if (missingRequired.length > 0) {
    const shown = missingRequired.slice(0, 3).join(", ");
    parts.push(
      `required skills not yet in your verified profile (${shown}${missingRequired.length > 3 ? ", and more" : ""})`,
    );
  }
  const other = gaps.find(
    (g) => g.kind !== "required_skill" && g.kind !== "preferred_skill" && g.severity !== "low",
  );
  if (other) parts.push(other.text.replace(/\.$/, "").replace(/^The job asks/, "the job asks"));
  const summary = parts.join("; ");

  switch (label) {
    case "strong":
      return {
        kind: "apply",
        text: "This looks like a strong match on paper. Tailor your resume to the posting, then apply on the employer's page.",
      };
    case "good":
      return {
        kind: "tailor",
        text:
          missingKeywords.length > 0
            ? `A good match on paper. Tailor your resume to show real experience with ${missingKeywords.slice(0, 3).join(", ")} where you have it, then apply.`
            : "A good match on paper. Tailor your resume to the posting, then apply on the employer's page.",
      };
    case "stretch":
      return {
        kind: "close_gaps",
        text: summary
          ? `This may be a stretch right now. The main gaps: ${summary}.`
          : "This may be a stretch right now. Review the breakdown for what to strengthen.",
      };
    case "low":
      return {
        kind: "reconsider",
        text: "Several of this job's requirements are not covered by your verified profile, so it may not be the best use of your time right now.",
      };
  }
}
