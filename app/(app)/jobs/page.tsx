/* Filter links on this page are deliberately plain anchors: see JobFilters. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { Briefcase, SearchX, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { getJobStore } from "@/db/jobs";
import type { DemoState } from "@/db/jobs/store";
import { DemoBanner, AddJobDialog } from "@/features/jobs/components/job-controls";
import { JobCard } from "@/features/jobs/components/job-card";
import { JobFilters } from "@/features/jobs/components/job-filters";
import { Pagination } from "@/features/jobs/components/pagination";
import { loadMatchContext } from "@/features/matching/load";
import { requireUser } from "@/lib/auth/session";
import { emptyResult, parseJobQuery, type JobSearchResult } from "@/lib/jobs/schemas";
import type { MatchResult } from "@/lib/matching/types";
import { canScore, scoreJob } from "@/services/matching/score";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseJobQuery(await searchParams);
  const user = await requireUser();

  let result: JobSearchResult = emptyResult(query.page);
  let companies: string[] = [];
  let demo: DemoState = { available: false, hidden: false };
  let loadFailed = false;
  try {
    const store = await getJobStore(user);
    [result, companies, demo] = await Promise.all([
      store.search(user.id, query),
      store.companies(user.id),
      store.demo(user.id),
    ]);
  } catch {
    loadFailed = true;
  }

  // Strength chips are a convenience: if scoring fails the list still renders without them.
  const matches = new Map<string, MatchResult>();
  try {
    const { candidate } = await loadMatchContext(user);
    if (canScore(candidate))
      for (const job of result.jobs) matches.set(job.id, scoreJob(job, candidate));
  } catch {
    matches.clear();
  }

  const filtered = Boolean(
    query.q ||
    query.company ||
    query.work_modes.length ||
    query.job_types.length ||
    query.seniority.length ||
    query.has_salary,
  );
  const pastEnd = result.total > 0 && result.jobs.length === 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-muted mt-1 text-sm">
            Browse and filter roles, or add one you found yourself. HireOS never applies for you:
            each job links to the employer&apos;s own page.
          </p>
        </div>
        <AddJobDialog />
      </div>

      {demo.available && <DemoBanner hidden={demo.hidden} sandbox={user.isDemo} />}

      <JobFilters query={query} companies={companies} />

      {loadFailed ? (
        <div role="alert" className="border-danger/40 flex items-start gap-3 rounded-lg border p-4">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load jobs. Your data is safe. Reload the page to try again.
          </p>
        </div>
      ) : result.total === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No jobs match these filters"
            description="Try fewer filters or different words."
            action={
              <Button asChild variant="secondary" size="sm">
                <a href="/jobs">Clear filters</a>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Briefcase}
            title="No jobs yet"
            description={
              demo.hidden
                ? "Sample jobs are hidden. Show them again above, or add a job you found."
                : "Add a job you found by pasting its description. It stays private to you."
            }
            action={<AddJobDialog />}
          />
        )
      ) : pastEnd ? (
        <EmptyState
          icon={SearchX}
          title="That page does not exist"
          description={`There are ${result.total} matching jobs on ${result.pageCount} pages.`}
          action={
            <Button asChild variant="secondary" size="sm">
              <a href="/jobs">Back to the first page</a>
            </Button>
          }
        />
      ) : (
        <section aria-labelledby="results-heading" className="flex flex-col gap-3">
          <h2 id="results-heading" className="text-sm font-medium" aria-live="polite">
            {result.total} {result.total === 1 ? "job" : "jobs"}
            {filtered ? " match" : ""}
          </h2>
          <ul className="flex flex-col gap-3">
            {result.jobs.map((job) => (
              <JobCard key={job.id} job={job} match={matches.get(job.id)} />
            ))}
          </ul>
          <Pagination query={query} page={result.page} pageCount={result.pageCount} />
        </section>
      )}
    </div>
  );
}
