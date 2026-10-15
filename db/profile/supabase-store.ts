import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbRow, sortItems, toDbRow } from "@/db/profile/mapping";
import {
  StoreError,
  type CreateOptions,
  type ProfileSnapshot,
  type ProfileStore,
  type SingletonDataMap,
  type SingletonRecord,
} from "@/db/profile/store";
import {
  COLLECTION_ENTITIES,
  type CollectionEntity,
  type CollectionItem,
  type SingletonEntity,
} from "@/lib/profile/schemas";

type Row = Record<string, unknown>;

/** Postgres unique_violation, surfaced by PostgREST. */
const UNIQUE_VIOLATION = "23505";

function fail(error: { code?: string; message?: string } | null): never {
  if (error?.code === UNIQUE_VIOLATION) throw new StoreError("duplicate");
  // Log the code only: messages can echo row contents.
  console.error("profile store query failed", { code: error?.code ?? "unknown" });
  throw new StoreError("unknown");
}

/**
 * Profile persistence on Supabase. Must be constructed with the user-scoped server client,
 * never the service-role client, so Row Level Security enforces ownership in the database.
 * Every query also filters by user_id explicitly (defense in depth).
 */
export class SupabaseProfileStore implements ProfileStore {
  constructor(private readonly client: SupabaseClient) {}

  async getSnapshot(userId: string): Promise<ProfileSnapshot> {
    const [profile, goals, education, experiences, projects, certifications, skills, achievements] =
      await Promise.all([
        this.readSingleton(userId, "profiles"),
        this.readSingleton(userId, "career_goals"),
        this.readAll(userId, "education"),
        this.readAll(userId, "experiences"),
        this.readAll(userId, "projects"),
        this.readAll(userId, "certifications"),
        this.readAll(userId, "skills"),
        this.readAll(userId, "achievements"),
      ]);
    return {
      profile,
      goals,
      education,
      experiences,
      projects,
      certifications,
      skills,
      achievements,
    };
  }

  private async readSingleton<E extends SingletonEntity>(
    userId: string,
    entity: E,
  ): Promise<SingletonRecord<E> | null> {
    const { data, error } = await this.client
      .from(entity)
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail(error);
    return data ? (fromDbRow(entity, data as Row) as unknown as SingletonRecord<E>) : null;
  }

  private async readAll<E extends CollectionEntity>(
    userId: string,
    entity: E,
  ): Promise<CollectionItem<E>[]> {
    const { data, error } = await this.client.from(entity).select("*").eq("user_id", userId);
    if (error) fail(error);
    const items = ((data ?? []) as Row[]).map((row) => fromDbRow(entity, row));
    return sortItems(entity, items) as unknown as CollectionItem<E>[];
  }

  async saveSingleton<E extends SingletonEntity>(
    userId: string,
    entity: E,
    data: SingletonDataMap[E],
  ): Promise<SingletonRecord<E>> {
    const row = toDbRow(entity, data as Row);
    // Update, then insert if there was nothing to update. A single upsert cannot be used: its
    // conflict branch also writes user_id, and the database grants clients no update right on
    // that column (so a row can never be handed to another account).
    const update = () =>
      this.client.from(entity).update(row).eq("user_id", userId).select("*").maybeSingle();

    const first = await update();
    if (first.error) fail(first.error);
    let saved: Row | null = first.data as Row | null;

    if (!saved) {
      const created = await this.client
        .from(entity)
        .insert({ ...row, user_id: userId })
        .select("*")
        .single();
      if (created.error?.code === UNIQUE_VIOLATION) {
        // Saved from another tab between our update and insert: update that row instead.
        const retry = await update();
        if (retry.error || !retry.data) fail(retry.error);
        saved = retry.data as Row;
      } else if (created.error) {
        fail(created.error);
      } else {
        saved = created.data as Row;
      }
    }
    return fromDbRow(entity, saved as Row) as unknown as SingletonRecord<E>;
  }

  async countItems(userId: string, entity: CollectionEntity): Promise<number> {
    const { count, error } = await this.client
      .from(entity)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) fail(error);
    return count ?? 0;
  }

  async createItem<E extends CollectionEntity>(
    userId: string,
    entity: E,
    data: Omit<CollectionItem<E>, "id" | "source" | "confirmed" | "created_at" | "updated_at">,
    options: CreateOptions = {},
  ): Promise<CollectionItem<E>> {
    const { data: created, error } = await this.client
      .from(entity)
      .insert({
        ...toDbRow(entity, data as Row),
        user_id: userId,
        source: options.source ?? "manual",
        confirmed: options.confirmed ?? true,
      })
      .select("*")
      .single();
    if (error) fail(error);
    return fromDbRow(entity, created as Row) as unknown as CollectionItem<E>;
  }

  async updateItem<E extends CollectionEntity>(
    userId: string,
    entity: E,
    id: string,
    data: Omit<CollectionItem<E>, "id" | "source" | "confirmed" | "created_at" | "updated_at">,
  ): Promise<CollectionItem<E>> {
    const { data: updated, error } = await this.client
      .from(entity)
      // Editing an item is the user vouching for it.
      .update({ ...toDbRow(entity, data as Row), confirmed: true })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) fail(error);
    if (!updated) throw new StoreError("not_found");
    return fromDbRow(entity, updated as Row) as unknown as CollectionItem<E>;
  }

  async confirmItem(userId: string, entity: CollectionEntity, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from(entity)
      .update({ confirmed: true })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0;
  }

  async confirmAll(userId: string): Promise<number> {
    let changed = 0;
    for (const entity of COLLECTION_ENTITIES) {
      const { data, error } = await this.client
        .from(entity)
        .update({ confirmed: true })
        .eq("user_id", userId)
        .eq("confirmed", false)
        .select("id");
      if (error) fail(error);
      changed += data?.length ?? 0;
    }
    return changed;
  }

  async deleteItem(userId: string, entity: CollectionEntity, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from(entity)
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (error) fail(error);
    return (data?.length ?? 0) > 0;
  }
}
