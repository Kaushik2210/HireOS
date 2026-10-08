import { GraduationCap, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gapTargets, loadAnalytics, type AnalyticsData } from "@/features/analytics/load";
import { requireUser } from "@/lib/auth/session";
import { analyzeGaps, type GapAnalysis } from "@/services/analytics/gaps";

export const metadata: Metadata = { title: "Career Gaps" };
export const dynamic = "force-dynamic";

const card = "border-border bg-surface rounded-lg border p-5";

export default async function GapsPage() {
  const user = await requireUser();

  let data: AnalyticsData | null = null;
  let gaps: GapAnalysis | null = null;
  try {
    data = await loadAnalytics(user);
    gaps = analyzeGaps(data.snapshot, gapTargets(data), data.now);
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not analyse your gaps. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Career Gaps</h1>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 max-w-prose text-sm">
          Which skills would improve the most of your matches. Each one is measured: HireOS
          re-scores the jobs with the skill added and totals the Application Strength gained. The
          skill is never added to your profile for you. Build something real with it first, then add
          it once it is true.
        </p>
      </div>

      {gaps.state === "needs_profile" ? (
        <EmptyState
          icon={GraduationCap}
          title="Build your verified profile first"
          description="Gaps are measured against the skills, projects and roles you have confirmed."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/profile" prefetch={false}>
                Go to your profile
              </Link>
            </Button>
          }
        />
      ) : gaps.state === "no_jobs" ? (
        <EmptyState
          icon={GraduationCap}
          title="No jobs to compare with"
          description="Add a job you found, or show the sample jobs again, then come back."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/jobs" prefetch={false}>
                Go to jobs
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-muted text-xs" data-testid="gap-scope">
            Based on {gaps.jobCount} {gaps.jobCount === 1 ? "job" : "jobs"}: the ones you track,
            then your best matches.
          </p>

          <section aria-labelledby="priorities-heading" className={card}>
            <h2 id="priorities-heading" className="mb-3 text-sm font-semibold">
              Skills worth learning
            </h2>
            {gaps.priorities.length === 0 ? (
              <p className="text-muted text-sm">
                Nothing missing from your verified profile would raise these jobs&apos; scores. That
                is a good sign for this set of jobs.
              </p>
            ) : (
              <ol className="flex flex-col gap-4" data-testid="priorities">
                {gaps.priorities.map((p, i) => (
                  <li
                    key={p.skill}
                    className="border-border rounded-lg border p-4"
                    data-testid={`gap-${p.skill}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {i + 1}. {p.skill}
                      </h3>
                      <span className="text-muted text-xs">
                        +{p.totalGain} Application Strength points across {p.jobs.length}{" "}
                        {p.jobs.length === 1 ? "job" : "jobs"} (about +{p.avgGain} each)
                      </span>
                    </div>
                    <p className="text-muted mt-1 text-xs">
                      Required by {p.requiredIn}, nice to have for {p.preferredIn}.
                    </p>
                    <details className="mt-2">
                      <summary className="text-accent cursor-pointer text-xs">
                        Why? Which jobs gain
                      </summary>
                      <ul className="text-muted mt-2 list-disc space-y-1 pl-5 text-xs">
                        {p.jobs.slice(0, 6).map((j) => (
                          <li key={j.id} className="break-words">
                            <Link
                              href={`/jobs/${j.id}`}
                              prefetch={false}
                              className="hover:underline"
                            >
                              {j.title} at {j.company}
                            </Link>
                            : +{j.gain}
                          </li>
                        ))}
                      </ul>
                    </details>
                    <p className="mt-2 text-sm">
                      Build a small project that really uses {p.skill}, then add it to your profile.
                      {p.canPractise && (
                        <>
                          {" "}
                          <Link
                            href="/interviews"
                            prefetch={false}
                            className="text-accent hover:underline"
                          >
                            Practise {p.skill} questions
                          </Link>
                        </>
                      )}
                    </p>
                    <p className="text-subtle mt-1 text-xs">
                      If you have genuinely used {p.skill} already, add that experience now instead.
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section aria-labelledby="weak-heading" className={card}>
              <h2 id="weak-heading" className="mb-2 text-sm font-semibold">
                Skills to strengthen
              </h2>
              {gaps.weak.length === 0 ? (
                <p className="text-muted text-sm">
                  No beginner-level skill is required by these jobs.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm" data-testid="weak">
                  {gaps.weak.map((w) => (
                    <li key={w.skill}>
                      {w.skill}{" "}
                      <span className="text-muted text-xs">
                        listed at beginner level, required by {w.requiredIn}{" "}
                        {w.requiredIn === 1 ? "job" : "jobs"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="strong-heading" className={card}>
              <h2 id="strong-heading" className="mb-2 text-sm font-semibold">
                Where you are already strong
              </h2>
              {gaps.strengths.length === 0 ? (
                <p className="text-muted text-sm">
                  None of your verified skills is required by these jobs yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm" data-testid="strengths">
                  {gaps.strengths.map((s) => (
                    <li key={s.skill}>
                      {s.skill}{" "}
                      <span className="text-muted text-xs">
                        required by {s.requiredIn} {s.requiredIn === 1 ? "job" : "jobs"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {gaps.experience && (
            <section aria-labelledby="exp-heading" className={card} data-testid="experience-gap">
              <h2 id="exp-heading" className="mb-2 text-sm font-semibold">
                Experience
              </h2>
              <p className="text-muted text-sm">
                {gaps.experience.jobsAskingMore} of these jobs ask for more experience than your
                verified roles add up to (typically about {gaps.experience.typicalYears} years,
                against about {gaps.experience.haveYears} on your profile). Internships, junior
                roles and projects that show the next level can help close this.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
