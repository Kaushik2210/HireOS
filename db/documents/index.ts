import { MemoryDocumentStore } from "@/db/documents/memory-store";
import { SupabaseDocumentStore } from "@/db/documents/supabase-store";
import type { DocumentStore } from "@/db/documents/store";
import type { AuthUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Anchored on globalThis so every server bundle shares one demo sandbox store.
const globalForDemo = globalThis as unknown as { __hireosDemoDocumentStore?: MemoryDocumentStore };

export function getDemoDocumentStore(): DocumentStore {
  globalForDemo.__hireosDemoDocumentStore ??= new MemoryDocumentStore();
  return globalForDemo.__hireosDemoDocumentStore;
}

/** The store for the current user: an in-memory sandbox in demo mode, Supabase (with RLS) otherwise. */
export async function getDocumentStore(user: AuthUser): Promise<DocumentStore> {
  if (user.isDemo) return getDemoDocumentStore();
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Supabase is not configured");
  return new SupabaseDocumentStore(client);
}
