/* Filter and paging links are plain anchors on purpose: see JobFilters. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { Briefcase, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { z } from "zod";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getJobStore } from "@/db/jobs";
import { JobCard } from "@/features/jobs/components/job-card";
import { BuildProfilePrompt } from "@/features/matching/components/job-intelligence";
import { loadMatchContext } from "@/features/matching/load";
import { requireUser } from "@/lib/auth/session";
import { JOBS_PAGE_SIZE } from "@/lib/jobs/constants";
import { MATCH_LABELS, MATCH_LABEL_TEXT, type MatchLabel } from "@/lib/matching/types";
import { canScore } from "@/services/matching/score";
import { listVisibleJobs, rankJobs, type RankedJob } from "@/services/matching/rank";

export const metadata: Metadata = { title: "Matches" };
export const dynamic = "force-dynamic";

const querySchema = z.object({
  label: z.enum(MATCH_LABELS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function href(label: MatchLabel | undefined, page: number) {
  const params = new URLSearchParams();
  if (label) params.set("label", label);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/matches?${qs}` : "/matches";
}

const linkClass =
  "border-border-strong hover:bg-surface-hover inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm transition-colors";

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = querySchema.parse({ label: first(raw.label), page: first(raw.page) });
  const user = await requireUser();

  let ranked: RankedJob[] = [];
  let scoreable = false;
  let pending = 0;
  let loadFailed = false;
  try {
    const [context, jobs] = await Promise.all([
      loadMatchContext(user),
      getJobStore(user).then((store) => listVisibleJobs(store, user.id)),
    ]);
    pending = context.pending;
    scoreable = canScore(context.candidate);
    if (scoreable) ranked = rankJobs(jobs, context.candidate);
  } catch {
    loadFailed = true;
  }

  const counts = Object.fromEntries(
    MATCH_LABELS.map((l) => [l, ranked.filter((r) => r.match.label === l).length]),
  ) as Record<MatchLabel, number>;
  const shown = query.label ? ranked.filter((r) => r.match.label === query.label) : ranked;
  const pageCount = Math.max(1, Math.ceil(shown.length / JOBS_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const pageItems = shown.slice((page - 1) * JOBS_PAGE_SIZE, page * JOBS_PAGE_SIZE);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Matches</h1>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 max-w-prose text-sm">
          Jobs ranked by Application Strength: how well your verified profile lines up with each
          posting on paper. It is not a prediction of any hiring decision, and unconfirmed profile
          items are never counted.
        </p>
      </div>

      {loadFailed ? (
        <div role="alert" className="border-danger/40 flex items-start gap-3 rounded-lg border p-4">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not rank jobs right now. Your data is safe. Reload the page to try again.
          </p>
        </div>
      ) : !scoreable ? (
        <BuildProfilePrompt pending={pending} />
      ) : ranked.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs to rank yet"
          description="Add a job you found, or show the sample jobs again, then come back."
          action={
            <Button asChild variant="secondary" size="sm">
              <a href="/jobs">Go to jobs</a>
            </Button>
          }
        />
      ) : (
        <>
          <nav aria-label="Filter by match strength" className="flex flex-wrap gap-2">
            <a
              href={href(undefined, 1)}
              aria-current={!query.label ? "true" : undefined}
              className={`${linkClass} ${!query.label ? "bg-surface-hover" : ""}`}
            >
              All <span className="text-muted tabular-nums">{ranked.length}</span>
            </a>
            {MATCH_LABELS.map((l) => (
              <a
                key={l}
                href={href(l, 1)}
                aria-current={query.label === l ? "true" : undefined}
                className={`${linkClass} ${query.label === l ? "bg-surface-hover" : ""}`}
              >
                {MATCH_LABEL_TEXT[l]} <span className="text-muted tabular-nums">{counts[l]}</span>
              </a>
            ))}
          </nav>

          {shown.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No jobs in this band"
              description="Try another filter."
              action={
                <Button asChild variant="secondary" size="sm">
                  <a href="/matches">Show all</a>
                </Button>
              }
            />
          ) : (
            <section aria-labelledby="matches-heading" className="flex flex-col gap-3">
              <h2 id="matches-heading" className="text-sm font-medium" aria-live="polite">
                {shown.length} {shown.length === 1 ? "job" : "jobs"}, best match first
              </h2>
              <ul className="flex flex-col gap-3" data-testid="match-list">
                {pageItems.map(({ job, match }) => (
                  <JobCard key={job.id} job={job} match={match} />
                ))}
              </ul>
              {pageCount > 1 && (
                <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
                  {page > 1 ? (
                    <a href={href(query.label, page - 1)} rel="prev" className={linkClass}>
                      <ChevronLeft className="size-4" aria-hidden="true" /> Previous
                    </a>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  <p className="text-muted text-sm" aria-live="polite">
                    Page {page} of {pageCount}
                  </p>
                  {page < pageCount ? (
                    <a href={href(query.label, page + 1)} rel="next" className={linkClass}>
                      Next <ChevronRight className="size-4" aria-hidden="true" />
                    </a>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </nav>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
