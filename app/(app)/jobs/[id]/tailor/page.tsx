import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { BuildProfilePrompt } from "@/features/matching/components/job-intelligence";
import { ItemPicker } from "@/features/tailoring/components/item-picker";
import {
  ChangesPanel,
  MissingPanel,
  VerificationNote,
} from "@/features/tailoring/components/panels";
import { ResumePreview } from "@/features/tailoring/components/resume-preview";
import { SaveResumeButton } from "@/features/tailoring/components/version-controls";
import { loadTailorContext, type TailorContext } from "@/features/tailoring/load";
import { requireUser } from "@/lib/auth/session";
import { buildResume } from "@/services/tailoring/resume";
import { excludedFrom, pickableSections } from "@/services/tailoring/pick";
import { verifyResume } from "@/services/tailoring/verify";

export const metadata: Metadata = { title: "Tailor resume" };
export const dynamic = "force-dynamic";

const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export default async function TailorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const raw = await searchParams;
  const user = await requireUser();

  let ctx: TailorContext;
  try {
    ctx = await loadTailorContext(user, id.data, "resume");
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
  const { job, snapshot } = ctx;
  if (!job) notFound();

  const master = buildResume(snapshot, null);
  const sections = master.ok ? pickableSections(master.doc) : [];
  // `f=1` means the picker was submitted: whatever is not ticked is left out.
  const excluded = new Set(raw.f ? excludedFrom(sections, many(raw.keep)) : []);
  const built = buildResume(snapshot, job, { exclude: excluded });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <Link
          href={`/jobs/${job.id}`}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to the job
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Tailor your resume</h1>
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 text-sm break-words">
          For {job.title} at {job.company_name}.
        </p>
        <p className="text-muted mt-2 max-w-prose text-xs">
          Tailoring chooses which of your verified items to show and puts the most relevant first.
          Every line is copied unchanged from your profile, so nothing is invented. Rewriting
          wording with an AI model is Planned.
        </p>
      </div>

      {!built.ok ? (
        <BuildProfilePrompt pending={ctx.pending} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <ResumePreview doc={built.doc} />
          </div>
          <aside className="flex flex-col gap-4" aria-label="Review">
            <VerificationNote verification={verifyResume(built.doc, snapshot)} />
            <div className="border-border bg-surface rounded-lg border p-4">
              <h3 className="mb-1 text-sm font-semibold">Save this version</h3>
              <p className="text-muted mb-3 text-xs">
                Saving makes a numbered draft you can compare, approve and copy. Nothing is sent
                anywhere: you apply on the employer&apos;s page yourself.
              </p>
              <SaveResumeButton
                jobId={job.id}
                exclude={[...excluded]}
                parentId={ctx.versions[0]?.id ?? null}
              />
              {ctx.versions.length > 0 && (
                <div className="border-border mt-4 border-t pt-3">
                  <p className="text-subtle mb-1.5 font-mono text-[10px] tracking-wide uppercase">
                    Saved versions
                  </p>
                  <ul className="flex flex-col gap-1.5" data-testid="saved-versions">
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
                </div>
              )}
            </div>
            <MissingPanel missing={built.missing} />
            <ChangesPanel changes={built.changes} />
            <ItemPicker jobId={job.id} sections={sections} excluded={excluded} />
          </aside>
        </div>
      )}
    </div>
  );
}
