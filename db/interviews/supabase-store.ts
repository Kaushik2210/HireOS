import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  InterviewStoreError,
  type Interview,
  type InterviewFields,
  type InterviewStore,
  type NewInterview,
  type UpdateOutcome,
} from "@/db/interviews/store";
import {
  FORMATS,
  INTERVIEW_KINDS,
  INTERVIEW_STATUSES,
  checklistItemSchema,
  type ChecklistItem,
  type InterviewStatus,
} from "@/lib/interview/types";

const MAX_LIST = 200;
const INSUFFICIENT_PRIVILEGE = "42501";

type Row = Record<string, unknown>;

function fail(error: { code?: string; message?: string } | null): never {
  if (error?.message?.includes("interview limit")) throw new InterviewStoreError("limit");
  // The code is enough to diagnose; messages can echo row contents.
  console.error("interview store query failed", { code: error?.code ?? "unknown" });
  throw new InterviewStoreError("unknown");
}

const rowSchema = z.object({
  id: z.string(),
  application_id: z.string(),
  round_label: z.string(),
  kind: z.enum(INTERVIEW_KINDS),
  format: z.enum(FORMATS).nullable(),
  scheduled_on: z.string().nullable(),
  scheduled_time: z.string().nullable(),
  interviewer: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(INTERVIEW_STATUSES),
  checklist: z.array(checklistItemSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Stored rows are re-validated; one that no longer fits is skipped rather than breaking a page. */
function toInterview(row: unknown): Interview | null {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) {
    console.error("stored interview failed validation", { id: (row as Row | null)?.id });
    return null;
  }
  const r = parsed.data;
  return {
    id: r.id,
    applicationId: r.application_id,
    roundLabel: r.round_label,
    kind: r.kind,
    format: r.format,
    scheduledOn: r.scheduled_on,
    // Postgres returns time as HH:MM:SS; the app works in HH:MM.
    scheduledTime: r.scheduled_time ? r.scheduled_time.slice(0, 5) : null,
    interviewer: r.interviewer,
    notes: r.notes,
    status: r.status,
    checklist: r.checklist,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const toColumns = (f: InterviewFields) => ({
  round_label: f.roundLabel,
  kind: f.kind,
  format: f.format,
  scheduled_on: f.scheduledOn,
  scheduled_time: f.scheduledTime,
  interviewer: f.interviewer,
  notes: f.notes,
});

/**
 * Interview rounds on Supabase. Built from the user-scoped client, so Row Level Security
 * limits every call to the caller's own rows and ties each round to an application they own.
 */
export class SupabaseInterviewStore implements InterviewStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(userId: string, filter: { applicationId?: string } = {}) {
    let query = this.client.from("interviews").select("*").eq("user_id", userId);
    if (filter.applicationId) query = query.eq("application_id", filter.applicationId);
    const { data, error } = await query
      .order("scheduled_on", { ascending: true, nullsFirst: false })
      .order("scheduled_time", { ascending: true, nullsFirst: false })
      .limit(MAX_LIST);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toInterview).filter((i): i is Interview => i !== null);
  }

  async get(userId: string, id: string) {
    const { data, error } = await this.client
      .from("interviews")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail(error);
    return data ? toInterview(data) : null;
  }

  async create(userId: string, input: NewInterview): Promise<Interview> {
    const { data, error } = await this.client
      .from("interviews")
      .insert({
        user_id: userId,
        application_id: input.applicationId,
        ...toColumns(input),
        checklist: input.checklist,
      })
      .select("*")
      .single();
    // The row-level check fails when the application is not the caller's own.
    if (error?.code === INSUFFICIENT_PRIVILEGE) throw new InterviewStoreError("not_found");
    if (error) fail(error);
    const created = toInterview(data);
    if (!created) throw new InterviewStoreError("unknown");
    return created;
  }

  async update(
    userId: string,
    id: string,
    fields: InterviewFields & { status: InterviewStatus },
  ): Promise<UpdateOutcome> {
    const { data, error } = await this.client
      .from("interviews")
      .update({ ...toColumns(fields), status: fields.status })
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0 ? "updated" : "not_found";
  }

  async setChecklist(
    userId: string,
    id: string,
    checklist: ChecklistItem[],
  ): Promise<UpdateOutcome> {
    const { data, error } = await this.client
      .from("interviews")
      .update({ checklist })
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0 ? "updated" : "not_found";
  }

  async remove(userId: string, id: string) {
    const { data, error } = await this.client
      .from("interviews")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0;
  }

  async removeForApplication() {
    // Rounds are removed with their application by a foreign-key cascade.
  }
}
