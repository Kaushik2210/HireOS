import { MemoryApplicationStore } from "@/db/applications/memory-store";
import { SupabaseApplicationStore } from "@/db/applications/supabase-store";
import type { ApplicationStore, DemoApplicationStore } from "@/db/applications/store";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import type { AuthUser } from "@/lib/auth/session";
import { DEFAULT_JOB_QUERY, type Job } from "@/lib/jobs/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Anchored on globalThis so every server bundle shares one demo sandbox store.
const globalForDemo = globalThis as unknown as {
  __hireosDemoApplicationStore?: MemoryApplicationStore;
};

/** The demo catalogue, read page by page, for attaching the sample applications. */
async function loadDemoJobs(): Promise<Job[]> {
  const jobs = new MemoryJobStore();
  const out: Job[] = [];
  for (let page = 1; ; page++) {
    const result = await jobs.search("demo-seed", { ...DEFAULT_JOB_QUERY, page });
    out.push(...result.jobs);
    if (page >= result.pageCount) return out;
  }
}

export function getDemoApplicationStore(): DemoApplicationStore {
  globalForDemo.__hireosDemoApplicationStore ??= new MemoryApplicationStore({ loadDemoJobs });
  return globalForDemo.__hireosDemoApplicationStore;
}

/** The store for the current user: an in-memory sandbox in demo mode, Supabase (with RLS) otherwise. */
export async function getApplicationStore(user: AuthUser): Promise<ApplicationStore> {
  if (user.isDemo) return getDemoApplicationStore();
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Supabase is not configured");
  return new SupabaseApplicationStore(client);
}
