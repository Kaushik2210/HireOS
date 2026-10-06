import { Check, CircleAlert } from "lucide-react";
import { ScoreBar } from "@/features/profile/components/completeness-card";
import type { ResumeHealth } from "@/lib/resume/schemas";
import { cn } from "@/lib/utils";

const tone = (score: number) =>
  score >= 80 ? "text-strength-strong" : score >= 55 ? "text-accent" : "text-strength-stretch";

export function HealthCard({ health }: { health: ResumeHealth }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className={cn("text-3xl font-semibold tabular-nums", tone(health.score))}>
            {health.score}
            <span className="text-subtle text-base font-normal">/100</span>
          </span>
          <span className="text-subtle text-xs">Resume health</span>
        </div>
        <ScoreBar score={health.score} label="Resume health" />
        <p className="text-subtle mt-2 text-xs">
          How readable and well-formed the document is. It does not predict whether you will be
          hired.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {health.groups.map((group) => (
          <li key={group.id}>
            <details
              className="group border-border bg-surface-raised rounded-md border"
              open={group.score < 60}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="font-medium">{group.label}</span>
                <span className="flex items-center gap-3">
                  <span className="text-subtle hidden font-mono text-[10px] sm:inline">
                    {group.weight}% of total
                  </span>
                  <span className={cn("w-10 text-right font-mono tabular-nums", tone(group.score))}>
                    {group.score}
                  </span>
                </span>
              </summary>
              <ul className="border-border flex flex-col gap-2.5 border-t px-3 py-3">
                {group.checks.map((check) => {
                  const met = check.progress >= 1;
                  return (
                    <li key={check.id} className="flex gap-2.5 text-sm">
                      {met ? (
                        <Check className="text-success mt-0.5 size-4 shrink-0" aria-label="Met" />
                      ) : (
                        <CircleAlert
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            check.progress >= 0.5 ? "text-strength-stretch" : "text-danger",
                          )}
                          aria-label={check.progress >= 0.5 ? "Partly met" : "Not met"}
                        />
                      )}
                      <div className="min-w-0">
                        <p>
                          <span className="font-medium">{check.label}</span>
                          <span className="text-muted">: {check.evidence}</span>
                        </p>
                        {check.hint && <p className="text-subtle mt-0.5 text-xs">{check.hint}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
