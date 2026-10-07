import { randomUUID } from "node:crypto";
import { DEMO_DISCOVERED_AT } from "@/db/seed/demo-jobs";
import {
  JobStoreError,
  type DemoState,
  type JobStore,
  type PrivateJobInput,
} from "@/db/jobs/store";
import { JOBS_PAGE_SIZE, MAX_PRIVATE_JOBS } from "@/lib/jobs/constants";
import { idFromFingerprint } from "@/lib/jobs/keys";
import type { Job, JobQuery, JobSearchResult } from "@/lib/jobs/schemas";
import { ingestJobs } from "@/services/jobs/ingest";
import { DEMO_PROVIDERS } from "@/services/jobs/providers/demo";

const MAX_SANDBOXES = 500;

interface Sandbox {
  privateJobs: Job[];
  demoHidden: boolean;
}

/**
 * The demo catalogue, built once per process by running the real ingestion pipeline over
 * the demo providers. Ids come from fingerprints so they match supabase/seed.sql.
 */
let demoCatalog: Promise<Job[]> | undefined;
function loadDemoCatalog(): Promise<Job[]> {
  demoCatalog ??= ingestJobs([...DEMO_PROVIDERS]).then(({ jobs }) =>
    jobs.map((job) => ({
      ...job,
      id: idFromFingerprint(job.fingerprint),
      owner_user_id: null,
      discovered_at: DEMO_DISCOVERED_AT,
    })),
  );
  return demoCatalog;
}

const lc = (value: string) => value.toLowerCase();

/** Same words-must-all-appear rule as the SQL function `search_jobs`. */
function haystack(job: Job): string {
  return lc(
    `${job.title} ${job.company_name} ${job.location ?? ""} ${[...job.required_skills, ...job.preferred_skills].join(" ")} ${job.description}`,
  );
}

function matches(job: Job, query: JobQuery): boolean {
  if (query.work_modes.length > 0 && !(job.work_mode && query.work_modes.includes(job.work_mode)))
    return false;
  if (query.job_types.length > 0 && !(job.job_type && query.job_types.includes(job.job_type)))
    return false;
  if (query.seniority.length > 0 && !(job.seniority && query.seniority.includes(job.seniority)))
    return false;
  if (query.company && !lc(job.company_name).includes(lc(query.company))) return false;
  if (query.has_salary && job.salary_min === null && job.salary_max === null) return false;
  if (query.q?.trim()) {
    const text = haystack(job);
    for (const token of lc(query.q.trim()).split(" ")) {
      if (token !== "" && !text.includes(token)) return false;
    }
  }
  return true;
}

const dateKey = (job: Job) => job.posted_at ?? job.discovered_at.slice(0, 10);

/** Same ordering as the SQL function: chosen key first, then newest-discovered, then id. */
function compare(sort: JobQuery["sort"]) {
  return (a: Job, b: Job): number => {
    let primary = 0;
    if (sort === "title") {
      const x = lc(a.title);
      const y = lc(b.title);
      primary = x < y ? -1 : x > y ? 1 : 0;
    } else {
      const x = dateKey(a);
      const y = dateKey(b);
      primary = x < y ? -1 : x > y ? 1 : 0;
      if (sort === "newest") primary = -primary;
    }
    if (primary !== 0) return primary;
    if (a.discovered_at !== b.discovered_at) return a.discovered_at < b.discovered_at ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/**
 * Demo-mode store. The catalogue is shared and read-only; each visitor's own jobs and
 * "hide demo data" choice live in an isolated, bounded, in-memory sandbox.
 */
export class MemoryJobStore implements JobStore {
  private readonly sandboxes = new Map<string, Sandbox>();

  private box(userId: string): Sandbox {
    let box = this.sandboxes.get(userId);
    if (!box) {
      box = { privateJobs: [], demoHidden: false };
      this.sandboxes.set(userId, box);
      if (this.sandboxes.size > MAX_SANDBOXES) {
        const oldest = this.sandboxes.keys().next();
        if (!oldest.done) this.sandboxes.delete(oldest.value);
      }
    }
    return box;
  }

  private async visible(userId: string): Promise<Job[]> {
    const box = this.box(userId);
    const shared = box.demoHidden ? [] : await loadDemoCatalog();
    return [...shared, ...box.privateJobs];
  }

  async search(userId: string, query: JobQuery): Promise<JobSearchResult> {
    const all = (await this.visible(userId))
      .filter((job) => matches(job, query))
      .sort(compare(query.sort));
    const pageSize = JOBS_PAGE_SIZE;
    const offset = (Math.max(query.page, 1) - 1) * pageSize;
    return {
      jobs: structuredClone(all.slice(offset, offset + pageSize)),
      total: all.length,
      page: query.page,
      pageSize,
      pageCount: Math.ceil(all.length / pageSize),
    };
  }

  async get(userId: string, id: string): Promise<Job | null> {
    const job = (await this.visible(userId)).find((j) => j.id === id);
    return job ? structuredClone(job) : null;
  }

  async companies(userId: string): Promise<string[]> {
    const names = new Set((await this.visible(userId)).map((j) => j.company_name));
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  async createPrivate(userId: string, input: PrivateJobInput): Promise<Job> {
    const box = this.box(userId);
    if (box.privateJobs.length >= MAX_PRIVATE_JOBS) throw new JobStoreError("limit");
    if (box.privateJobs.some((j) => j.fingerprint === input.fingerprint)) {
      throw new JobStoreError("duplicate");
    }
    const job: Job = {
      ...input,
      id: randomUUID(),
      source_key: "manual",
      owner_user_id: userId,
      is_demo: false,
      also_listed_on: [],
      discovered_at: new Date().toISOString(),
    };
    box.privateJobs.push(job);
    return structuredClone(job);
  }

  async deletePrivate(userId: string, id: string): Promise<boolean> {
    const box = this.box(userId);
    const index = box.privateJobs.findIndex((j) => j.id === id);
    if (index === -1) return false;
    box.privateJobs.splice(index, 1);
    return true;
  }

  async countPrivate(userId: string): Promise<number> {
    return this.box(userId).privateJobs.length;
  }

  async demo(userId: string): Promise<DemoState> {
    return { available: (await loadDemoCatalog()).length > 0, hidden: this.box(userId).demoHidden };
  }

  async setDemoHidden(userId: string, hidden: boolean): Promise<void> {
    this.box(userId).demoHidden = hidden;
  }
}
