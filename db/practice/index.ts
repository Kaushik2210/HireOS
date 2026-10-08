import { MemoryPracticeStore } from "@/db/practice/memory-store";
import { SupabasePracticeStore } from "@/db/practice/supabase-store";
import type { PracticeStore } from "@/db/practice/store";
import type { AuthUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Anchored on globalThis so every server bundle shares one demo sandbox store.
const globalForDemo = globalThis as unknown as { __hireosDemoPracticeStore?: MemoryPracticeStore };

export function getDemoPracticeStore(): PracticeStore {
  globalForDemo.__hireosDemoPracticeStore ??= new MemoryPracticeStore();
  return globalForDemo.__hireosDemoPracticeStore;
}

/** The store for the current user: an in-memory sandbox in demo mode, Supabase (with RLS) otherwise. */
export async function getPracticeStore(user: AuthUser): Promise<PracticeStore> {
  if (user.isDemo) return getDemoPracticeStore();
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Supabase is not configured");
  return new SupabasePracticeStore(client);
}
