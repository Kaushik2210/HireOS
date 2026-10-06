import Link from "next/link";
import type { Completeness } from "@/services/profile/completeness";
import { cn } from "@/lib/utils";

/** Where each criterion is fixed on the profile page. */
export const CRITERION_ANCHOR: Record<string, string> = {
  name: "#profile",
  headline: "#profile",
  summary: "#profile",
  location: "#profile",
  links: "#profile",
  preferences: "#profile",
  education: "#education",
  experience: "#experiences",
  impact: "#experiences",
  projects: "#projects",
  skills: "#skills",
  "skill-breadth": "#skills",
  certifications: "#certifications",
  goals: "#goals",
};

export function ScoreBar({ score, label }: { score: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      className="bg-surface-raised h-2 w-full overflow-hidden rounded-full"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          score >= 80 ? "bg-strength-strong" : "bg-accent",
        )}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export function CompletenessCard({
  completeness,
  showAll = false,
  profileHref = "/profile",
}: {
  completeness: Completeness;
  /** Show every criterion with its evidence (profile page) instead of just next steps. */
  showAll?: boolean;
  profileHref?: string;
}) {
  const { score, criteria, nextSteps } = completeness;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums">{score}%</span>
          <span className="text-subtle text-xs">of a complete profile</span>
        </div>
        <ScoreBar score={score} label="Profile completeness" />
      </div>

      {nextSteps.length > 0 ? (
        <div>
          <h4 className="text-subtle mb-2 font-mono text-[10px] tracking-wide uppercase">
            Next steps
          </h4>
          <ul className="flex flex-col gap-2 text-sm">
            {nextSteps.map((step) => (
              <li key={step.id}>
                <Link
                  href={`${profileHref}${CRITERION_ANCHOR[step.id] ?? ""}`}
                  className="text-muted hover:text-foreground hover:underline"
                >
                  {step.hint}
                </Link>
                <span className="text-subtle ml-1.5 text-xs">
                  +{Math.round(step.weight * (1 - step.progress))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-success text-sm">Your profile is complete.</p>
      )}

      {showAll && (
        <details className="group">
          <summary className="text-muted hover:text-foreground cursor-pointer text-sm">
            How this is calculated
          </summary>
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            {criteria.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between gap-3">
                <span>
                  <span className="text-foreground">{c.label}</span>
                  <span className="text-subtle ml-2">{c.evidence}</span>
                </span>
                <span className="text-subtle shrink-0 font-mono">
                  {Math.round(c.weight * c.progress)}/{c.weight}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-subtle mt-3 text-xs">
            Counts only items you entered or confirmed. This measures how complete your profile is,
            not your chances of being hired.
          </p>
        </details>
      )}
    </div>
  );
}
