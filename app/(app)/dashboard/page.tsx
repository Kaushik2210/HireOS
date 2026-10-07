import { Activity, Lightbulb } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/states/empty-state";
import { Badge, PlannedBadge } from "@/components/ui/badge";
import Link from "next/link";
import { getApplicationStore } from "@/db/applications";
import type { Application, ApplicationEvent } from "@/db/applications/store";
import { getJobStore } from "@/db/jobs";
import { getProfileStore } from "@/db/profile";
import {
  PipelineSummaryPanel,
  TodayPanel,
} from "@/features/applications/components/dashboard-panels";
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

const PLANNED_PANELS = [
  {
    title: "Career readiness",
    description: "Readiness score built from your profile, resume health and skill coverage.",
    icon: Activity,
    phase: 4,
  },
  {
    title: "Career insights",
    description: "Evidence-backed recommendations drawn from your own data.",
    icon: Lightbulb,
    phase: 11,
  },
] as const;

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
            <Link prefetch={false} href="/profile" className="text-accent text-xs hover:underline">
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

      <section aria-labelledby="modules" className="flex flex-col gap-3">
        <h2 id="modules" className="text-sm font-medium">
          Coming to this dashboard
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLANNED_PANELS.map((panel) => (
            <div
              key={panel.title}
              className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{panel.title}</h3>
                <PlannedBadge phase={panel.phase} />
              </div>
              <EmptyState
                icon={panel.icon}
                title="Not available yet"
                description={panel.description}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
