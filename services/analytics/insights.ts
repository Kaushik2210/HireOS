import type { Application, ApplicationEvent } from "@/db/applications/store";
import { MIN_APPLIED_FOR_ANALYSIS, TOO_EARLY_DAYS, type Rate } from "@/lib/analytics/types";
import type { MatchResult } from "@/lib/matching/types";
import { daysSince } from "@/services/applications/followups";
import { appliedAt, computeFunnel, hasApplied, type Funnel } from "@/services/analytics/funnel";

export interface InsightInput {
  now: Date;
  applications: readonly Application[];
  events: readonly ApplicationEvent[];
  /** Current Application Strength for each application whose job still exists, by application id. */
  matches: ReadonlyMap<string, MatchResult>;
  /** Profile completeness, 0 to 100, or null when there is no profile to measure. */
  completeness: number | null;
  /** Outreach drafts the person has recorded as sent. */
  outreachSent: number;
}

export type FindingId =
  | "low_strength"
  | "repeated_gap"
  | "level_stretch"
  | "no_tailoring"
  | "low_volume"
  | "profile_incomplete"
  | "no_follow_up"
  | "no_outreach";

export interface Finding {
  id: FindingId;
  title: string;
  /** Hedged: says what the data shows and what it may have contributed to. */
  statement: string;
  /** The stored facts behind it, so the person can check. */
  evidence: string[];
  suggestion: string;
  href: string | null;
  /** Larger means the signal is stronger. Used only for ordering. */
  weight: number;
}

export interface Insights {
  state: "not_enough_data" | "ready";
  headline: string;
  funnel: Funnel;
  /** What can honestly be said so far, with the sample size. */
  observations: string[];
  findings: Finding[];
  /** Things that temper the findings, such as applications that are too new to judge. */
  caveats: string[];
}

