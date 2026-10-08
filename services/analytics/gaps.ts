import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import { MAX_GAP_JOBS } from "@/lib/analytics/types";
import { SKILL_QUESTIONS } from "@/lib/interview/bank";
import { normalizeKey, normalizeSkill } from "@/lib/skills/catalog";
import { buildCandidate } from "@/services/matching/candidate";
import { experienceRequirement } from "@/services/matching/requirements";
import { canScore, scoreJob } from "@/services/matching/score";

export interface GapJob {
  id: string;
  title: string;
  company: string;
  /** How many points of Application Strength adding this skill would add for this job. */
  gain: number;
}

export interface SkillGap {
  skill: string;
  requiredIn: number;
  preferredIn: number;
  jobs: GapJob[];
  /** Strength points gained across all the jobs, if the skill were in the verified profile. */
  totalGain: number;
  avgGain: number;
  /** True when HireOS has practice questions on this skill. */
  canPractise: boolean;
}

export interface GapAnalysis {
  state: "needs_profile" | "no_jobs" | "ready";
  jobCount: number;
  /** Skills worth learning, biggest total improvement first. */
  priorities: SkillGap[];
  /** Skills the profile lists at beginner level that jobs require. */
  weak: { skill: string; requiredIn: number }[];
  /** Skills the person has that the most jobs ask for. */
  strengths: { skill: string; requiredIn: number }[];
  experience: { jobsAskingMore: number; typicalYears: number | null; haveYears: number } | null;
}

const MAX_PRIORITIES = 8;
const MAX_CANDIDATES = 12;

/** A skill as if the person had confirmed it, used only to measure how much it would help. */
function withSkill(snapshot: ProfileSnapshot, name: string): ProfileSnapshot {
  const norm = normalizeSkill(name);
  const when = "2000-01-01T00:00:00Z";
  return {
    ...snapshot,
    skills: [
      ...snapshot.skills,
      {
        id: `simulated-${normalizeKey(name)}`,
        name: norm.name,
        type: norm.type ?? "tool",
        level: "intermediate",
        years: null,
        source: "manual",
        confirmed: true,
        created_at: when,
        updated_at: when,
      },
    ],
  };
}

const keyOf = (name: string) => normalizeKey(normalizeSkill(name).name);

/**
 * Which skills would most improve the person's matches. It measures, rather than guesses:
 * for each skill the target jobs ask for and the verified profile lacks, it re-scores every
 * job with that skill added and totals the Application Strength gained. The skill is only
 * added in the simulation. Nothing is written to the profile, and the suggestion is always
 * to build something real and add the skill once it is true.
 */
export function analyzeGaps(
  snapshot: ProfileSnapshot,
  jobs: readonly Job[],
  now: Date = new Date(),
): GapAnalysis {
  const candidate = buildCandidate(snapshot, now);
  const empty = { priorities: [], weak: [], strengths: [], experience: null };
  if (!canScore(candidate)) return { state: "needs_profile", jobCount: 0, ...empty };
  const targets = jobs.slice(0, MAX_GAP_JOBS);
  if (targets.length === 0) return { state: "no_jobs", jobCount: 0, ...empty };

  const base = new Map(targets.map((j) => [j.id, scoreJob(j, candidate).strength]));

  // Which skills are asked for, and by how many jobs.
  const asked = new Map<string, { name: string; required: Job[]; preferred: Job[] }>();
  const ownedCounts = new Map<string, { name: string; n: number }>();
  for (const job of targets) {
    for (const [list, kind] of [
      [job.required_skills, "required"],
      [job.preferred_skills, "preferred"],
    ] as const) {
      for (const raw of new Set(list.map((s) => normalizeSkill(s).name))) {
        const key = normalizeKey(raw);
        if (candidate.skills.has(key)) {
          if (kind === "required") {
            const c = ownedCounts.get(key) ?? { name: candidate.skills.get(key)!.name, n: 0 };
            c.n++;
            ownedCounts.set(key, c);
          }
          continue;
        }
        const entry = asked.get(key) ?? { name: raw, required: [], preferred: [] };
        entry[kind].push(job);
        asked.set(key, entry);
      }
    }
  }

  const candidates = [...asked.values()]
    .sort(
      (a, b) =>
        b.required.length * 2 + b.preferred.length - (a.required.length * 2 + a.preferred.length) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_CANDIDATES);

  const priorities: SkillGap[] = [];
  for (const c of candidates) {
    const simulated = buildCandidate(withSkill(snapshot, c.name), now);
    const affected = [...new Map([...c.required, ...c.preferred].map((j) => [j.id, j])).values()];
    const jobsGain: GapJob[] = affected
      .map((j) => ({
        id: j.id,
        title: j.title,
        company: j.company_name,
        gain: scoreJob(j, simulated).strength - (base.get(j.id) ?? 0),
      }))
      .filter((g) => g.gain > 0)
      .sort((a, b) => b.gain - a.gain);
    if (jobsGain.length === 0) continue;
    const totalGain = jobsGain.reduce((t, g) => t + g.gain, 0);
    priorities.push({
      skill: c.name,
      requiredIn: c.required.length,
      preferredIn: c.preferred.length,
      jobs: jobsGain,
      totalGain,
      avgGain: Math.round((totalGain / jobsGain.length) * 10) / 10,
      canPractise: Boolean(SKILL_QUESTIONS[c.name]),
    });
  }
  priorities.sort((a, b) => b.totalGain - a.totalGain || a.skill.localeCompare(b.skill));

  const weak: GapAnalysis["weak"] = [];
  for (const s of candidate.skills.values()) {
    if (s.level !== "beginner") continue;
    const n = targets.filter((j) => j.required_skills.some((r) => keyOf(r) === s.key)).length;
    if (n > 0) weak.push({ skill: s.name, requiredIn: n });
  }
  weak.sort((a, b) => b.requiredIn - a.requiredIn || a.skill.localeCompare(b.skill));

  const strengths = [...ownedCounts.values()]
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((s) => ({ skill: s.name, requiredIn: s.n }));

  const have = candidate.experienceMonths / 12;
  const asks = targets
    .map((j) => experienceRequirement(j)?.years ?? null)
    .filter((y): y is number => y !== null && y > have + 0.5)
    .sort((a, b) => a - b);

  return {
    state: "ready",
    jobCount: targets.length,
    priorities: priorities.slice(0, MAX_PRIORITIES),
    weak: weak.slice(0, 5),
    strengths,
    experience:
      asks.length > 0
        ? {
            jobsAskingMore: asks.length,
            typicalYears: asks[Math.floor(asks.length / 2)]!,
            haveYears: Math.round(have * 10) / 10,
          }
        : null,
  };
}
