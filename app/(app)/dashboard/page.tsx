import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { getApplicationStore } from "@/db/applications";
import type { Application, ApplicationEvent } from "@/db/applications/store";
import { getJobStore } from "@/db/jobs";
import { getProfileStore } from "@/db/profile";
import {
  PipelineSummaryPanel,
  TodayPanel,
} from "@/features/applications/components/dashboard-panels";
import { InsightsPanel, ReadinessPanel } from "@/features/analytics/components/panels";
import { loadAnalytics, type AnalyticsData } from "@/features/analytics/load";
import { TopOpportunities } from "@/features/matching/components/top-opportunities";
import { loadMatchContext } from "@/features/matching/load";
import { CompletenessCard } from "@/features/profile/components/completeness-card";
import { requireUser } from "@/lib/auth/session";
import { getCapabilities } from "@/lib/env";
import { dueFollowUps, summarize } from "@/services/applications/followups";
import { canScore } from "@/services/matching/score";
import { listVisibleJobs, rankJobs, type RankedJob } from "@/services/matching/rank";
import type { Candidate } from "@/services/matching/candidate";
import { computeCompleteness, type Completeness } from "@/services/profile/completeness";
import { pendingCount } from "@/services/profile/verified";

export const metadata: Metadata = { title: "Dashboard" };

// Capabilities depend on runtime environment variables, so never prerender.
export const dynamic = "force-dynamic";

function StatusRow({
  label,
  ok,
  okText,
  offText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  offText: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-muted text-sm">{label}</span>
      <Badge variant={ok ? "success" : "neutral"}>{ok ? okText : offText}</Badge>
    </li>
  );
}

export default async function DashboardPage() {
  const caps = getCapabilities();
  const user = await requireUser();

  let completeness: Completeness | null = null;
  let pending = 0;
  try {
    const snapshot = await (await getProfileStore(user)).getSnapshot(user.id);
    completeness = computeCompleteness(snapshot);
    pending = pendingCount(snapshot);
  } catch {
    completeness = null; // shown as an inline error below; the rest of the page still works
  }

  let candidate: Candidate | null = null;
  let ranked: RankedJob[] = [];
  let matchPending = 0;
  let matchesFailed = false;
  try {
    const context = await loadMatchContext(user);
    candidate = context.candidate;
    matchPending = context.pending;
    if (canScore(candidate)) {
      const jobs = await listVisibleJobs(await getJobStore(user), user.id);
      ranked = rankJobs(jobs, candidate);
    }
  } catch {
    matchesFailed = true;
  }

  // Insights and readiness are extras: if they fail the rest of the dashboard still works.
  let insightsData: AnalyticsData | null = null;
  try {
    insightsData = await loadAnalytics(user);
  } catch {
    insightsData = null;
  }

  let applications: Application[] = [];
  let activity: ApplicationEvent[] = [];
  let pipelineFailed = false;
  try {
    const store = await getApplicationStore(user);
    [applications, activity] = await Promise.all([store.list(user.id), store.activity(user.id)]);
  } catch {
    pipelineFailed = true;
  }
  const followUps = dueFollowUps(applications, activity, new Date());
  const trackedJobs = new Set(applications.map((a) => a.jobId));
  const untracked = ranked.filter(
    (r) => (r.match.label === "strong" || r.match.label === "good") && !trackedJobs.has(r.job.id),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted mt-1 text-sm">
          Your career command center. Modules appear here as they are built.
        </p>
      </div>

      <section
        aria-labelledby="completeness"
        className="border-border bg-surface rounded-lg border p-4"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="completeness" className="text-sm font-medium">
            Profile completeness
          </h2>
          <div className="flex items-center gap-2">
            {user.isDemo && <Badge variant="accent">Demo data</Badge>}
            <Link
              prefetch={false}
              href="/profile"
              className="text-accent text-xs underline underline-offset-2 hover:no-underline"
            >
              Open profile
            </Link>
          </div>
        </div>
        {completeness ? (
          <CompletenessCard completeness={completeness} pending={pending} />
        ) : (
          <p role="alert" className="text-danger text-sm">
            Could not load your profile right now. Reload to try again.
          </p>
        )}
      </section>

      <section
        aria-labelledby="system-status"
        className="border-border bg-surface rounded-lg border p-4"
      >
        <h2 id="system-status" className="text-sm font-medium">
          System status
        </h2>
        <ul className="divide-border mt-2 divide-y">
          <StatusRow
            label="Data backend (Supabase)"
            ok={caps.supabase}
            okText="Configured"
            offText="Not configured"
          />
          <StatusRow
            label="AI backend (LLM provider)"
            ok={caps.llm}
            okText="Configured"
            offText="Configure API key"
          />
          <StatusRow
            label="Background jobs (Inngest)"
            ok={caps.backgroundJobs}
            okText="Configured"
            offText="Not configured"
          />
          <StatusRow
            label="Email drafts delivery (Resend)"
            ok={caps.email}
            okText="Configured"
            offText="Not configured"
          />
        </ul>
        {caps.demoMode && (
          <p className="text-muted mt-3 text-xs">
            Running without a data backend. Demo data arrives with the jobs phase; AI features stay
            disabled until an API key is set.
          </p>
        )}
      </section>

      <section
        aria-labelledby="top-opportunities"
        className="border-border bg-surface rounded-lg border p-4"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="top-opportunities" className="text-sm font-medium">
            Top opportunities
          </h2>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        {matchesFailed ? (
          <p role="alert" className="text-danger text-sm">
            Could not rank jobs right now. Reload to try again.
          </p>
        ) : (
          <TopOpportunities ranked={ranked} candidate={candidate} pending={matchPending} />
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-labelledby="pipeline-summary"
          className="border-border bg-surface rounded-lg border p-4"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="pipeline-summary" className="text-sm font-medium">
              Pipeline summary
            </h2>
            {user.isDemo && applications.some((a) => a.isDemo) && (
              <Badge variant="accent">Demo data</Badge>
            )}
          </div>
          {pipelineFailed ? (
            <p role="alert" className="text-danger text-sm">
              Could not load your pipeline. Reload to try again.
            </p>
          ) : (
            <PipelineSummaryPanel summary={summarize(applications)} />
          )}
        </section>
        <section
          aria-labelledby="today-actions"
          className="border-border bg-surface rounded-lg border p-4"
        >
          <h2 id="today-actions" className="mb-4 text-sm font-medium">
            Today&apos;s actions
          </h2>
          {pipelineFailed ? (
            <p role="alert" className="text-danger text-sm">
              Could not load your actions. Reload to try again.
            </p>
          ) : (
            <TodayPanel followUps={followUps} applications={applications} untracked={untracked} />
          )}
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-labelledby="readiness-heading"
          className="border-border bg-surface rounded-lg border p-4"
        >
          <h2 id="readiness-heading" className="mb-4 text-sm font-medium">
            Career readiness
          </h2>
          {insightsData ? (
            <ReadinessPanel readiness={insightsData.readiness} />
          ) : (
            <p role="alert" className="text-danger text-sm">
              Could not measure readiness. Reload to try again.
            </p>
          )}
        </section>
        <div className="flex flex-col gap-4">
          {insightsData ? (
            <InsightsPanel insights={insightsData.insights} compact />
          ) : (
            <section className="border-border bg-surface rounded-lg border p-4">
              <p role="alert" className="text-danger text-sm">
                Could not load your insights. Reload to try again.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
