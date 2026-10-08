import { MemoryInterviewStore } from "@/db/interviews/memory-store";
import { SupabaseInterviewStore } from "@/db/interviews/supabase-store";
import type { InterviewStore } from "@/db/interviews/store";
import type { AuthUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Anchored on globalThis so every server bundle shares one demo sandbox store.
const globalForDemo = globalThis as unknown as {
  __hireosDemoInterviewStore?: MemoryInterviewStore;
};

export function getDemoInterviewStore(): InterviewStore {
  globalForDemo.__hireosDemoInterviewStore ??= new MemoryInterviewStore();
  return globalForDemo.__hireosDemoInterviewStore;
}

/** The store for the current user: an in-memory sandbox in demo mode, Supabase (with RLS) otherwise. */
export async function getInterviewStore(user: AuthUser): Promise<InterviewStore> {
  if (user.isDemo) return getDemoInterviewStore();
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Supabase is not configured");
  return new SupabaseInterviewStore(client);
}
