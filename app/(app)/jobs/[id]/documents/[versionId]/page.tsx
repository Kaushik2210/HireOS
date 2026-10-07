import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDocumentStore } from "@/db/documents";
import type { DocumentVersion } from "@/db/documents/store";
import { getJobStore } from "@/db/jobs";
import { getProfileStore } from "@/db/profile";
import { ResumePreview } from "@/features/tailoring/components/resume-preview";
import {
  ChangesPanel,
  DiffView,
  MissingPanel,
  VerificationNote,
} from "@/features/tailoring/components/panels";
import {
  ApproveButton,
  DeleteVersionButton,
  ExportButtons,
} from "@/features/tailoring/components/version-controls";
import { requireUser } from "@/lib/auth/session";
import type { Job } from "@/lib/jobs/schemas";
import { buildCandidate } from "@/services/matching/candidate";
import { diffCounts, lineDiff } from "@/services/tailoring/diff";

export const metadata: Metadata = { title: "Document version" };
export const dynamic = "force-dynamic";

const KIND_LABEL = { resume: "Resume", cover_letter: "Cover letter" } as const;

const safeName = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export default async function VersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; versionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await params;
  const jobId = z.uuid().safeParse(p.id);
  const versionId = z.uuid().safeParse(p.versionId);
  if (!jobId.success || !versionId.success) notFound();
  const raw = await searchParams;
  const compareId = z.uuid().safeParse(Array.isArray(raw.compare) ? raw.compare[0] : raw.compare);
  const user = await requireUser();

  let job: Job | null = null;
  let version: DocumentVersion | null = null;
  let siblings: DocumentVersion[] = [];
  let currentHash: string | null = null;
  try {
    const store = await getDocumentStore(user);
    [job, version, siblings, currentHash] = await Promise.all([
      getJobStore(user).then((s) => s.get(user.id, jobId.data)),
      store.get(user.id, versionId.data),
      store.list(user.id, { jobId: jobId.data }),
      getProfileStore(user).then(async (s) => buildCandidate(await s.getSnapshot(user.id)).hash),
    ]);
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load this document. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }
  if (!job || !version || version.jobId !== job.id) notFound();

  const same = siblings.filter((s) => s.kind === version.kind && s.id !== version.id);
  const compare = compareId.success ? same.find((s) => s.id === compareId.data) : undefined;
  const diff = compare ? lineDiff(compare.body.split("\n"), version.body.split("\n")) : null;
  const counts = diff ? diffCounts(diff) : null;
  const blocked = !version.verification.ok;
  const stale = currentHash !== null && currentHash !== version.profileHash;
  const label = KIND_LABEL[version.kind];
  const approved = version.status === "approved";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <Link
          prefetch={false}
          href={`/jobs/${job.id}/${version.kind === "resume" ? "tailor" : "cover-letter"}`}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to{" "}
          {version.kind === "resume" ? "tailoring" : "the letter"}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {label} version {version.versionNumber}
          </h1>
          <Badge variant={approved ? "success" : "neutral"}>{version.status}</Badge>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
          {version.content.kind === "cover_letter" && version.content.doc.edited && (
            <Badge variant="warning">Edited by you</Badge>
          )}
        </div>
        <p className="text-muted mt-1 text-sm break-words">
          For{" "}
          <Link prefetch={false} href={`/jobs/${job.id}`} className="hover:underline">
            {job.title} at {job.company_name}
          </Link>
          . Saved{" "}
          {new Date(version.createdAt).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          {approved && version.approvedAt
            ? `, approved ${new Date(version.approvedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}`
            : ""}
          .
        </p>
        {stale && (
          <p
            role="note"
            className="border-warning/40 text-warning mt-3 max-w-prose rounded border p-3 text-xs"
          >
            Your profile has changed since this version was made. It still shows what was saved;
            make a new version to pick up the changes.
          </p>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {diff && counts && compare ? (
            <section aria-labelledby="diff-heading" className="flex flex-col gap-2">
              <h2 id="diff-heading" className="text-sm font-semibold">
                Version {compare.versionNumber} to version {version.versionNumber}:{" "}
                <span className="text-success">{counts.added} added</span>,{" "}
                <span className="text-danger">{counts.removed} removed</span>
              </h2>
              <DiffView lines={diff} />
              <Link
                prefetch={false}
                href={`/jobs/${job.id}/documents/${version.id}`}
                className="text-accent text-xs hover:underline"
              >
                Hide comparison
              </Link>
            </section>
          ) : version.content.kind === "resume" ? (
            <ResumePreview doc={version.content.doc} />
          ) : (
            <article
              aria-label="Cover letter text"
              className="border-border bg-surface rounded-lg border p-5 text-sm leading-relaxed break-words whitespace-pre-wrap"
              data-testid="letter-text"
            >
              {version.body}
            </article>
          )}
        </div>

        <aside className="flex flex-col gap-4" aria-label="Review">
          <VerificationNote verification={version.verification} />
          <div className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Use this version</h3>
            {approved ? (
              <p className="text-muted text-xs">
                Approved. Copy it or download it, then apply on the employer&apos;s own page. HireOS
                never sends anything for you.
              </p>
            ) : (
              <ApproveButton id={version.id} blocked={blocked} />
            )}
            <ExportButtons
              text={version.body}
              filename={`${safeName(`${label}-${job.company_name}-${job.title}`)}-v${version.versionNumber}.txt`}
            />
            {version.kind === "cover_letter" && (
              <Button asChild variant="secondary" size="sm">
                <Link prefetch={false} href={`/jobs/${job.id}/cover-letter?from=${version.id}`}>
                  Edit as a new version
                </Link>
              </Button>
            )}
            {approved && (
              <p className="text-subtle text-xs">
                Approved versions never change. To adjust, save a new version.
              </p>
            )}
            <DeleteVersionButton id={version.id} jobId={job.id} />
          </div>

          {same.length > 0 && (
            <form
              method="get"
              action={`/jobs/${job.id}/documents/${version.id}`}
              className="border-border bg-surface rounded-lg border p-4"
              aria-label="Compare versions"
            >
              <label htmlFor="compare" className="mb-2 block text-sm font-semibold">
                Compare with
              </label>
              <select
                id="compare"
                name="compare"
                defaultValue={compare?.id ?? ""}
                className="border-border-strong bg-background mb-3 h-9 w-full rounded-md border px-2 text-sm"
              >
                {same.map((s) => (
                  <option key={s.id} value={s.id}>
                    Version {s.versionNumber} ({s.status})
                  </option>
                ))}
              </select>
              <Button type="submit" variant="secondary" size="sm">
                Compare
              </Button>
            </form>
          )}

          {version.kind === "resume" && <MissingPanel missing={version.missing} />}
          {version.kind === "resume" && <ChangesPanel changes={version.changes} />}
        </aside>
      </div>
    </div>
  );
}
