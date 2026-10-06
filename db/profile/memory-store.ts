import { randomUUID } from "node:crypto";
import { sortItems } from "@/db/profile/mapping";
import {
  EMPTY_SNAPSHOT,
  StoreError,
  type CreateOptions,
  type DemoProfileStore,
  type ProfileSnapshot,
  type SingletonDataMap,
  type SingletonRecord,
} from "@/db/profile/store";
import { DEMO_PERSONAS, getPersona } from "@/db/seed/demo-personas";
import {
  COLLECTION_ENTITIES,
  type CollectionEntity,
  type CollectionItem,
  type SingletonEntity,
} from "@/lib/profile/schemas";

type Collections = { [E in CollectionEntity]: CollectionItem<E>[] };
interface State {
  profile: SingletonRecord<"profiles"> | null;
  goals: SingletonRecord<"career_goals"> | null;
  collections: Collections;
}

const emptyCollections = (): Collections => ({
  education: [],
  experiences: [],
  projects: [],
  certifications: [],
  skills: [],
  achievements: [],
});

/** Oldest sandboxes are evicted beyond this, so a public demo cannot grow without bound. */
const MAX_SANDBOXES = 500;

const now = () => new Date().toISOString();

/**
 * In-memory store backing demo mode. Each visitor id is an isolated sandbox seeded with a
 * demo persona. Data lives only in this server process and is never written to disk.
 */
export class MemoryProfileStore implements DemoProfileStore {
  private readonly states = new Map<string, State>();

  constructor(private readonly defaultPersonaId: string | null = DEMO_PERSONAS[0]?.id ?? null) {}

  private state(userId: string): State {
    let state = this.states.get(userId);
    if (!state) {
      state = { profile: null, goals: null, collections: emptyCollections() };
      this.states.set(userId, state);
      if (this.states.size > MAX_SANDBOXES) {
        const oldest = this.states.keys().next();
        if (!oldest.done) this.states.delete(oldest.value);
      }
      if (this.defaultPersonaId) this.seed(state, this.defaultPersonaId);
    } else {
      // Refresh recency so active sandboxes are evicted last.
      this.states.delete(userId);
      this.states.set(userId, state);
    }
    return state;
  }

  private seed(state: State, personaId: string) {
    const persona = getPersona(personaId);
    if (!persona) throw new StoreError("not_found");
    const stamp = now();
    state.profile = { ...persona.profile, id: randomUUID(), updated_at: stamp };
    state.goals = { ...persona.goals, id: randomUUID(), updated_at: stamp };
    state.collections = emptyCollections();
    for (const entity of COLLECTION_ENTITIES) {
      const items = persona[entity] as Omit<
        CollectionItem<typeof entity>,
        "id" | "source" | "confirmed" | "created_at" | "updated_at"
      >[];
      (state.collections[entity] as unknown[]) = items.map((data) => ({
        ...data,
        id: randomUUID(),
        source: "manual",
        confirmed: true,
        created_at: stamp,
        updated_at: stamp,
      }));
    }
  }

  async getSnapshot(userId: string): Promise<ProfileSnapshot> {
    const s = this.state(userId);
    return structuredClone({
      ...EMPTY_SNAPSHOT,
      profile: s.profile,
      goals: s.goals,
      education: sortItems("education", s.collections.education),
      experiences: sortItems("experiences", s.collections.experiences),
      projects: sortItems("projects", s.collections.projects),
      certifications: sortItems("certifications", s.collections.certifications),
      skills: sortItems("skills", s.collections.skills),
      achievements: sortItems("achievements", s.collections.achievements),
    });
  }

  async saveSingleton<E extends SingletonEntity>(
    userId: string,
    entity: E,
    data: SingletonDataMap[E],
  ): Promise<SingletonRecord<E>> {
    const s = this.state(userId);
    const key = entity === "profiles" ? "profile" : "goals";
    const existing = s[key];
    const record = { ...data, id: existing?.id ?? randomUUID(), updated_at: now() };
    (s[key] as unknown) = record;
    return structuredClone(record) as SingletonRecord<E>;
  }

  async countItems(userId: string, entity: CollectionEntity): Promise<number> {
    return this.state(userId).collections[entity].length;
  }

  async createItem<E extends CollectionEntity>(
    userId: string,
    entity: E,
    data: Omit<CollectionItem<E>, "id" | "source" | "confirmed" | "created_at" | "updated_at">,
    options: CreateOptions = {},
  ): Promise<CollectionItem<E>> {
    const list = this.state(userId).collections[entity] as CollectionItem<CollectionEntity>[];
    this.assertUnique(list, entity, data as Record<string, unknown>, null);
    const stamp = now();
    const item = {
      ...data,
      id: randomUUID(),
      source: options.source ?? "manual",
      confirmed: options.confirmed ?? true,
      created_at: stamp,
      updated_at: stamp,
    } as CollectionItem<E>;
    list.push(item as CollectionItem<CollectionEntity>);
    return structuredClone(item);
  }

  async updateItem<E extends CollectionEntity>(
    userId: string,
    entity: E,
    id: string,
    data: Omit<CollectionItem<E>, "id" | "source" | "confirmed" | "created_at" | "updated_at">,
  ): Promise<CollectionItem<E>> {
    const list = this.state(userId).collections[entity] as CollectionItem<CollectionEntity>[];
    const index = list.findIndex((item) => item.id === id);
    const existing = list[index];
    if (index === -1 || !existing) throw new StoreError("not_found");
    this.assertUnique(list, entity, data as Record<string, unknown>, id);
    const updated = {
      ...data,
      id,
      source: existing.source,
      // Editing an item is the user vouching for it.
      confirmed: true,
      created_at: existing.created_at,
      updated_at: now(),
    } as CollectionItem<E>;
    list[index] = updated as CollectionItem<CollectionEntity>;
    return structuredClone(updated);
  }

  async deleteItem(userId: string, entity: CollectionEntity, id: string): Promise<boolean> {
    const list = this.state(userId).collections[entity] as CollectionItem<CollectionEntity>[];
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) return false;
    list.splice(index, 1);
    return true;
  }

  async loadPersona(userId: string, personaId: string): Promise<void> {
    this.seed(this.state(userId), personaId);
  }

  async wipe(userId: string): Promise<void> {
    const s = this.state(userId);
    s.profile = null;
    s.goals = null;
    s.collections = emptyCollections();
  }

  private assertUnique(
    list: CollectionItem<CollectionEntity>[],
    entity: CollectionEntity,
    data: Record<string, unknown>,
    ignoreId: string | null,
  ) {
    if (entity !== "skills") return;
    const name = String(data.name ?? "").toLowerCase();
    const clash = list.some(
      (item) =>
        item.id !== ignoreId && String((item as { name: string }).name).toLowerCase() === name,
    );
    if (clash) throw new StoreError("duplicate");
  }
}
