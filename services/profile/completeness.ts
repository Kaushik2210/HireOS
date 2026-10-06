import type { ProfileSnapshot } from "@/db/profile/store";
import { verifiedSnapshot } from "@/services/profile/verified";

export interface CompletenessCriterion {
  id: string;
  label: string;
  /** Points available. All weights sum to 100. */
  weight: number;
  /** 0 to 1, the share of the weight earned. */
  progress: number;
  /** The stored facts this was computed from, shown to the user. */
  evidence: string;
  /** What to do to earn the rest. Empty when fully met. */
  hint: string;
}

export interface Completeness {
  /** 0 to 100, rounded. Describes how complete the profile is, never hiring odds. */
  score: number;
  criteria: CompletenessCriterion[];
  /** Up to three criteria costing the most points, biggest first. */
  nextSteps: CompletenessCriterion[];
}

const fraction = (value: number, target: number) => Math.min(Math.max(value / target, 0), 1);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Scores completeness from verified items only. Pure and deterministic: the same snapshot
 * always yields the same result, and every criterion states the evidence behind it.
 */
export function computeCompleteness(input: ProfileSnapshot): Completeness {
  const s = verifiedSnapshot(input);
  const profile = s.profile;
  const goals = s.goals;

  const summaryLength = profile?.summary?.length ?? 0;
  const skillTypes = new Set(s.skills.map((x) => x.type));
  const evidenceItems = [...s.experiences, ...s.projects];
  const withHighlights = evidenceItems.filter((x) => x.highlights.length > 0).length;
  const hasLink = Boolean(profile?.linkedin_url || profile?.github_url || profile?.website_url);

  const prefParts = [
    (profile?.work_modes.length ?? 0) > 0,
    (profile?.job_types.length ?? 0) > 0,
    (profile?.preferred_locations.length ?? 0) > 0,
  ];
  const goalParts = [
    (goals?.target_roles.length ?? 0) > 0,
    Boolean(goals?.target_level),
    Boolean(goals?.timeline_months),
  ];

  const criteria: CompletenessCriterion[] = [
    {
      id: "name",
      label: "Name",
      weight: 5,
      progress: profile?.full_name ? 1 : 0,
      evidence: profile?.full_name ? "Name added" : "No name yet",
      hint: "Add your full name.",
    },
    {
      id: "headline",
      label: "Headline",
      weight: 5,
      progress: profile?.headline ? 1 : 0,
      evidence: profile?.headline ? "Headline added" : "No headline yet",
      hint: "Add a one-line headline describing what you do.",
    },
    {
      id: "summary",
      label: "Summary",
      weight: 10,
      progress: fraction(summaryLength, 80),
      evidence: `${summaryLength} of 80 characters`,
      hint: "Write a short summary of at least 80 characters.",
    },
    {
      id: "location",
      label: "Location",
      weight: 3,
      progress: profile?.location ? 1 : 0,
      evidence: profile?.location ? "Location added" : "No location yet",
      hint: "Add your current location.",
    },
    {
      id: "links",
      label: "Professional link",
      weight: 4,
      progress: hasLink ? 1 : 0,
      evidence: hasLink ? "At least one link added" : "No links yet",
      hint: "Add a LinkedIn, GitHub or website link.",
    },
    {
      id: "education",
      label: "Education",
      weight: 8,
      progress: fraction(s.education.length, 1),
      evidence: count(s.education.length, "education entry", "education entries"),
      hint: "Add at least one education entry.",
    },
    {
      id: "experience",
      label: "Experience",
      weight: 8,
      progress: fraction(s.experiences.length, 1),
      evidence: count(s.experiences.length, "experience entry", "experience entries"),
      hint: "Add an internship, job, leadership or volunteer role.",
    },
    {
      id: "projects",
      label: "Projects",
      weight: 12,
      progress: fraction(s.projects.length, 2),
      evidence: `${s.projects.length} of 2 projects`,
      hint: "Add at least two projects that show what you can build.",
    },
    {
      id: "skills",
      label: "Skills",
      weight: 14,
      progress: fraction(s.skills.length, 8),
      evidence: `${s.skills.length} of 8 skills`,
      hint: "Add at least eight skills you can genuinely back up.",
    },
    {
      id: "skill-breadth",
      label: "Skill breadth",
      weight: 4,
      progress: fraction(skillTypes.size, 3),
      evidence: `${skillTypes.size} of 3 skill categories`,
      hint: "Cover at least three categories, such as languages, databases and tools.",
    },
    {
      id: "impact",
      label: "Impact details",
      weight: 9,
      progress: evidenceItems.length === 0 ? 0 : withHighlights / evidenceItems.length,
      evidence:
        evidenceItems.length === 0
          ? "No experience or projects yet"
          : `${withHighlights} of ${evidenceItems.length} experience and project entries have bullet points`,
      hint: "Add bullet points describing what you did and the result.",
    },
    {
      id: "certifications",
      label: "Certification",
      weight: 3,
      progress: fraction(s.certifications.length, 1),
      evidence: count(s.certifications.length, "certification", "certifications"),
      hint: "Add a certification if you have one. Skip it if you do not.",
    },
    {
      id: "preferences",
      label: "Job preferences",
      weight: 7,
      progress: prefParts.filter(Boolean).length / prefParts.length,
      evidence: `${prefParts.filter(Boolean).length} of 3 set (work mode, job type, locations)`,
      hint: "Set work mode, job type and preferred locations.",
    },
    {
      id: "goals",
      label: "Career goal",
      weight: 8,
      progress: goalParts.filter(Boolean).length / goalParts.length,
      evidence: `${goalParts.filter(Boolean).length} of 3 set (target role, level, timeline)`,
      hint: "Set a target role, level and timeline.",
    },
  ];

  const earned = criteria.reduce((sum, c) => sum + c.weight * c.progress, 0);
  const nextSteps = [...criteria]
    .filter((c) => c.progress < 1)
    .sort((a, b) => b.weight * (1 - b.progress) - a.weight * (1 - a.progress))
    .slice(0, 3);

  return { score: Math.round(earned), criteria, nextSteps };
}
