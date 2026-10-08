import { BarChart3, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BreakdownTable,
  FunnelChart,
  InsightsPanel,
  RateTile,
  WeeklyBars,
} from "@/features/analytics/components/panels";
import { loadAnalytics, type AnalyticsData } from "@/features/analytics/load";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const card = "border-border bg-surface rounded-lg border p-5";

export default async function AnalyticsPage() {
  const user = await requireUser();

  let data: AnalyticsData | null = null;
  try {
    data = await loadAnalytics(user);
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load your analytics. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }

  const { insights } = data;
  const funnel = insights.funnel;
  const finished = data.practice.filter((s) => s.status === "completed");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          {user.isDemo && data.hasSamples && <Badge variant="accent">Includes sample data</Badge>}
        </div>
        <p className="text-muted mt-1 max-w-prose text-sm">
          What your own records show about replies. These are counts and patterns in what you
          entered: they do not predict any outcome, and with few applications they say little.
        </p>
      </div>

      {data.applications.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Nothing to analyse yet"
          description="Track the jobs you apply to and move them through the pipeline. The analysis builds from that history."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/applications" prefetch={false}>
                Go to applications
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <section aria-labelledby="funnel-heading" className={card}>
            <h2 id="funnel-heading" className="mb-4 text-sm font-semibold">
              Your funnel
            </h2>
            <dl className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div
                className="border-border bg-surface rounded-lg border p-3"
                data-testid="rate-applied"
              >
                <dt className="text-subtle font-mono text-[10px] tracking-wide uppercase">
                  Applied
                </dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{funnel.applied}</dd>
              </div>
              <RateTile label="Heard back" rate={funnel.heardBack} />
              <RateTile label="Interviews" rate={funnel.interviewed} />
              <RateTile label="Offers" rate={funnel.offers} />
            </dl>
            {funnel.applied === 0 ? (
              <p className="text-muted text-sm">
                None of your tracked jobs has reached &quot;Applied&quot; yet.
              </p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <FunnelChart funnel={funnel} />
                <div className="text-muted flex flex-col gap-2 text-sm" data-testid="timing">
                  <p>
                    {funnel.medianDaysToResponse === null
                      ? "No application has had a reply yet, so there is no typical wait to show."
                      : `The typical wait for a first reply is ${funnel.medianDaysToResponse} ${funnel.medianDaysToResponse === 1 ? "day" : "days"}.`}
                  </p>
                  <p>
                    {funnel.awaiting.total === 0
                      ? "Nothing is waiting for a first reply."
                      : `${funnel.awaiting.total} ${funnel.awaiting.total === 1 ? "application is" : "applications are"} still waiting for a first reply, ${funnel.awaiting.young} sent in the last two weeks.`}
                  </p>
                  <p>
                    {funnel.rejected} rejected, {funnel.noResponse} marked no response,{" "}
                    {funnel.withdrawn} withdrawn.
                  </p>
                  {funnel.offerAfterInterview.of > 0 && (
                    <p>
                      Of {funnel.offerAfterInterview.of}{" "}
                      {funnel.offerAfterInterview.of === 1 ? "interview" : "interviews"},{" "}
                      {funnel.offerAfterInterview.n} reached an offer.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="weekly-heading" className={card}>
            <h2 id="weekly-heading" className="mb-3 text-sm font-semibold">
              Applications per week
            </h2>
            <WeeklyBars weekly={funnel.weekly} />
          </section>

          <InsightsPanel insights={insights} />

          <div className="grid gap-4 md:grid-cols-2">
            <BreakdownTable
              title="Replies by how well the job fitted"
              note="Using Application Strength today, not at the time you applied."
              groups={data.byStrength}
            />
            <BreakdownTable
              title="Replies by resume"
              note="Whether a saved resume version was linked to the application."
              groups={data.byResume}
            />
          </div>

          <section aria-labelledby="practice-heading" className={card}>
            <h2 id="practice-heading" className="mb-2 text-sm font-semibold">
              Interview practice
            </h2>
            {finished.length === 0 ? (
              <p className="text-muted text-sm">
                No finished practice sessions yet.{" "}
                <Link href="/interviews" prefetch={false} className="text-accent hover:underline">
                  Open the Interview Hub
                </Link>
              </p>
            ) : (
              <p className="text-muted text-sm" data-testid="practice-trend">
                {finished.length} finished {finished.length === 1 ? "session" : "sessions"}. Newest
                first:{" "}
                {finished
                  .slice(0, 6)
                  .map((s) => s.overall)
                  .join(", ")}
                . These describe how your answers were built, not how an interviewer would react.
              </p>
            )}
            <p className="text-muted mt-2 text-sm">
              Outreach recorded as sent: {data.outreachSent}.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
