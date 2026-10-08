/**
 * Career readiness: how ready the person's own materials are. It is built from three stored
 * facts and says nothing about hiring odds. A part that cannot be measured yet (no resume
 * uploaded, no jobs to compare) is left out and the rest are rescaled, never guessed.
 */
export interface ReadinessInput {
  /** Profile completeness, 0 to 100. Null when there is no profile. */
  completeness: number | null;
  /** The latest resume's health score, 0 to 100. Null when no resume has been uploaded. */
  resumeHealth: number | null;
  /** How many of the top jobs rate Good or Strong on Application Strength, out of how many. */
  goodMatches: { n: number; of: number } | null;
}

export interface ReadinessPart {
  id: "profile" | "resume" | "matches";
  label: string;
  weight: number;
  /** 0 to 100, or null when it cannot be measured yet. */
  value: number | null;
  evidence: string;
  hint: string;
}

export interface Readiness {
  /** 0 to 100, or null when nothing can be measured. */
  score: number | null;
  parts: ReadinessPart[];
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const matchValue =
    input.goodMatches && input.goodMatches.of > 0
      ? Math.round((input.goodMatches.n / input.goodMatches.of) * 100)
      : null;
  const parts: ReadinessPart[] = [
    {
      id: "profile",
      label: "Profile completeness",
      weight: 40,
      value: input.completeness,
      evidence:
        input.completeness === null
          ? "No profile yet."
          : `Your verified profile is ${input.completeness}% complete.`,
      hint: "Add projects with real detail and the skills you have used.",
    },
    {
      id: "resume",
      label: "Resume health",
      weight: 30,
      value: input.resumeHealth,
      evidence:
        input.resumeHealth === null
          ? "No resume uploaded yet."
          : `Your latest resume scores ${input.resumeHealth} out of 100 for how clearly it reads.`,
      hint: "Upload a resume to check how it reads.",
    },
    {
      id: "matches",
      label: "Fit with the jobs on offer",
      weight: 30,
      value: matchValue,
      evidence:
        input.goodMatches === null || input.goodMatches.of === 0
          ? "No jobs to compare with yet."
          : `${input.goodMatches.n} of your top ${input.goodMatches.of} jobs rate Good or Strong on Application Strength.`,
      hint: "See Career Gaps for the skills that would improve the most matches.",
    },
  ];
  const live = parts.filter((p) => p.value !== null);
  const total = live.reduce((t, p) => t + p.weight, 0);
  return {
    score:
      live.length === 0
        ? null
        : Math.round(live.reduce((t, p) => t + p.weight * p.value!, 0) / total),
    parts,
  };
}
