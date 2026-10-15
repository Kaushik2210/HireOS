import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchStore, StoredMatch } from "@/db/matching/store";
import { matchResultSchema, type MatchResult } from "@/lib/matching/types";

/**
 * Saved matches on Supabase. Built from the user-scoped client, so Row Level Security
 * limits every call to the caller's own rows.
 */
export class SupabaseMatchStore implements MatchStore {
  constructor(private readonly client: SupabaseClient) {}

  async get(userId: string, jobId: string): Promise<StoredMatch | null> {
    const { data, error } = await this.client
      .from("job_matches")
      .select("*")
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .maybeSingle();
    if (error) {
      console.error("match store query failed", { code: error.code ?? "unknown" });
      throw new Error("Match store error");
    }
    if (!data) return null;
    // Stored JSON is re-validated; a row that no longer fits the schema is treated as absent.
    const parsed = matchResultSchema.safeParse({
      scorer_version: data.scorer_version,
      strength: data.strength,
      label: data.label,
      cap: data.cap,
      components: data.components,
      why: data.why,
      gaps: data.gaps,
      keywords: data.keywords,
      concerns: data.concerns,
      action: data.action,
    });
    if (!parsed.success) return null;
    return {
      jobId,
      result: parsed.data,
      profileHash: String(data.profile_hash),
      computedAt: String(data.computed_at),
    };
  }

  async save(userId: string, jobId: string, result: MatchResult, profileHash: string) {
    // Update, then insert if there was nothing to update. An upsert cannot be used: its
    // conflict branch also writes user_id and job_id, which clients have no update right on.
    const row = {
      scorer_version: result.scorer_version,
      strength: result.strength,
      label: result.label,
      components: result.components,
      why: result.why,
      gaps: result.gaps,
      keywords: result.keywords,
      concerns: result.concerns,
      cap: result.cap,
      action: result.action,
      profile_hash: profileHash,
      computed_at: new Date().toISOString(),
    };
    const fail = (code: string | undefined): never => {
      console.error("match store save failed", { code: code ?? "unknown" });
      throw new Error("Match store error");
    };
    const update = () =>
      this.client
        .from("job_matches")
        .update(row)
        .eq("user_id", userId)
        .eq("job_id", jobId)
        .select("job_id");

    const first = await update();
    if (first.error) fail(first.error.code);
    if ((first.data ?? []).length > 0) return;

    const created = await this.client
      .from("job_matches")
      .insert({ user_id: userId, job_id: jobId, ...row });
    if (!created.error) return;
    if (created.error.code !== "23505") fail(created.error.code);
    // Saved from another request in between: update that row instead.
    const retry = await update();
    if (retry.error) fail(retry.error.code);
  }
}
