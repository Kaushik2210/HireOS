import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DocumentStoreError,
  type ApproveOutcome,
  type DocumentStore,
  type DocumentVersion,
  type NewVersion,
} from "@/db/documents/store";
import {
  changeSchema,
  DOCUMENT_KINDS,
  missingSchema,
  VERSION_STATUSES,
  verificationSchema,
  versionContentSchema,
  type DocumentKind,
} from "@/lib/tailoring/types";
import { z } from "zod";

const UNIQUE_VIOLATION = "23505";
const MAX_LIST = 200;
const NUMBER_RETRIES = 3;

type Row = Record<string, unknown>;

function fail(error: { code?: string; message?: string } | null): never {
  if (error?.message?.includes("document version limit")) throw new DocumentStoreError("limit");
  // The code is enough to diagnose; messages can echo row contents.
  console.error("document store query failed", { code: error?.code ?? "unknown" });
  throw new DocumentStoreError("unknown");
}

const rowSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  kind: z.enum(DOCUMENT_KINDS),
  version_number: z.number().int(),
  parent_id: z.string().nullable(),
  status: z.enum(VERSION_STATUSES),
  content: z.unknown(),
  changes: z.array(changeSchema),
  missing: z.array(missingSchema),
  verification: verificationSchema,
  body: z.string(),
  tailor_version: z.number().int(),
  profile_hash: z.string(),
  created_at: z.string(),
  approved_at: z.string().nullable(),
});

/** Stored JSON is re-validated; a row that no longer fits is skipped rather than breaking the page. */
function toVersion(row: unknown): DocumentVersion | null {
  const parsed = rowSchema.safeParse(row);
  const content = versionContentSchema.safeParse(parsed.success ? parsed.data.content : null);
  if (!parsed.success || !content.success || content.data.kind !== parsed.data.kind) {
    console.error("stored document failed validation", { id: (row as Row | null)?.id });
    return null;
  }
  const r = parsed.data;
  return {
    id: r.id,
    jobId: r.job_id,
    kind: r.kind,
    versionNumber: r.version_number,
    parentId: r.parent_id,
    status: r.status,
    content: content.data,
    changes: r.changes,
    missing: r.missing,
    verification: r.verification,
    body: r.body,
    tailorVersion: r.tailor_version,
    profileHash: r.profile_hash,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
  };
}

/**
 * Tailored documents on Supabase. Built from the user-scoped client, so Row Level Security
 * limits every call to the caller's own rows; the database also refuses to approve a
 * version whose integrity check failed, and to change an approved one.
 */
export class SupabaseDocumentStore implements DocumentStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(userId: string, filter: { jobId?: string; kind?: DocumentKind } = {}) {
    let query = this.client.from("document_versions").select("*").eq("user_id", userId);
    if (filter.jobId) query = query.eq("job_id", filter.jobId);
    if (filter.kind) query = query.eq("kind", filter.kind);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("version_number", { ascending: false })
      .limit(MAX_LIST);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toVersion).filter((v): v is DocumentVersion => v !== null);
  }

  async get(userId: string, id: string) {
    const { data, error } = await this.client
      .from("document_versions")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail(error);
    return data ? toVersion(data) : null;
  }

  async create(userId: string, input: NewVersion): Promise<DocumentVersion> {
    for (let attempt = 0; attempt < NUMBER_RETRIES; attempt++) {
      const { data: latest, error: readError } = await this.client
        .from("document_versions")
        .select("version_number")
        .eq("user_id", userId)
        .eq("job_id", input.jobId)
        .eq("kind", input.kind)
        .order("version_number", { ascending: false })
        .limit(1);
      if (readError) fail(readError);
      const next = Number((latest as Row[] | null)?.[0]?.version_number ?? 0) + 1;

      const { data, error } = await this.client
        .from("document_versions")
        .insert({
          user_id: userId,
          job_id: input.jobId,
          kind: input.kind,
          version_number: next,
          parent_id: input.parentId,
          content: input.content,
          changes: input.changes,
          missing: input.missing,
          verification: input.verification,
          body: input.body,
          tailor_version: input.content.doc.tailor_version,
          profile_hash: input.profileHash,
        })
        .select("*")
        .single();
      // Two saves at once picked the same number: look again and take the next one.
      if (error?.code === UNIQUE_VIOLATION) continue;
      if (error) fail(error);
      const created = toVersion(data);
      if (!created) throw new DocumentStoreError("unknown");
      return created;
    }
    throw new DocumentStoreError("unknown");
  }

  async approve(userId: string, id: string): Promise<ApproveOutcome> {
    const current = await this.get(userId, id);
    if (!current) return "not_found";
    if (current.status === "approved") return "already_approved";
    if (!current.verification.ok) return "blocked";
    const { data, error } = await this.client
      .from("document_versions")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("status", "draft")
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0 ? "approved" : "already_approved";
  }

  async remove(userId: string, id: string) {
    const { data, error } = await this.client
      .from("document_versions")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0;
  }

  async removeForJob() {
    // Versions are removed with their job by a foreign-key cascade.
  }
}
