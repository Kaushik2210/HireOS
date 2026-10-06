import { MemoryResumeStore } from "@/db/resume/memory-store";
import { SupabaseResumeStore } from "@/db/resume/supabase-store";
import type { ResumeStore } from "@/db/resume/store";
import type { AuthUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Anchored on globalThis for the same reason as the profile store: server bundles can load
// this module more than once, and everyone must share a single demo sandbox.
const globalForDemo = globalThis as unknown as { __hireosDemoResumeStore?: MemoryResumeStore };

export function getDemoResumeStore(): ResumeStore {
  globalForDemo.__hireosDemoResumeStore ??= new MemoryResumeStore();
  return globalForDemo.__hireosDemoResumeStore;
}

/** The store for the current user: an in-memory sandbox in demo mode, Supabase (with RLS) otherwise. */
export async function getResumeStore(user: AuthUser): Promise<ResumeStore> {
  if (user.isDemo) return getDemoResumeStore();
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Supabase is not configured");
  return new SupabaseResumeStore(client);
}
