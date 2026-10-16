import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AuditAction =
  | "auth.sign_up"
  | "auth.sign_in"
  | "auth.sign_in_failed"
  | "auth.sign_out"
  | "auth.password_reset_requested"
  | "auth.password_updated"
  | "auth.sign_out_all"
  | "auth.mfa_required"
  | "auth.mfa_failed"
  | "account.mfa_enabled"
  | "account.mfa_disabled"
  | "account.exported"
  | "account.deleted";

export interface AuditClient {
  from(table: "audit_logs"): {
    insert(row: {
      user_id: string | null;
      action: string;
      metadata: Record<string, string | number | boolean | null>;
    }): PromiseLike<{ error: { message: string } | null }>;
  };
}

/**
 * Appends a security-relevant event. Never records emails, passwords, or resume content:
 * only the action, the user id, and small non-sensitive metadata.
 *
 * Failures are logged and swallowed so an audit outage can never block sign-in.
 */
export async function recordAudit(
  action: AuditAction,
  userId: string | null,
  metadata: Record<string, string | number | boolean | null> = {},
  client: AuditClient | null = createSupabaseAdminClient() as AuditClient | null,
): Promise<void> {
  if (!client) return; // demo mode or no service role configured
  try {
    const { error } = await client.from("audit_logs").insert({ user_id: userId, action, metadata });
    if (error) console.error("audit log write failed", { action });
  } catch {
    console.error("audit log write failed", { action });
  }
}