const pct = (n: number, of: number) => `${n} of ${of}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The required skills a match found missing, from its gap texts. */
function missingRequired(match: MatchResult): string[] {
  const out: string[] = [];
  for (const g of match.gaps) {
    if (g.kind !== "required_skill") continue;
    const m = /^(.+?) (?:is required by|appears in an unconfirmed)/.exec(g.text);
    if (m) out.push(m[1]!);
  }
  return out;
}

const rateText = (r: Rate) => `${pct(r.n, r.of)}${r.pct !== null ? ` (${r.pct}%)` : ""}`;

/**
 * "Why am I not getting interviews?" It looks for patterns in what the person has recorded,
 * states each one with its evidence and hedged wording ("may have", "likely contributing"),
 * and never claims a cause or an odds. With few applications it says so and shows only what
 * the data supports. Every number here comes from stored records and the deterministic
 * matching; nothing is estimated by a model.
 */
export function analyzeInterviews(input: InsightInput): Insights {
  const { now, applications, events, matches } = input;
  const funnel = computeFunnel(applications, events, now);
  const applied = applications.filter((a) => hasApplied(a, events));
  const withMatch = applied.filter((a) => matches.has(a.id));

  const observations: string[] = [];
  const caveats: string[] = [];

  if (funnel.applied > 0) {
    observations.push(
      `You have applied to ${plural(funnel.applied, "job", "jobs")}. ${rateText(funnel.heardBack)} have had any reply, and ${rateText(funnel.interviewed)} reached an interview.`,
    );
  }
  if (funnel.awaiting.total >= 2 && funnel.awaiting.young / funnel.awaiting.total >= 0.5) {
    caveats.push(
      `${pct(funnel.awaiting.young, funnel.awaiting.total)} of the applications still waiting were sent less than ${TOO_EARLY_DAYS} days ago, so silence from them may not mean much yet.`,
    );
  }

  if (funnel.applied < MIN_APPLIED_FOR_ANALYSIS) {
    // Partial observations only: enough to be useful, not enough to generalise.
    if (withMatch.length >= 2) {
      const counts = new Map<string, number>();
      for (const a of withMatch)
        for (const s of new Set(missingRequired(matches.get(a.id)!)))
          counts.set(s, (counts.get(s) ?? 0) + 1);
      const top = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
      if (top) {
        observations.push(
          `So far, ${top[0]} was asked for by ${pct(top[1], withMatch.length)} of the jobs you applied to and is not in your verified profile.`,
        );
      }
    }
    return {
      state: "not_enough_data",
      headline: "Not enough applications yet",
      funnel,
      observations: [
        `Patterns need at least ${MIN_APPLIED_FOR_ANALYSIS} applications to mean much, and you have ${funnel.applied}. Here is what can be said so far.`,
        ...observations,
      ],
      findings: [],
      caveats,
    };
  }

  const findings: Finding[] = [];

  // 1. Jobs that were a stretch on paper.
  if (withMatch.length >= 3) {
    const stretch = withMatch.filter((a) => ["stretch", "low"].includes(matches.get(a.id)!.label));
    const share = stretch.length / withMatch.length;
    if (share >= 0.5) {
      const strengths = withMatch.map((a) => matches.get(a.id)!.strength).sort((a, b) => a - b);
      findings.push({
        id: "low_strength",
        title: "Many of the jobs were a stretch on paper",
        statement: `${pct(stretch.length, withMatch.length)} of the jobs you applied to rate Stretch or Low on Application Strength today. Applying mostly to roles your verified profile only partly covers may have made replies less likely.`,
        evidence: [
          `Median Application Strength across these jobs: ${strengths[Math.floor(strengths.length / 2)]} out of 100.`,
          ...stretch
            .slice(0, 4)
            .map(
              (a) =>
                `${a.jobTitle} at ${a.companyName}: ${matches.get(a.id)!.strength} (${matches.get(a.id)!.label}).`,
            ),
          "Strength is scored against your profile as it is today, not as it was when you applied.",
        ],
        suggestion:
          "Look at the Matches page for jobs rated Good or Strong before applying, and use the gaps listed on each job to decide what to learn.",
        href: "/matches",
        weight: 2 + share,
      });
    }
  }

  // 2. The same required skill missing again and again.
  if (withMatch.length >= 3) {
    const counts = new Map<string, number>();
    for (const a of withMatch)
      for (const s of new Set(missingRequired(matches.get(a.id)!)))
        counts.set(s, (counts.get(s) ?? 0) + 1);
    const repeated = [...counts]
      .filter(([, n]) => n >= 3 && n / withMatch.length >= 0.4)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (repeated.length > 0) {
      findings.push({
        id: "repeated_gap",
        title: "The same skills keep coming up as missing",
        statement: `${repeated.map(([s]) => s).join(", ")} ${repeated.length === 1 ? "was" : "were"} asked for by many of the jobs you applied to and ${repeated.length === 1 ? "is" : "are"} not in your verified profile. That is likely contributing, though employers weigh skills differently.`,
        evidence: [
          ...repeated.map(
            ([s, n]) => `${s}: required by ${pct(n, withMatch.length)} of the jobs you applied to.`,
          ),
          "If you have genuinely used one of these, add the experience to your profile so it counts.",
        ],
        suggestion:
          "See the Career Gaps page for which skills would improve the most matches, and add a skill to your profile only once you have really used it.",
        href: "/gaps",
        weight: 2 + repeated[0]![1] / withMatch.length,
      });
    }
  }

  // 3. Level or experience asked for above what the profile shows.
  if (withMatch.length >= 3) {
    const above = withMatch.filter((a) =>
      matches
        .get(a.id)!
        .gaps.some(
          (g) => (g.kind === "seniority" || g.kind === "experience") && g.severity === "high",
        ),
    );
    const share = above.length / withMatch.length;
    if (above.length >= 3 && share >= 0.4) {
      findings.push({
        id: "level_stretch",
        title: "Several roles asked for more experience or a higher level",
        statement: `${pct(above.length, withMatch.length)} of the jobs asked for noticeably more experience or a higher level than your verified profile shows, which may have counted against those applications.`,
        evidence: above.slice(0, 4).map((a) => {
          const g = matches
            .get(a.id)!
            .gaps.find((x) => x.kind === "seniority" || x.kind === "experience")!;
          return `${a.jobTitle} at ${a.companyName}: ${g.text}`;
        }),
        suggestion:
          "Consider internships, junior or entry-level roles that match your experience today, and keep building projects that show the next level.",
        href: "/jobs",
        weight: 1.5 + share,
      });
    }
  }

  // 4. Few applications carry a tailored resume.
  const linked = applied.filter((a) => a.resumeVersionId !== null).length;
  if (
    applied.length >= MIN_APPLIED_FOR_ANALYSIS &&
    (applied.length - linked) / applied.length >= 0.7
  ) {
    findings.push({
      id: "no_tailoring",
      title: "Few applications have a tailored resume linked",
      statement: `${pct(applied.length - linked, applied.length)} of your applications have no tailored resume linked. A resume that leads with what the job asks for may have helped, though you may also have tailored one without linking it here.`,
      evidence: [
        `${plural(linked, "application has", "applications have")} a resume version linked.`,
      ],
      suggestion:
        "Tailor a resume from the job page and link the version to the application, so you can see later what you sent.",
      href: "/documents",
      weight: 1.5,
    });
  }

  // 5. Not many applications recently.
  const recent = applied.filter((a) => {
    const when = appliedAt(a, events);
    return when !== null && now.getTime() - when <= 30 * 86_400_000;
  }).length;
  if (recent < 5) {
    findings.push({
      id: "low_volume",
      title: "Few applications in the last month",
      statement: `You sent ${plural(recent, "application", "applications")} in the last 30 days. A small number means few chances to hear back, which may be limiting how many interviews you see.`,
      evidence: [
        `${plural(recent, "application", "applications")} in the last 30 days, ${funnel.applied} in total.`,
      ],
      suggestion:
        "Aim for a steady number each week of jobs that rate Good or better, rather than a burst.",
      href: "/matches",
      weight: 1,
    });
  }

  // 6. A profile that is thin.
  if (input.completeness !== null && input.completeness < 60) {
    findings.push({
      id: "profile_incomplete",
      title: "The profile is still thin",
      statement: `Your profile is ${input.completeness}% complete. A thinner profile gives matching and tailoring less to work with, which may be holding back both.`,
      evidence: [`Profile completeness: ${input.completeness} out of 100.`],
      suggestion:
        "Add projects with real detail and the skills you have used, and confirm anything imported from a resume.",
      href: "/profile",
      weight: 1 + (60 - input.completeness) / 60,
    });
  }

  // 7. Waiting applications nobody followed up on.
  const quiet = applied.filter(
    (a) =>
      a.status === "applied" &&
      daysSince(a.appliedOn ?? a.statusChangedAt, now) >= 7 &&
      !events.some((e) => e.applicationId === a.id && e.kind === "followed_up"),
  );
  if (quiet.length >= 3) {
    findings.push({
      id: "no_follow_up",
      title: "No follow-ups recorded on waiting applications",
      statement: `${plural(quiet.length, "application has", "applications have")} been waiting a week or more with no follow-up recorded. A short, polite note sometimes prompts a reply, though it does not always.`,
      evidence: quiet.slice(0, 4).map((a) => `${a.jobTitle} at ${a.companyName}.`),
      suggestion:
        "Use the follow-up flag on the board to draft a note, then send it yourself and record that you did.",
      href: "/applications",
      weight: 0.8,
    });
  }

  // 8. No outreach at all.
  if (input.outreachSent === 0) {
    findings.push({
      id: "no_outreach",
      title: "No outreach recorded",
      statement:
        "You have not recorded sending any outreach. Reaching a person directly or through a referral may help some applications get noticed, though it is not a guarantee of anything.",
      evidence: ["No outreach drafts are marked as sent."],
      suggestion: "Draft a note for one job you care about. You copy it and send it yourself.",
      href: "/outreach",
      weight: 0.6,
    });
  }

  findings.sort((a, b) => b.weight - a.weight);

  const interviewedShare = funnel.interviewed.pct ?? 0;
  const healthy = interviewedShare >= 25;
  return {
    state: "ready",
    headline: healthy
      ? `You are getting interviews: ${rateText(funnel.interviewed)} of your applications`
      : funnel.interviewed.n === 0
        ? "No interviews from your applications yet"
        : `Interviews are coming in slowly: ${rateText(funnel.interviewed)} of your applications`,
    funnel,
    observations,
    findings: healthy ? findings.slice(0, 2) : findings,
    caveats: [
      ...caveats,
      "These are patterns in what you recorded, not causes. Employers decide for reasons that are not visible here.",
    ],
  };
}
