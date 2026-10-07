import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-field";
import { label } from "@/features/profile/format";
import {
  JOB_SORTS,
  JOB_SORT_LABELS,
  JOB_TYPES,
  SENIORITY_LEVELS,
  WORK_MODES,
} from "@/lib/jobs/constants";
import type { JobQuery } from "@/lib/jobs/schemas";

const field = "flex flex-col gap-1.5 text-sm";
const caption = "text-subtle font-mono text-[10px] tracking-wide uppercase";

/**
 * A plain GET form: filters live in the URL, so a search is a shareable link, the back button
 * works, and nothing needs JavaScript. Changing any filter starts again from page 1.
 */
export function JobFilters({ query, companies }: { query: JobQuery; companies: string[] }) {
  const active =
    Boolean(query.q) ||
    Boolean(query.company) ||
    query.work_modes.length > 0 ||
    query.job_types.length > 0 ||
    query.seniority.length > 0 ||
    query.has_salary ||
    query.sort !== "newest";

  return (
    <form
      method="get"
      action="/jobs"
      role="search"
      aria-label="Search and filter jobs"
      className="border-border bg-surface flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className={`${field} lg:col-span-2`}>
          <span className={caption}>Search</span>
          <Input
            name="q"
            type="search"
            defaultValue={query.q ?? ""}
            placeholder="Title, company, skill or keyword"
            maxLength={100}
            autoComplete="off"
          />
        </label>
        <label className={field}>
          <span className={caption}>Company</span>
          <Input
            name="company"
            list="job-companies"
            defaultValue={query.company ?? ""}
            placeholder="Any company"
            maxLength={150}
            autoComplete="off"
          />
          <datalist id="job-companies">
            {companies.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label className={field}>
          <span className={caption}>Sort by</span>
          <Select name="sort" defaultValue={query.sort}>
            {JOB_SORTS.map((s) => (
              <option key={s} value={s}>
                {JOB_SORT_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className={field}>
          <span className={caption}>Work mode</span>
          <Select name="work_mode" defaultValue={query.work_modes[0] ?? ""}>
            <option value="">Any</option>
            {WORK_MODES.map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </Select>
        </label>
        <label className={field}>
          <span className={caption}>Job type</span>
          <Select name="job_type" defaultValue={query.job_types[0] ?? ""}>
            <option value="">Any</option>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </Select>
        </label>
        <label className={field}>
          <span className={caption}>Level</span>
          <Select name="seniority" defaultValue={query.seniority[0] ?? ""}>
            <option value="">Any</option>
            {SENIORITY_LEVELS.map((l) => (
              <option key={l} value={l}>
                {label(l)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="has_salary"
            value="1"
            defaultChecked={query.has_salary}
            className="accent-accent size-4"
          />
          Only jobs that state pay
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm">
          Search
        </Button>
        {active && (
          // Plain link on purpose: the filters are a GET form that reloads the page, and a full
          // load is more robust here than a client-side transition racing a prefetch.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/jobs" className="text-muted hover:text-foreground text-sm">
            Clear filters
          </a>
        )}
      </div>
    </form>
  );
}
