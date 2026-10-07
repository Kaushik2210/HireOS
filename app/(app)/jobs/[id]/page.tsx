import { ArrowLeft, ExternalLink, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getJobStore } from "@/db/jobs";
import { getMatchStore } from "@/db/matching";
import {
  BuildProfilePrompt,
  JobIntelligence,
} from "@/features/matching/components/job-intelligence";
import { loadMatchContext } from "@/features/matching/load";
import { DeleteJobButton } from "@/features/jobs/components/job-controls";
import { formatJobPay, formatPostedDate, sourceLabel } from "@/features/jobs/format";
import { label } from "@/features/profile/format";
import { requireUser } from "@/lib/auth/session";
import type { Job } from "@/lib/jobs/schemas";
import type { MatchResult } from "@/lib/matching/types";
import { canScore, scoreJob } from "@/services/matching/score";

export const metadata: Metadata = { title: "Job" };
export const dynamic = "force-dynamic";

const card = "border-border bg-surface rounded-lg border p-5";

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-subtle font-mono text-[10px] tracking-wide uppercase">{term}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

function ChipList({ items, tone }: { items: string[]; tone?: "required" | "preferred" }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className={
            tone === "preferred"
              ? "border-border text-muted rounded border border-dashed px-2 py-0.5 text-xs"
              : "border-border-strong rounded border px-2 py-0.5 text-xs"
          }
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Keeps the saved match current. Best effort: the page is correct without it. */
async function saveSnapshot(
  user: Awaited<ReturnType<typeof requireUser>>,
  jobId: string,
  match: MatchResult,
  profileHash: string,
) {
  try {
    const store = await getMatchStore(user);
    const saved = await store.get(user.id, jobId);
    if (
      saved?.profileHash === profileHash &&
      saved.result.scorer_version === match.scorer_version
    ) {
      return;
    }
    await store.save(user.id, jobId, match, profileHash);
  } catch {
    // Not saving only means the next visit tries again.
  }
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const user = await requireUser();

  let job: Job | null = null;
  try {
    job = await (await getJobStore(user)).get(user.id, id.data);
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="text-sm font-semibold">Could not load this job</h1>
            <p className="text-muted mt-1 text-sm">
              Your data is safe. Reload the page, or go back to the list.
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (!job) notFound();

  // Scored live from the verified profile. A failure here must not hide the job itself.
  let match: MatchResult | null = null;
  let pending = 0;
  let matchFailed = false;
  try {
    const context = await loadMatchContext(user);
    pending = context.pending;
    if (canScore(context.candidate)) {
      match = scoreJob(job, context.candidate);
      await saveSnapshot(user, job.id, match, context.candidate.hash);
    }
  } catch {
    matchFailed = true;
  }

  const pay = formatJobPay(job);
  const posted = formatPostedDate(job.posted_at);
  const isOwn = job.owner_user_id !== null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Link
          prefetch={false}
          href="/jobs"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> All jobs
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight break-words">{job.title}</h1>
          {job.is_demo && <Badge variant="accent">Demo data</Badge>}
          {isOwn && <Badge variant="warning">Added by you</Badge>}
        </div>
        <p className="text-muted mt-1 text-sm">
          {job.company_name}
          {job.location ? ` · ${job.location}` : ""}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {job.apply_url ? (
            <Button asChild variant="primary">
              <a href={job.apply_url} target="_blank" rel="noopener noreferrer">
                Open application <ExternalLink />
              </a>
            </Button>
          ) : (
            <span className="text-muted text-sm">No application link was given for this job.</span>
          )}
          <Button asChild variant="secondary">
            <Link href={`/jobs/${job.id}/tailor`} prefetch={false}>
              Tailor resume
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/jobs/${job.id}/cover-letter`} prefetch={false}>
              Cover letter
            </Link>
          </Button>
          {isOwn && <DeleteJobButton jobId={job.id} />}
        </div>
        {job.apply_url && (
          <p className="text-subtle mt-2 text-xs">
            {job.is_demo
              ? "This is a demo job: its link is fictional and goes nowhere. "
              : "Opens the employer's own page in a new tab. "}
            You apply there yourself. HireOS never submits an application for you.
          </p>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {match ? (
            <JobIntelligence match={match} />
          ) : matchFailed ? (
            <p role="alert" className="border-danger/40 text-muted rounded-lg border p-4 text-sm">
              Could not work out Application Strength right now. Reload to try again.
            </p>
          ) : (
            <BuildProfilePrompt pending={pending} />
          )}

          <section aria-labelledby="description-heading" className={card}>
            <h2 id="description-heading" className="mb-3 text-sm font-semibold">
              Description
            </h2>
            {/* Plain text only, rendered as text: pasted markup can never run. */}
            <p className="text-muted text-sm leading-relaxed break-words whitespace-pre-line">
              {job.description}
            </p>
          </section>

          {job.responsibilities.length > 0 && (
            <section aria-labelledby="resp-heading" className={card}>
              <h2 id="resp-heading" className="mb-3 text-sm font-semibold">
                Responsibilities
              </h2>
              <ul className="text-muted list-disc space-y-1.5 pl-5 text-sm">
                {job.responsibilities.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          {job.requirements.length > 0 && (
            <section aria-labelledby="req-heading" className={card}>
              <h2 id="req-heading" className="mb-3 text-sm font-semibold">
                Requirements
              </h2>
              <ul className="text-muted list-disc space-y-1.5 pl-5 text-sm">
                {job.requirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          {(job.required_skills.length > 0 || job.preferred_skills.length > 0) && (
            <section aria-labelledby="skills-heading" className={card}>
              <h2 id="skills-heading" className="mb-3 text-sm font-semibold">
                Skills named in this posting
              </h2>
              {job.required_skills.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-subtle mb-2 font-mono text-[10px] tracking-wide uppercase">
                    Required
                  </h3>
                  <ChipList items={job.required_skills} />
                </div>
              )}
              {job.preferred_skills.length > 0 && (
                <div>
                  <h3 className="text-subtle mb-2 font-mono text-[10px] tracking-wide uppercase">
                    Nice to have
                  </h3>
                  <ChipList items={job.preferred_skills} tone="preferred" />
                </div>
              )}
              <p className="text-subtle mt-4 text-xs">
                Read from the posting&apos;s text by pattern matching, so check it against the
                original.
              </p>
            </section>
          )}
        </div>

        <aside aria-labelledby="details-heading" className={`${card} lg:sticky lg:top-20`}>
          <h2 id="details-heading" className="mb-4 text-sm font-semibold">
            Details
          </h2>
          <dl className="flex flex-col gap-3">
            <Detail term="Pay">{pay || <span className="text-subtle">Not stated</span>}</Detail>
            <Detail term="Work mode">
              {job.work_mode ? (
                label(job.work_mode)
              ) : (
                <span className="text-subtle">Not stated</span>
              )}
            </Detail>
            <Detail term="Job type">
              {job.job_type ? label(job.job_type) : <span className="text-subtle">Not stated</span>}
            </Detail>
            <Detail term="Level">
              {job.seniority ? (
                label(job.seniority)
              ) : (
                <span className="text-subtle">Not stated</span>
              )}
            </Detail>
            <Detail term="Experience asked">
              {job.min_years !== null ? (
                `${job.min_years}+ years`
              ) : (
                <span className="text-subtle">Not stated</span>
              )}
            </Detail>
            <Detail term="Posted">
              {posted || <span className="text-subtle">Not stated</span>}
            </Detail>
            <Detail term="Source">{sourceLabel(job.source_key)}</Detail>
            {job.also_listed_on.length > 0 && (
              <Detail term="Also listed on">
                {job.also_listed_on.map((s) => sourceLabel(s.source_key)).join(", ")}
              </Detail>
            )}
          </dl>
        </aside>
      </div>
    </div>
  );
}
