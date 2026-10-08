import { Network, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadAnalytics } from "@/features/analytics/load";
import { GraphView } from "@/features/graph/components/graph-view";
import { requireUser } from "@/lib/auth/session";
import type { LaidOutGraph } from "@/lib/graph/types";
import type { Job } from "@/lib/jobs/schemas";
import { buildCareerGraph } from "@/services/graph/build";
import { layoutGraph } from "@/services/graph/layout";
import { verifiedSnapshot } from "@/services/profile/verified";

export const metadata: Metadata = { title: "Career Graph" };
export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const user = await requireUser();

  let graph: LaidOutGraph | null = null;
  let hasVerified = false;
  let hasSamples = false;
  try {
    const data = await loadAnalytics(user);
    const v = verifiedSnapshot(data.snapshot);
    hasVerified =
      v.skills.length + v.projects.length + v.experiences.length + v.education.length > 0;
    hasSamples = data.hasSamples;
    // The jobs you track come first, then your best matches, without repeats.
    const seen = new Set<string>();
    const jobs: Job[] = [];
    for (const job of [...data.trackedJobs, ...data.rankedJobs]) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
    }
    graph = layoutGraph(
      buildCareerGraph({
        snapshot: data.snapshot,
        applications: data.applications,
        jobs,
        now: data.now,
      }),
    );
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not build your graph. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Career Graph</h1>
          {user.isDemo && (hasSamples || hasVerified) && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 max-w-prose text-sm">
          How your verified skills, projects and roles connect to the jobs and companies you are
          looking at, and how your applications have gone. Only items you have confirmed appear, and
          a skill a job asks for that you lack is drawn as a separate dashed item, never as
          something you have.
        </p>
      </div>

      {!hasVerified ? (
        <EmptyState
          icon={Network}
          title="Build your verified profile first"
          description="The graph is drawn from the skills, projects and roles you have confirmed."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/profile" prefetch={false}>
                Go to your profile
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {graph.trimmed && (
            <p role="note" className="border-border text-muted rounded-lg border p-3 text-xs">
              Some of your least connected skills are left out so the picture stays readable. They
              are all still on your profile.
            </p>
          )}
          <GraphView graph={graph} />
        </>
      )}
    </div>
  );
}
