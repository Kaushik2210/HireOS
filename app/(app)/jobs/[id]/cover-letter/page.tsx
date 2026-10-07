import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { BuildProfilePrompt } from "@/features/matching/components/job-intelligence";
import { LetterEditor } from "@/features/tailoring/components/version-controls";
import { loadTailorContext, type TailorContext } from "@/features/tailoring/load";
import { requireUser } from "@/lib/auth/session";
import { buildCoverLetter } from "@/services/tailoring/cover-letter";

export const metadata: Metadata = { title: "Cover letter" };
export const dynamic = "force-dynamic";

export default async function CoverLetterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const raw = await searchParams;
  const from = z.uuid().safeParse(Array.isArray(raw.from) ? raw.from[0] : raw.from);
  const user = await requireUser();

  let ctx: TailorContext;
  try {
    ctx = await loadTailorContext(user, id.data, "cover_letter");
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load this page. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }
  const { job } = ctx;
  if (!job) notFound();

  const built = buildCoverLetter(ctx.snapshot, job);
  // Start from a saved version when asked, so edits build on the last wording.
  const base = from.success ? ctx.versions.find((v) => v.id === from.data) : undefined;
  const initialText = base ? base.body : built.ok ? built.doc.text : "";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href={`/jobs/${job.id}`}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to the job
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Cover letter</h1>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 text-sm break-words">
          For {job.title} at {job.company_name}.
        </p>
        <p className="text-muted mt-2 max-w-prose text-xs">
          This draft quotes your own verified projects and roles and names only skills you have. It
          says nothing about enthusiasm, years or results that your profile does not hold. Add your
          own wording below, then review it before using it. Rewriting with an AI model is Planned.
        </p>
      </div>

      {!built.ok ? (
        <BuildProfilePrompt pending={ctx.pending} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_16rem]">
          <div className="border-border bg-surface rounded-lg border p-5">
            <LetterEditor
              key={base?.id ?? "generated"}
              jobId={job.id}
              initialText={initialText}
              parentId={base?.id ?? ctx.versions[0]?.id ?? null}
            />
          </div>
          <aside
            className="border-border bg-surface rounded-lg border p-4"
            aria-label="Saved letters"
          >
            <h2 className="mb-2 text-sm font-semibold">Saved letters</h2>
            {ctx.versions.length === 0 ? (
              <p className="text-muted text-xs">None yet. Saving creates a numbered draft.</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="saved-versions">
                {ctx.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link
                      href={`/jobs/${job.id}/documents/${v.id}`}
                      prefetch={false}
                      className="hover:underline"
                    >
                      Version {v.versionNumber}
                    </Link>
                    <Badge variant={v.status === "approved" ? "success" : "neutral"}>
                      {v.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
