import { FileStack, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDocumentStore } from "@/db/documents";
import type { DocumentVersion } from "@/db/documents/store";
import { getJobStore } from "@/db/jobs";
import { requireUser } from "@/lib/auth/session";
import type { Job } from "@/lib/jobs/schemas";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

const KIND_LABEL = { resume: "Resume", cover_letter: "Cover letter" } as const;

export default async function DocumentsPage() {
  const user = await requireUser();

  let versions: DocumentVersion[] = [];
  const jobs = new Map<string, Job>();
  let loadFailed = false;
  try {
    versions = await (await getDocumentStore(user)).list(user.id);
    const jobStore = await getJobStore(user);
    const found = await Promise.all(
      [...new Set(versions.map((v) => v.jobId))].map((id) => jobStore.get(user.id, id)),
    );
    for (const job of found) if (job) jobs.set(job.id, job);
  } catch {
    loadFailed = true;
  }

  const groups = new Map<string, DocumentVersion[]>();
  for (const v of versions) {
    if (!jobs.has(v.jobId)) continue;
    groups.set(v.jobId, [...(groups.get(v.jobId) ?? []), v]);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Documents</h1>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 max-w-prose text-sm">
          Tailored resumes and cover letters you have saved, grouped by job. Approved versions never
          change. Nothing here is sent anywhere: you apply on the employer&apos;s own page.
        </p>
      </div>

      {loadFailed ? (
        <div role="alert" className="border-danger/40 flex items-start gap-3 rounded-lg border p-4">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load your documents. Your data is safe. Reload to try again.
          </p>
        </div>
      ) : groups.size === 0 ? (
        <EmptyState
          icon={FileStack}
          title="No saved documents yet"
          description="Open a job, then tailor your resume or draft a cover letter for it."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/matches">Find a job to tailor for</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4" data-testid="document-groups">
          {[...groups].map(([jobId, list]) => {
            const job = jobs.get(jobId)!;
            return (
              <li key={jobId} className="border-border bg-surface rounded-lg border p-4">
                <Link
                  href={`/jobs/${job.id}`}
                  prefetch={false}
                  className="text-sm font-semibold hover:underline"
                >
                  {job.title}
                </Link>
                <p className="text-muted text-xs">{job.company_name}</p>
                <ul className="divide-border mt-3 divide-y">
                  {list.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <Link
                        href={`/jobs/${job.id}/documents/${v.id}`}
                        prefetch={false}
                        className="hover:underline"
                      >
                        {KIND_LABEL[v.kind]} version {v.versionNumber}
                      </Link>
                      <span className="flex items-center gap-2">
                        {!v.verification.ok && <Badge variant="warning">Needs fixes</Badge>}
                        <Badge variant={v.status === "approved" ? "success" : "neutral"}>
                          {v.status}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
