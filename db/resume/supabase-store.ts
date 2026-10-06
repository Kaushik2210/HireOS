import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ResumeStoreError,
  type NewResume,
  type ResumeRecord,
  type ResumeStore,
  type ResumeSummary,
} from "@/db/resume/store";
import {
  CONTENT_TYPES,
  SIGNED_URL_SECONDS,
  STORAGE_BUCKET,
  type ResumeKind,
} from "@/lib/resume/constants";
import { parsedResumeSchema, resumeHealthSchema } from "@/lib/resume/schemas";

type Row = Record<string, unknown>;

const UNIQUE_VIOLATION = "23505";
const SUMMARY_COLUMNS = "id, file_name, content_type, size_bytes, page_count, health, created_at";

function fail(error: { code?: string } | null): never {
  if (error?.code === UNIQUE_VIOLATION) throw new ResumeStoreError("duplicate");
  // The code is enough to diagnose; messages can echo row contents.
  console.error("resume store query failed", { code: error?.code ?? "unknown" });
  throw new ResumeStoreError("unknown");
}

const kindOf = (contentType: string): ResumeKind =>
  contentType === CONTENT_TYPES.pdf ? "pdf" : "docx";

/** Path is always {user_id}/{resume_id}.{ext}; the database constraint and storage policy agree. */
export const storagePathFor = (userId: string, id: string, kind: ResumeKind) =>
  `${userId}/${id}.${kind}`;

function toSummary(row: Row): ResumeSummary {
  const health = resumeHealthSchema.safeParse(row.health);
  return {
    id: String(row.id),
    file_name: String(row.file_name),
    kind: kindOf(String(row.content_type)),
    size_bytes: Number(row.size_bytes),
    page_count: Number(row.page_count),
    health_score: health.success ? health.data.score : 0,
    created_at: String(row.created_at),
  };
}

/**
 * Resume persistence on Supabase: rows in Postgres and the original file in a private bucket.
 * Built from the user-scoped client, so RLS and storage policies apply to every call.
 */
export class SupabaseResumeStore implements ResumeStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(userId: string): Promise<ResumeSummary[]> {
    const { data, error } = await this.client
      .from("resumes")
      .select(SUMMARY_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toSummary);
  }

  async get(userId: string, id: string): Promise<ResumeRecord | null> {
    const { data, error } = await this.client
      .from("resumes")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail(error);
    if (!data) return null;

    const row = data as Row;
    // Stored JSON is re-validated: a row from an older parser version must not crash the page.
    const parsed = parsedResumeSchema.safeParse(row.parsed);
    const health = resumeHealthSchema.safeParse(row.health);
    if (!parsed.success || !health.success) {
      console.error("stored resume failed validation", { id });
      throw new ResumeStoreError("unknown");
    }
    return {
      ...toSummary(row),
      sha256: String(row.sha256),
      extracted_text: String(row.extracted_text ?? ""),
      parsed: parsed.data,
      health: health.data,
      has_file: true,
    };
  }

  async findByHash(userId: string, sha256: string): Promise<ResumeSummary | null> {
    const { data, error } = await this.client
      .from("resumes")
      .select(SUMMARY_COLUMNS)
      .eq("user_id", userId)
      .eq("sha256", sha256)
      .maybeSingle();
    if (error) fail(error);
    return data ? toSummary(data as Row) : null;
  }

  async count(userId: string): Promise<number> {
    const { count, error } = await this.client
      .from("resumes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) fail(error);
    return count ?? 0;
  }

  async create(userId: string, record: NewResume, file: Uint8Array): Promise<ResumeSummary> {
    const path = storagePathFor(userId, record.id, record.kind);
    const storage = this.client.storage.from(STORAGE_BUCKET);

    const upload = await storage.upload(path, file, {
      contentType: CONTENT_TYPES[record.kind],
      upsert: false,
    });
    if (upload.error) {
      console.error("resume upload failed");
      throw new ResumeStoreError("unknown");
    }

    const { data, error } = await this.client
      .from("resumes")
      .insert({
        id: record.id,
        user_id: userId,
        file_name: record.file_name,
        content_type: CONTENT_TYPES[record.kind],
        size_bytes: record.size_bytes,
        sha256: record.sha256,
        storage_path: path,
        page_count: record.page_count,
        extracted_text: record.extracted_text,
        parsed: record.parsed,
        health: record.health,
      })
      .select(SUMMARY_COLUMNS)
      .single();

    if (error) {
      // Do not leave an orphaned file behind a failed insert.
      await storage.remove([path]).catch(() => undefined);
      fail(error);
    }
    return toSummary(data as Row);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("resumes")
      .select("storage_path")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail(error);
    if (!data) return false;

    // File first: if this fails the row survives and the user can retry.
    const removed = await this.client.storage
      .from(STORAGE_BUCKET)
      .remove([String((data as Row).storage_path)]);
    if (removed.error) {
      console.error("resume file removal failed");
      throw new ResumeStoreError("unknown");
    }

    const result = await this.client
      .from("resumes")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (result.error) fail(result.error);
    return (result.data?.length ?? 0) > 0;
  }

  async signedUrl(userId: string, id: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("resumes")
      .select("storage_path, file_name")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail(error);
    if (!data) return null;

    const row = data as Row;
    const signed = await this.client.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(String(row.storage_path), SIGNED_URL_SECONDS, {
        download: String(row.file_name),
      });
    return signed.error ? null : signed.data.signedUrl;
  }
}
