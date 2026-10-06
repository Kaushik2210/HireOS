import { MemoryProfileStore } from "@/db/profile/memory-store";
import { SupabaseProfileStore } from "@/db/profile/supabase-store";
import type { DemoProfileStore, ProfileStore } from "@/db/profile/store";
import type { AuthUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server bundles can load this module more than once (pages vs. server actions), so the
// demo sandbox is anchored on globalThis to make sure everyone shares one instance.
const globalForDemo = globalThis as unknown as { __hireosDemoProfileStore?: MemoryProfileStore };

export function getDemoProfileStore(): DemoProfileStore {
  globalForDemo.__hireosDemoProfileStore ??= new MemoryProfileStore();
  return globalForDemo.__hireosDemoProfileStore;
}

/** The store for the current user: an isolated sandbox in demo mode, Supabase (with RLS) otherwise. */
export async function getProfileStore(user: AuthUser): Promise<ProfileStore> {
  if (user.isDemo) return getDemoProfileStore();
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Supabase is not configured");
  return new SupabaseProfileStore(client);
}
