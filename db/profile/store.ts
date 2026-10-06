import type {
  CareerGoalData,
  CollectionEntity,
  CollectionItem,
  ProfileData,
  SingletonEntity,
} from "@/lib/profile/schemas";

export type SingletonDataMap = { profiles: ProfileData; career_goals: CareerGoalData };
export type SingletonRecord<E extends SingletonEntity> = SingletonDataMap[E] & {
  id: string;
  updated_at: string;
};

/** Everything a user has stored, in one read. */
export interface ProfileSnapshot {
  profile: SingletonRecord<"profiles"> | null;
  goals: SingletonRecord<"career_goals"> | null;
  education: CollectionItem<"education">[];
  experiences: CollectionItem<"experiences">[];
  projects: CollectionItem<"projects">[];
  certifications: CollectionItem<"certifications">[];
  skills: CollectionItem<"skills">[];
  achievements: CollectionItem<"achievements">[];
}

export type StoreErrorKind = "duplicate" | "not_found" | "unknown";

/** Carries a safe, user-presentable kind. Never wraps raw database messages. */
export class StoreError extends Error {
  constructor(
    public readonly kind: StoreErrorKind,
    cause?: unknown,
  ) {
    super(`Profile store error: ${kind}`, cause === undefined ? undefined : { cause });
    this.name = "StoreError";
  }
}

export interface CreateOptions {
  source?: "manual" | "resume";
  confirmed?: boolean;
}

/**
 * Persistence for the candidate profile. Implementations must scope every operation to
 * `userId`; the Supabase implementation additionally relies on Row Level Security.
 */
export interface ProfileStore {
  getSnapshot(userId: string): Promise<ProfileSnapshot>;
  saveSingleton<E extends SingletonEntity>(
    userId: string,
    entity: E,
    data: SingletonDataMap[E],
  ): Promise<SingletonRecord<E>>;
  countItems(userId: string, entity: CollectionEntity): Promise<number>;
  createItem<E extends CollectionEntity>(
    userId: string,
    entity: E,
    data: Omit<CollectionItem<E>, "id" | "source" | "confirmed" | "created_at" | "updated_at">,
    options?: CreateOptions,
  ): Promise<CollectionItem<E>>;
  /** Throws StoreError("not_found") when the id does not exist for this user. */
  updateItem<E extends CollectionEntity>(
    userId: string,
    entity: E,
    id: string,
    data: Omit<CollectionItem<E>, "id" | "source" | "confirmed" | "created_at" | "updated_at">,
  ): Promise<CollectionItem<E>>;
  /** Returns false when nothing was deleted. */
  deleteItem(userId: string, entity: CollectionEntity, id: string): Promise<boolean>;
  /** Marks one item as confirmed (verified). Returns false when it does not exist. */
  confirmItem(userId: string, entity: CollectionEntity, id: string): Promise<boolean>;
  /** Confirms every pending item and returns how many changed. */
  confirmAll(userId: string): Promise<number>;
}

/** Extra operations available only in demo mode, where data is a disposable sandbox. */
export interface DemoProfileStore extends ProfileStore {
  loadPersona(userId: string, personaId: string): Promise<void>;
  wipe(userId: string): Promise<void>;
}

export const EMPTY_SNAPSHOT: ProfileSnapshot = {
  profile: null,
  goals: null,
  education: [],
  experiences: [],
  projects: [],
  certifications: [],
  skills: [],
  achievements: [],
};
