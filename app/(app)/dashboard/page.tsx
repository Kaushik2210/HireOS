import { Activity, BarChart3, Briefcase, Lightbulb, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/states/empty-state";
import { Badge, PlannedBadge } from "@/components/ui/badge";
import Link from "next/link";
import { getProfileStore } from "@/db/profile";
import { CompletenessCard } from "@/features/profile/components/completeness-card";
import { requireUser } from "@/lib/auth/session";
import { getCapabilities } from "@/lib/env";
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
    title: "Pipeline summary",
    description: "Applications by stage, from discovered to offer.",
    icon: BarChart3,
    phase: 9,
  },
  {
    title: "Top opportunities",
    description: "Highest Application Strength jobs with skill match and missing skills.",
    icon: Briefcase,
    phase: 6,
  },
  {
    title: "Today's actions",
    description: "Follow-ups due, new high-match jobs, and resumes you can improve.",
    icon: ListChecks,
    phase: 9,
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
            <Link href="/profile" className="text-accent text-xs hover:underline">
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
