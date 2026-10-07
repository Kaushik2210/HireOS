import { MemoryJobStore } from "@/db/jobs/memory-store";
import { SupabaseJobStore } from "@/db/jobs/supabase-store";
import type { JobStore } from "@/db/jobs/store";
import type { AuthUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Anchored on globalThis so every server bundle shares one demo sandbox store.
const globalForDemo = globalThis as unknown as { __hireosDemoJobStore?: MemoryJobStore };

export function getDemoJobStore(): JobStore {
  globalForDemo.__hireosDemoJobStore ??= new MemoryJobStore();
  return globalForDemo.__hireosDemoJobStore;
}

/** The store for the current user: an in-memory sandbox in demo mode, Supabase (with RLS) otherwise. */
export async function getJobStore(user: AuthUser): Promise<JobStore> {
  if (user.isDemo) return getDemoJobStore();
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Supabase is not configured");
  return new SupabaseJobStore(client);
}
