import { ChevronLeft, ChevronRight } from "lucide-react";
import { jobQueryToParams, type JobQuery } from "@/lib/jobs/schemas";

function href(query: JobQuery, page: number) {
  const params = jobQueryToParams(query, { page });
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}

const linkClass =
  "border-border-strong hover:bg-surface-hover inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm transition-colors";

export function Pagination({
  query,
  page,
  pageCount,
}: {
  query: JobQuery;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <a href={href(query, page - 1)} rel="prev" className={linkClass}>
          <ChevronLeft className="size-4" aria-hidden="true" /> Previous
        </a>
      ) : (
        <span aria-hidden="true" />
      )}
      <p className="text-muted text-sm" aria-live="polite">
        Page {page} of {pageCount}
      </p>
      {page < pageCount ? (
        <a href={href(query, page + 1)} rel="next" className={linkClass}>
          Next <ChevronRight className="size-4" aria-hidden="true" />
        </a>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
