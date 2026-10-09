import type { AuthUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SecurityEvent {
  action: string;
  created_at: string;
}

const LABELS: Record<string, string> = {
  "auth.sign_up": "Account created",
  "auth.sign_in": "Signed in",
  "auth.sign_in_failed": "Failed sign-in attempt",
  "auth.sign_out": "Signed out",
  "auth.sign_out_all": "Signed out of every device",
  "auth.password_reset_requested": "Password reset requested",
  "auth.password_updated": "Password changed",
  "account.exported": "Data export downloaded",
};

export const describeSecurityEvent = (action: string): string => LABELS[action] ?? action;

/**
 * The person's own recent security events. Row Level Security limits the table to their rows;
 * entries hold an action and a time, never an address, password or any content.
 */
export async function loadSecurityEvents(user: AuthUser, limit = 25): Promise<SecurityEvent[]> {
  if (user.isDemo) return [];
  const client = await createSupabaseServerClient();
  if (!client) return [];
  const { data, error } = await client
    .from("audit_logs")
    .select("action, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data;
}
