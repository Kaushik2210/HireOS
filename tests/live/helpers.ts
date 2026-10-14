import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Helpers for the live suite: real accounts on a real (local) Supabase stack, and the real
 * store classes talking to it as those accounts. Nothing here is mocked.
 *
 * Run with `npm run test:live` after `npx supabase start`. Keys come from the environment or
 * from .env.local; the suite refuses to run against anything but a local address, so it can
 * never create test accounts on a hosted project by mistake.
 */

const envFile = path.resolve(__dirname, "../../.env.local");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // Unreadable env file: the checks below report what is missing.
  }
}

export const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL);
export const liveReady = Boolean(URL && ANON && SERVICE && isLocal);

export const PASSWORD = "Live-Test-Pass-4471";

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

/** Creates a confirmed account and returns a client that is signed in as it. */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `live-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const admin = adminClient();
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw new Error("could not create a test account");

  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signedIn.error) throw new Error("could not sign the test account in");
  return { id: created.data.user.id, email, client };
}

/** Deletes the test accounts. Rows and files go with them, by cascade. */
export async function removeTestUsers(...users: (TestUser | undefined)[]) {
  const admin = adminClient();
  for (const user of users) {
    if (!user) continue;
    const files = await admin.storage.from("resumes").list(user.id);
    const names = (files.data ?? []).map((f) => `${user.id}/${f.name}`);
    if (names.length > 0) await admin.storage.from("resumes").remove(names);
    await admin.auth.admin.deleteUser(user.id);
  }
}
