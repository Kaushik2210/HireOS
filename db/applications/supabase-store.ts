import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ApplicationStoreError,
  type Application,
  type ApplicationEvent,
  type ApplicationStore,
  type ApplicationWithEvents,
  type DetailsUpdate,
  type EventOutcome,
  type MoveOutcome,
  type NewApplication,
  type UpdateOutcome,
} from "@/db/applications/store";
import { EVENT_KINDS, STATUSES, type Status } from "@/lib/applications/types";

const MAX_LIST = 500;
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

type Row = Record<string, unknown>;

function fail(error: { code?: string; message?: string } | null): never {
  if (error?.code === UNIQUE_VIOLATION) throw new ApplicationStoreError("duplicate");
  if (error?.message?.includes("application limit")) throw new ApplicationStoreError("limit");
  if (error?.code === CHECK_VIOLATION) throw new ApplicationStoreError("invalid");
  // The code is enough to diagnose; messages can echo row contents.
  console.error("application store query failed", { code: error?.code ?? "unknown" });
  throw new ApplicationStoreError("unknown");
}

const status = z.enum(STATUSES);

const appRow = z.object({
  id: z.string(),
  job_id: z.string().nullable(),
  job_title: z.string(),
  company_name: z.string(),
  status,
  applied_on: z.string().nullable(),
  follow_up_on: z.string().nullable(),
  notes: z.string().nullable(),
  resume_version_id: z.string().nullable(),
  cover_letter_version_id: z.string().nullable(),
  status_changed_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const eventRow = z.object({
  id: z.string(),
  application_id: z.string(),
  kind: z.enum(EVENT_KINDS),
  from_status: status.nullable(),
  to_status: status.nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
});

/** Stored rows are re-validated; one that no longer fits is skipped rather than breaking a page. */
function toApplication(row: unknown): Application | null {
  const parsed = appRow.safeParse(row);
  if (!parsed.success) {
    console.error("stored application failed validation", { id: (row as Row | null)?.id });
    return null;
  }
  const r = parsed.data;
  return {
    id: r.id,
    jobId: r.job_id,
    jobTitle: r.job_title,
    companyName: r.company_name,
    status: r.status,
    appliedOn: r.applied_on,
    followUpOn: r.follow_up_on,
    notes: r.notes,
    resumeVersionId: r.resume_version_id,
    coverLetterVersionId: r.cover_letter_version_id,
    statusChangedAt: r.status_changed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isDemo: false,
  };
}

function toEvent(row: unknown): ApplicationEvent | null {
  const parsed = eventRow.safeParse(row);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    id: r.id,
    applicationId: r.application_id,
    kind: r.kind,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    note: r.note,
    createdAt: r.created_at,
  };
}

/**
 * The pipeline on Supabase. Built from the user-scoped client, so Row Level Security limits
 * every call to the caller's own rows. Status moves go through the database function that
 * checks the allowed-transition table and writes the event in the same transaction.
 */
export class SupabaseApplicationStore implements ApplicationStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(userId: string) {
    const { data, error } = await this.client
      .from("applications")
      .select("*")
      .eq("user_id", userId)
      .order("status_changed_at", { ascending: false })
      .limit(MAX_LIST);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toApplication).filter((a): a is Application => a !== null);
  }

  async get(userId: string, id: string): Promise<ApplicationWithEvents | null> {
    const { data, error } = await this.client
      .from("applications")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail(error);
    const application = data ? toApplication(data) : null;
    if (!application) return null;
    const { data: events, error: eventError } = await this.client
      .from("application_events")
      .select("*")
      .eq("user_id", userId)
      .eq("application_id", id)
      .order("created_at", { ascending: true });
    if (eventError) fail(eventError);
    return {
      application,
      events: ((events ?? []) as Row[])
        .map(toEvent)
        .filter((e): e is ApplicationEvent => e !== null),
    };
  }

  async getByJob(userId: string, jobId: string) {
    const { data, error } = await this.client
      .from("applications")
      .select("*")
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .maybeSingle();
    if (error) fail(error);
    return data ? toApplication(data) : null;
  }

  async create(userId: string, input: NewApplication): Promise<Application> {
    const { data, error } = await this.client
      .from("applications")
      .insert({
        user_id: userId,
        job_id: input.jobId,
        job_title: input.jobTitle,
        company_name: input.companyName,
        status: input.status,
        applied_on:
          input.status === "applied"
            ? (input.appliedOn ?? new Date().toISOString().slice(0, 10))
            : null,
      })
      .select("*")
      .single();
    if (error) fail(error);
    const created = toApplication(data);
    if (!created) throw new ApplicationStoreError("unknown");
    return created;
  }

  async changeStatus(
    _userId: string,
    id: string,
    to: Status,
    note: string | null,
    appliedOn: string | null,
  ): Promise<MoveOutcome> {
    const { error } = await this.client.rpc("change_application_status", {
      p_id: id,
      p_status: to,
      p_note: note,
      p_on: appliedOn,
    });
    if (!error) return "moved";
    if (error.message?.includes("not found")) return "not_found";
    if (error.message?.includes("not allowed")) return "not_allowed";
    fail(error);
  }

  async updateDetails(userId: string, id: string, update: DetailsUpdate): Promise<UpdateOutcome> {
    const { data, error } = await this.client
      .from("applications")
      .update({
        notes: update.notes,
        follow_up_on: update.followUpOn,
        resume_version_id: update.resumeVersionId,
        cover_letter_version_id: update.coverLetterVersionId,
      })
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    // A document that is not the caller's own fails the row-level check.
    if (error?.code === INSUFFICIENT_PRIVILEGE) return "invalid_document";
    if (error) fail(error);
    return (data?.length ?? 0) > 0 ? "updated" : "not_found";
  }

  async addEvent(
    _userId: string,
    id: string,
    kind: "note" | "followed_up",
    note: string | null,
  ): Promise<EventOutcome> {
    const { error } = await this.client.rpc("add_application_event", {
      p_id: id,
      p_kind: kind,
      p_note: note,
    });
    if (!error) return "added";
    if (error.message?.includes("not found")) return "not_found";
    if (error.message?.includes("needs text") || error.message?.includes("cannot be added")) {
      return "invalid";
    }
    fail(error);
  }

  async remove(userId: string, id: string) {
    const { data, error } = await this.client
      .from("applications")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0;
  }

  async detachJob() {
    // The foreign key sets job_id to null when a job is deleted, and keeps the application.
  }
}
