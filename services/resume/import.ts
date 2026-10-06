import { StoreError, type ProfileSnapshot, type ProfileStore } from "@/db/profile/store";
import { MAX_ITEMS_PER_COLLECTION } from "@/lib/profile/constants";
import {
  COLLECTION_ENTITIES,
  profileSchema,
  type CollectionEntity,
  type ProfileData,
} from "@/lib/profile/schemas";
import type { ParsedResume } from "@/lib/resume/schemas";

type Item = Record<string, unknown>;

/** What importing would do, computed before anything is written. */
export interface ImportPlan {
  items: { [E in CollectionEntity]: Item[] };
  /** Items skipped because the profile already has them. */
  duplicates: { [E in CollectionEntity]: number };
  /** Items skipped because a section is full. */
  overLimit: { [E in CollectionEntity]: number };
  /** Set only when the profile is empty and the resume gave a usable name. */
  profile: ProfileData | null;
  total: number;
}

export interface ImportResult {
  created: { [E in CollectionEntity]: number };
  duplicates: number;
  profileCreated: boolean;
  total: number;
}

const lc = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

/** Natural keys used to recognise the same entry already in the profile. */
const KEYS: Record<CollectionEntity, (i: Item) => string> = {
  skills: (i) => lc(i.name),
  experiences: (i) => `${lc(i.organization)}|${lc(i.title)}|${lc(i.start_date)}`,
  projects: (i) => lc(i.name),
  education: (i) => `${lc(i.institution)}|${lc(i.degree)}`,
  certifications: (i) => lc(i.name),
  achievements: (i) => lc(i.title),
};

const emptyCounts = (): { [E in CollectionEntity]: number } => ({
  education: 0,
  experiences: 0,
  projects: 0,
  certifications: 0,
  skills: 0,
  achievements: 0,
});

/** Pure: decides what to create without touching the store. */
export function buildImportPlan(parsed: ParsedResume, snapshot: ProfileSnapshot): ImportPlan {
  const incoming: { [E in CollectionEntity]: Item[] } = {
    education: parsed.education,
    experiences: parsed.experiences,
    projects: parsed.projects,
    certifications: parsed.certifications,
    skills: parsed.skills,
    achievements: parsed.achievements,
  };

  const items = {} as ImportPlan["items"];
  const duplicates = emptyCounts();
  const overLimit = emptyCounts();
  let total = 0;

  for (const entity of COLLECTION_ENTITIES) {
    const existing = snapshot[entity] as unknown as Item[];
    const seen = new Set(existing.map(KEYS[entity]));
    let room = Math.max(MAX_ITEMS_PER_COLLECTION - existing.length, 0);
    items[entity] = [];

    for (const candidate of incoming[entity]) {
      const key = KEYS[entity](candidate);
      if (seen.has(key)) {
        duplicates[entity] += 1;
        continue;
      }
      if (room === 0) {
        overLimit[entity] += 1;
        continue;
      }
      seen.add(key);
      room -= 1;
      items[entity].push(candidate);
      total += 1;
    }
  }

  let profile: ProfileData | null = null;
  if (!snapshot.profile && parsed.contact.full_name) {
    const draft = profileSchema.safeParse({
      full_name: parsed.contact.full_name,
      summary: parsed.summary,
      location: parsed.contact.location,
      linkedin_url: parsed.contact.linkedin_url,
      github_url: parsed.contact.github_url,
      website_url: parsed.contact.website_url,
    });
    if (draft.success) profile = draft.data;
  }

  return { items, duplicates, overLimit, profile, total };
}

/**
 * Writes the plan. Items arrive as source "resume" and unconfirmed: they are proposals the
 * user must review, and none counts as verified until they confirm or edit it.
 */
export async function applyImportPlan(
  store: ProfileStore,
  userId: string,
  plan: ImportPlan,
): Promise<ImportResult> {
  const created = emptyCounts();
  let raceDuplicates = 0;

  for (const entity of COLLECTION_ENTITIES) {
    for (const data of plan.items[entity]) {
      try {
        await store.createItem(userId, entity, data as never, {
          source: "resume",
          confirmed: false,
        });
        created[entity] += 1;
      } catch (error) {
        // Someone added the same entry between planning and writing.
        if (error instanceof StoreError && error.kind === "duplicate") raceDuplicates += 1;
        else throw error;
      }
    }
  }

  let profileCreated = false;
  if (plan.profile) {
    await store.saveSingleton(userId, "profiles", plan.profile);
    profileCreated = true;
  }

  const total = Object.values(created).reduce((a, b) => a + b, 0);
  const duplicates = Object.values(plan.duplicates).reduce((a, b) => a + b, 0) + raceDuplicates;
  return { created, duplicates, profileCreated, total };
}
