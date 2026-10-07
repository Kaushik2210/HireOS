import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getProfileStore } from "@/db/profile";
import { getResumeStore } from "@/db/resume";
import type { ResumeRecord } from "@/db/resume/store";
import { HealthCard } from "@/features/resume/components/health-card";
import { ParsedPreview } from "@/features/resume/components/parsed-preview";
import { ImportPanel, ResumeToolbar } from "@/features/resume/components/resume-actions";
import { requireUser } from "@/lib/auth/session";
import { buildImportPlan } from "@/services/resume/import";

export const metadata: Metadata = { title: "Resume analysis" };
export const dynamic = "force-dynamic";

const card = "border-border bg-surface rounded-lg border p-5";

export default async function ResumeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const user = await requireUser();

  let resume: ResumeRecord | null = null;
  let plan: ReturnType<typeof buildImportPlan> | null = null;
  try {
    resume = await (await getResumeStore(user)).get(user.id, id.data);
    if (resume) {
      const snapshot = await (await getProfileStore(user)).getSnapshot(user.id);
      plan = buildImportPlan(resume.parsed, snapshot);
    }
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="text-sm font-semibold">Could not load this resume</h1>
            <p className="text-muted mt-1 text-sm">
              Your data is safe. Reload the page, or go back to your resumes.
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (!resume || !plan) notFound();

  const itemCount = plan.total + (plan.profile ? 1 : 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <Link
          prefetch={false}
          href="/resume"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> All resumes
        </Link>
        <h1 className="text-xl font-semibold tracking-tight break-words">{resume.file_name}</h1>
        <p className="text-subtle mt-1 text-xs">
          {resume.kind.toUpperCase()} · {resume.page_count}{" "}
          {resume.page_count === 1 ? "page" : "pages"} · {resume.parsed.stats.words} words
        </p>
        <div className="mt-3">
          <ResumeToolbar resumeId={resume.id} canDownload={resume.has_file} />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="import-heading" className={card}>
            <h2 id="import-heading" className="mb-3 text-sm font-semibold">
              Add to your profile
            </h2>
            <ImportPanel resumeId={resume.id} itemCount={itemCount} />
          </section>

          <section aria-labelledby="parsed-heading" className={card}>
            <h2 id="parsed-heading" className="sr-only">
              Analysis
            </h2>
            <ParsedPreview parsed={resume.parsed} text={resume.extracted_text} />
          </section>
        </div>

        <aside aria-labelledby="health-heading" className={`${card} lg:sticky lg:top-20`}>
          <h2 id="health-heading" className="mb-4 text-sm font-semibold">
            Resume health
          </h2>
          <HealthCard health={resume.health} />
        </aside>
      </div>
    </div>
  );
}
