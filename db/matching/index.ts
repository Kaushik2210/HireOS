import { MemoryMatchStore } from "@/db/matching/memory-store";
import { SupabaseMatchStore } from "@/db/matching/supabase-store";
import type { MatchStore } from "@/db/matching/store";
import type { AuthUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Anchored on globalThis so every server bundle shares one demo sandbox store.
const globalForDemo = globalThis as unknown as { __hireosDemoMatchStore?: MemoryMatchStore };

export function getDemoMatchStore(): MatchStore {
  globalForDemo.__hireosDemoMatchStore ??= new MemoryMatchStore();
  return globalForDemo.__hireosDemoMatchStore;
}

/** The store for the current user: an in-memory sandbox in demo mode, Supabase (with RLS) otherwise. */
export async function getMatchStore(user: AuthUser): Promise<MatchStore> {
  if (user.isDemo) return getDemoMatchStore();
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Supabase is not configured");
  return new SupabaseMatchStore(client);
}
