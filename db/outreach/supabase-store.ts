import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  OutreachStoreError,
  type ApproveOutcome,
  type DraftEdit,
  type EditOutcome,
  type NewDraft,
  type OutreachDraft,
  type OutreachStore,
  type SentOutcome,
} from "@/db/outreach/store";
import { CHANNELS, DRAFT_STATUSES, OUTREACH_TYPES, outreachDocSchema } from "@/lib/outreach/types";
import { verificationSchema } from "@/lib/tailoring/types";

const MAX_LIST = 300;

type Row = Record<string, unknown>;

function fail(error: { code?: string; message?: string } | null): never {
  if (error?.message?.includes("outreach draft limit")) throw new OutreachStoreError("limit");
  // The code is enough to diagnose; messages can echo row contents.
  console.error("outreach store query failed", { code: error?.code ?? "unknown" });
  throw new OutreachStoreError("unknown");
}

const rowSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  type: z.enum(OUTREACH_TYPES),
  channel: z.enum(CHANNELS),
  recipient_name: z.string().nullable(),
  recipient_title: z.string().nullable(),
  shared_context: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  content: outreachDocSchema,
  verification: verificationSchema,
  profile_hash: z.string(),
  status: z.enum(DRAFT_STATUSES),
  created_at: z.string(),
  updated_at: z.string(),
  approved_at: z.string().nullable(),
  sent_at: z.string().nullable(),
});

/** Stored JSON is re-validated; a row that no longer fits is skipped rather than breaking the page. */
function toDraft(row: unknown): OutreachDraft | null {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) {
    console.error("stored outreach draft failed validation", { id: (row as Row | null)?.id });
    return null;
  }
  const r = parsed.data;
  return {
    id: r.id,
    jobId: r.job_id,
    type: r.type,
    channel: r.channel,
    recipientName: r.recipient_name,
    recipientTitle: r.recipient_title,
    sharedContext: r.shared_context,
    subject: r.subject,
    body: r.body,
    doc: r.content,
    verification: r.verification,
    profileHash: r.profile_hash,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    approvedAt: r.approved_at,
    sentAt: r.sent_at,
  };
}

/**
 * Outreach drafts on Supabase. Built from the user-scoped client, so Row Level Security
 * limits every call to the caller's own rows. The database also refuses to approve or send a
 * draft whose check failed, to edit an approved draft, and to change a sent one.
 */
export class SupabaseOutreachStore implements OutreachStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(userId: string, filter: { jobId?: string } = {}) {
    let query = this.client.from("outreach_drafts").select("*").eq("user_id", userId);
    if (filter.jobId) query = query.eq("job_id", filter.jobId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(MAX_LIST);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toDraft).filter((d): d is OutreachDraft => d !== null);
  }

  async get(userId: string, id: string) {
    const { data, error } = await this.client
      .from("outreach_drafts")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail(error);
    return data ? toDraft(data) : null;
  }

  async create(userId: string, input: NewDraft): Promise<OutreachDraft> {
    const { data, error } = await this.client
      .from("outreach_drafts")
      .insert({
        user_id: userId,
        job_id: input.jobId,
        type: input.type,
        channel: input.doc.channel,
        recipient_name: input.recipientName,
        recipient_title: input.recipientTitle,
        shared_context: input.sharedContext,
        subject: input.doc.subject,
        body: input.doc.text,
        content: input.doc,
        verification: input.verification,
        profile_hash: input.profileHash,
        tailor_version: input.doc.tailor_version,
      })
      .select("*")
      .single();
    if (error) fail(error);
    const created = toDraft(data);
    if (!created) throw new OutreachStoreError("unknown");
    return created;
  }

  async edit(userId: string, id: string, edit: DraftEdit): Promise<EditOutcome> {
    const { data, error } = await this.client
      .from("outreach_drafts")
      .update({
        subject: edit.doc.subject,
        body: edit.doc.text,
        content: edit.doc,
        verification: edit.verification,
        profile_hash: edit.profileHash,
      })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("status", "draft")
      .select("id");
    if (error) fail(error);
    if ((data?.length ?? 0) > 0) return "updated";
    // Nothing changed: either it does not exist or it is no longer a draft.
    return (await this.get(userId, id)) ? "locked" : "not_found";
  }

  async approve(userId: string, id: string): Promise<ApproveOutcome> {
    const current = await this.get(userId, id);
    if (!current) return "not_found";
    if (current.status !== "draft") return "already_approved";
    if (!current.verification.ok) return "blocked";
    const { data, error } = await this.client
      .from("outreach_drafts")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("status", "draft")
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0 ? "approved" : "already_approved";
  }

  async markSent(userId: string, id: string): Promise<SentOutcome> {
    const current = await this.get(userId, id);
    if (!current) return "not_found";
    if (current.status === "sent") return "already_sent";
    if (current.status !== "approved") return "not_approved";
    const { data, error } = await this.client
      .from("outreach_drafts")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("status", "approved")
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0 ? "sent" : "already_sent";
  }

  async remove(userId: string, id: string) {
    const { data, error } = await this.client
      .from("outreach_drafts")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0;
  }

  async removeForJob() {
    // Drafts are removed with their job by a foreign-key cascade.
  }
}
