import { FileText, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { getResumeStore } from "@/db/resume";
import type { ResumeSummary } from "@/db/resume/store";
import { UploadForm } from "@/features/resume/components/upload-form";
import { requireUser } from "@/lib/auth/session";
import { MAX_RESUMES_PER_USER } from "@/lib/resume/constants";

export const metadata: Metadata = { title: "Resume" };
export const dynamic = "force-dynamic";

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );

export default async function ResumePage() {
  const user = await requireUser();

  let resumes: ResumeSummary[] = [];
  let loadFailed = false;
  try {
    resumes = await (await getResumeStore(user)).list(user.id);
  } catch {
    loadFailed = true;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Resume</h1>
        <p className="text-muted mt-1 text-sm">
          Upload a resume to see how a tracking system reads it, check its health, and pull your
          details into your profile.
        </p>
      </div>

      {user.isDemo && (
        <p className="border-accent/30 bg-accent-soft text-muted rounded-lg border p-3 text-sm">
          <Badge variant="accent" className="mr-2">
            Demo mode
          </Badge>
          Your file is analysed and then discarded. Only the analysis is kept, for this browser
          session. Use a sample or fictional resume.
        </p>
      )}

      {resumes.length >= MAX_RESUMES_PER_USER ? (
        <p
          role="status"
          className="border-border-strong text-muted rounded-md border px-3 py-2 text-sm"
        >
          You have {MAX_RESUMES_PER_USER} resumes, the maximum. Delete one to upload another.
        </p>
      ) : (
        <UploadForm />
      )}

      <section aria-labelledby="your-resumes">
        <h2 id="your-resumes" className="mb-3 text-sm font-semibold">
          Your resumes
          <span className="text-subtle ml-2 font-mono text-xs font-normal">{resumes.length}</span>
        </h2>

        {loadFailed ? (
          <div
            role="alert"
            className="border-danger/40 flex items-start gap-3 rounded-lg border p-4"
          >
            <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p className="text-muted text-sm">
              Could not load your resumes. Your data is safe. Reload the page to try again.
            </p>
          </div>
        ) : resumes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No resumes yet"
            description="Upload your resume above. The original stays private to you, and you can delete it any time."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {resumes.map((r) => (
              <li key={r.id}>
                <Link
                  prefetch={false}
                  href={`/resume/${r.id}`}
                  className="border-border bg-surface hover:bg-surface-hover flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.file_name}</p>
                    <p className="text-subtle mt-0.5 text-xs">
                      {r.kind.toUpperCase()} · {formatSize(r.size_bytes)} · {r.page_count}{" "}
                      {r.page_count === 1 ? "page" : "pages"} · {formatDate(r.created_at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold tabular-nums">{r.health_score}</p>
                    <p className="text-subtle text-[10px] tracking-wide uppercase">Health</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
