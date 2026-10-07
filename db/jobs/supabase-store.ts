import type { SupabaseClient } from "@supabase/supabase-js";
import {
  JobStoreError,
  type DemoState,
  type JobStore,
  type PrivateJobInput,
} from "@/db/jobs/store";
import { JOBS_PAGE_SIZE } from "@/lib/jobs/constants";
import { storedJobSchema, type Job, type JobQuery, type JobSearchResult } from "@/lib/jobs/schemas";

type Row = Record<string, unknown>;

const UNIQUE_VIOLATION = "23505";

function fail(error: { code?: string; message?: string } | null): never {
  if (error?.code === UNIQUE_VIOLATION) throw new JobStoreError("duplicate");
  // Raised by the private-job limit trigger.
  if (error?.message?.includes("private job limit")) throw new JobStoreError("limit");
  // The code is enough to diagnose; messages can echo row contents.
  console.error("job store query failed", { code: error?.code ?? "unknown" });
  throw new JobStoreError("unknown");
}

/** Stored JSON is re-validated: a malformed row is skipped rather than breaking the page. */
function toJob(row: unknown): Job | null {
  const parsed = storedJobSchema.safeParse(row);
  if (!parsed.success) {
    console.error("stored job failed validation", { id: (row as Row | null)?.id });
    return null;
  }
  return parsed.data;
}

/**
 * Job persistence on Supabase. Built from the user-scoped client, so Row Level Security
 * decides what each call can see: the shared catalogue plus the caller's own jobs.
 */
export class SupabaseJobStore implements JobStore {
  constructor(private readonly client: SupabaseClient) {}

  async search(userId: string, query: JobQuery): Promise<JobSearchResult> {
    const hideDemo = (await this.demo(userId)).hidden;
    const { data, error } = await this.client.rpc("search_jobs", {
      q: query.q ?? null,
      modes: query.work_modes,
      types: query.job_types,
      levels: query.seniority,
      company: query.company ?? null,
      only_with_salary: query.has_salary,
      hide_demo: hideDemo,
      sort_by: query.sort,
      page_size: JOBS_PAGE_SIZE,
      page_offset: (Math.max(query.page, 1) - 1) * JOBS_PAGE_SIZE,
    });
    if (error) fail(error);

    const rows = (data ?? []) as { job: unknown; total: number | string }[];
    const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
    return {
      jobs: rows.map((r) => toJob(r.job)).filter((j): j is Job => j !== null),
      total,
      page: query.page,
      pageSize: JOBS_PAGE_SIZE,
      pageCount: Math.ceil(total / JOBS_PAGE_SIZE),
    };
  }

  async get(_userId: string, id: string): Promise<Job | null> {
    const { data, error } = await this.client.from("jobs").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? toJob(data) : null;
  }

  async companies(): Promise<string[]> {
    const { data, error } = await this.client.from("jobs").select("company_name").limit(2000);
    if (error) fail(error);
    const names = new Set(((data ?? []) as Row[]).map((r) => String(r.company_name)));
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  async createPrivate(userId: string, job: PrivateJobInput): Promise<Job> {
    const { data, error } = await this.client
      .from("jobs")
      .insert({
        owner_user_id: userId,
        company_name: job.company_name,
        source_key: "manual",
        external_id: job.external_id,
        fingerprint: job.fingerprint,
        title: job.title,
        location: job.location,
        work_mode: job.work_mode,
        job_type: job.job_type,
        seniority: job.seniority,
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        salary_currency: job.salary_currency,
        salary_period: job.salary_period,
        description: job.description,
        requirements: job.requirements,
        responsibilities: job.responsibilities,
        required_skills: job.required_skills,
        preferred_skills: job.preferred_skills,
        min_years: job.min_years,
        apply_url: job.apply_url,
        posted_at: job.posted_at,
      })
      .select("*")
      .single();
    if (error) fail(error);
    const created = toJob(data);
    if (!created) throw new JobStoreError("unknown");
    return created;
  }

  async deletePrivate(userId: string, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("jobs")
      .delete()
      .eq("id", id)
      .eq("owner_user_id", userId)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0;
  }

  async countPrivate(userId: string): Promise<number> {
    const { count, error } = await this.client
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", userId);
    if (error) fail(error);
    return count ?? 0;
  }

  async demo(userId: string): Promise<DemoState> {
    const [{ count, error }, settings] = await Promise.all([
      this.client.from("jobs").select("id", { count: "exact", head: true }).eq("is_demo", true),
      this.client.from("users").select("settings").eq("id", userId).maybeSingle(),
    ]);
    if (error) fail(error);
    if (settings.error) fail(settings.error);
    const hidden = (settings.data?.settings as Row | undefined)?.hide_demo_jobs === true;
    return { available: (count ?? 0) > 0, hidden };
  }

  async setDemoHidden(userId: string, hidden: boolean): Promise<void> {
    const current = await this.client
      .from("users")
      .select("settings")
      .eq("id", userId)
      .maybeSingle();
    if (current.error) fail(current.error);
    const settings = {
      ...((current.data?.settings as Row | undefined) ?? {}),
      hide_demo_jobs: hidden,
    };
    const { error } = await this.client.from("users").update({ settings }).eq("id", userId);
    if (error) fail(error);
  }
}
