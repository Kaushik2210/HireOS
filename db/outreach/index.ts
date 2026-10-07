import { MemoryOutreachStore } from "@/db/outreach/memory-store";
import { SupabaseOutreachStore } from "@/db/outreach/supabase-store";
import type { OutreachStore } from "@/db/outreach/store";
import type { AuthUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Anchored on globalThis so every server bundle shares one demo sandbox store.
const globalForDemo = globalThis as unknown as { __hireosDemoOutreachStore?: MemoryOutreachStore };

export function getDemoOutreachStore(): OutreachStore {
  globalForDemo.__hireosDemoOutreachStore ??= new MemoryOutreachStore();
  return globalForDemo.__hireosDemoOutreachStore;
}

/** The store for the current user: an in-memory sandbox in demo mode, Supabase (with RLS) otherwise. */
export async function getOutreachStore(user: AuthUser): Promise<OutreachStore> {
  if (user.isDemo) return getDemoOutreachStore();
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Supabase is not configured");
  return new SupabaseOutreachStore(client);
}
