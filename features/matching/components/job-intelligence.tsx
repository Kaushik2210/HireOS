import { CircleAlert, CircleCheck, Lightbulb, Target } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreBar, StrengthChip } from "@/features/matching/components/strength";
import { MATCH_LABEL_TEXT, labelFor, type MatchResult } from "@/lib/matching/types";

const card = "border-border bg-surface rounded-lg border p-5";

function Heading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mb-3 text-sm font-semibold">
      {children}
    </h3>
  );
}

/** Shown when nothing in the profile is verified yet, so there is nothing to score. */
export function BuildProfilePrompt({ pending }: { pending: number }) {
  return (
    <section aria-labelledby="intel-heading" className={card}>
      <h2 id="intel-heading" className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Target className="text-accent size-4" aria-hidden="true" /> Job Intelligence
      </h2>
      <p className="text-muted text-sm">
        Application Strength is worked out from your <strong>verified</strong> profile, and there is
        nothing verified to use yet.
        {pending > 0
          ? ` You have ${pending} item${pending === 1 ? "" : "s"} waiting for review.`
          : " Add your skills, projects and experience, or import a resume."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="primary" size="sm">
          <Link prefetch={false} href="/profile">
            {pending > 0 ? "Review your profile" : "Build your profile"}
          </Link>
        </Button>
        {pending === 0 && (
          <Button asChild variant="secondary" size="sm">
            <Link prefetch={false} href="/resume">
              Import a resume
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}

export function JobIntelligence({ match }: { match: MatchResult }) {
  return (
    <section aria-labelledby="intel-heading" className="flex flex-col gap-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="intel-heading" className="flex items-center gap-2 text-sm font-semibold">
              <Target className="text-accent size-4" aria-hidden="true" /> Job Intelligence
            </h2>
            <p className="text-muted mt-1 max-w-prose text-xs">
              Application Strength compares your verified profile with what this posting asks for.
              It describes the match on paper and is not a prediction of any hiring decision.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p className="text-3xl font-semibold tabular-nums" data-testid="strength-value">
              {match.strength}
              <span className="text-subtle text-sm font-normal"> / 100</span>
            </p>
            <StrengthChip strength={match.strength} label={match.label} />
          </div>
        </div>
        <ScoreBar
          className="mt-4"
          value={match.strength}
          label={match.label}
          name={`Application Strength ${match.strength} out of 100, ${MATCH_LABEL_TEXT[match.label]}`}
        />
        {match.cap.applied && match.cap.reason && (
          <p className="border-warning/40 text-warning mt-4 rounded border p-3 text-xs" role="note">
            {match.cap.reason}
          </p>
        )}
        <div className="border-border mt-4 flex items-start gap-2 border-t pt-4">
          <Lightbulb className="text-accent mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="text-sm" data-testid="recommended-action">
            {match.action.text}
          </p>
        </div>
      </div>

      <div className={card}>
        <Heading id="breakdown-heading">How the score is made</Heading>
        <ul className="flex flex-col gap-4" aria-labelledby="breakdown-heading">
          {match.components.map((c) => (
            <li key={c.id} data-testid={`component-${c.id}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{c.label}</span>
                <span className="text-muted font-mono text-xs tabular-nums">
                  {c.applicable ? `${c.score} / 100` : "Not scored"} · weight {c.weight}
                </span>
              </div>
              {c.applicable && c.score !== null ? (
                <ScoreBar
                  className="mt-1.5"
                  value={c.score}
                  label={labelFor(c.score)}
                  name={c.label}
                />
              ) : null}
              <p className="text-muted mt-1.5 text-xs">{c.summary}</p>
              {c.inputs.length > 0 && (
                <details className="mt-1.5">
                  <summary className="text-accent cursor-pointer text-xs">Inputs used</summary>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                    {c.inputs.map((input) => (
                      <div key={input.label} className="contents">
                        <dt className="text-subtle">{input.label}</dt>
                        <dd className="break-words">{input.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          ))}
        </ul>
        <p className="text-subtle mt-4 text-xs">
          Components the posting gives no basis for are left out and the rest are rescaled, so a job
          is never marked down for something it does not ask.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={card}>
          <Heading id="why-heading">Why you match</Heading>
          {match.why.length > 0 ? (
            <ul aria-labelledby="why-heading" className="flex flex-col gap-2.5">
              {match.why.map((w) => (
                <li key={w.text} className="flex items-start gap-2 text-sm">
                  <CircleCheck className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{w.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-sm">
              Nothing in your verified profile lines up with this job yet.
            </p>
          )}
        </div>

        <div className={card}>
          <Heading id="gaps-heading">Gaps and what is missing</Heading>
          {match.gaps.length > 0 ? (
            <ul aria-labelledby="gaps-heading" className="flex flex-col gap-3" data-testid="gaps">
              {match.gaps.map((g) => (
                <li key={g.text} className="flex items-start gap-2 text-sm">
                  <CircleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {g.text}
                    {g.suggestion && (
                      <span className="text-muted block text-xs">{g.suggestion}</span>
                    )}
                    {g.severity === "high" && (
                      <Badge variant="warning" className="mt-1">
                        Biggest gap
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-sm">No gaps found against this posting.</p>
          )}
        </div>
      </div>

      {(match.keywords.covered.length > 0 || match.keywords.missing.length > 0) && (
        <div className={card}>
          <Heading id="keywords-heading">Keywords from the posting</Heading>
          <div className="flex flex-col gap-3">
            {match.keywords.covered.length > 0 && (
              <div>
                <p className="text-subtle mb-1.5 font-mono text-[10px] tracking-wide uppercase">
                  Covered by your profile
                </p>
                <ul className="flex flex-wrap gap-1.5" data-testid="keywords-covered">
                  {match.keywords.covered.map((k) => (
                    <li
                      key={k}
                      className="border-success/40 text-success rounded border px-2 py-0.5 text-xs"
                    >
                      {k}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {match.keywords.missing.length > 0 && (
              <div>
                <p className="text-subtle mb-1.5 font-mono text-[10px] tracking-wide uppercase">
                  Not found in your verified profile
                </p>
                <ul className="flex flex-wrap gap-1.5" data-testid="keywords-missing">
                  {match.keywords.missing.map((k) => (
                    <li
                      key={k}
                      className="border-border-strong text-muted rounded border border-dashed px-2 py-0.5 text-xs"
                    >
                      {k}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="text-subtle mt-3 text-xs">
            Add a keyword to your resume only where it is true. HireOS never adds experience you do
            not have.
          </p>
        </div>
      )}

      {match.concerns.length > 0 && (
        <div className={card}>
          <Heading id="concerns-heading">Things to consider</Heading>
          <ul
            aria-labelledby="concerns-heading"
            className="text-muted list-disc space-y-1.5 pl-5 text-sm"
          >
            {match.concerns.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
