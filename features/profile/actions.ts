"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDemoProfileStore, getProfileStore } from "@/db/profile";
import { StoreError } from "@/db/profile/store";
import { invalidResult, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { MAX_ITEMS_PER_COLLECTION } from "@/lib/profile/constants";
import {
  COLLECTION_ENTITIES,
  careerGoalSchema,
  collectionSchemas,
  profileSchema,
  type CollectionEntity,
} from "@/lib/profile/schemas";
import { normalizeSkill } from "@/lib/skills/catalog";
import { getPersona } from "@/db/seed/demo-personas";

const entitySchema = z.enum(COLLECTION_ENTITIES);
const idSchema = z.uuid();

const SAVE_FAILED: ActionResult = {
  ok: false,
  error: "Could not save your changes. Please try again.",
};

function refresh() {
  revalidatePath("/profile");
  revalidatePath("/dashboard");
}

/** Create (id = null) or update one item in a collection such as skills or projects. */
export async function saveItemAction(
  entityInput: string,
  id: string | null,
  input: unknown,
): Promise<ActionResult> {
  const entity = entitySchema.safeParse(entityInput);
  if (!entity.success) return { ok: false, error: "Unknown section." };
  const itemId = id === null ? null : idSchema.safeParse(id);
  if (itemId && !itemId.success) return { ok: false, error: "Unknown item." };

  const user = await requireUser();
  const parsed = collectionSchemas[entity.data].safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  const data = parsed.data as Record<string, unknown>;

  // Standardise recognised skill names (e.g. "js" becomes "JavaScript").
  if (entity.data === "skills") data.name = normalizeSkill(String(data.name)).name;

  try {
    const store = await getProfileStore(user);
    if (itemId?.success) {
      await store.updateItem(user.id, entity.data, itemId.data, data as never);
    } else {
      if ((await store.countItems(user.id, entity.data)) >= MAX_ITEMS_PER_COLLECTION) {
        return {
          ok: false,
          error: `You can store up to ${MAX_ITEMS_PER_COLLECTION} entries here. Remove one first.`,
        };
      }
      await store.createItem(user.id, entity.data, data as never);
    }
  } catch (error) {
    if (error instanceof StoreError) {
      if (error.kind === "duplicate") {
        return {
          ok: false,
          error: "You already have this skill.",
          fieldErrors: { name: ["You already have this skill"] },
        };
      }
      if (error.kind === "not_found") return { ok: false, error: "That entry no longer exists." };
    }
    return SAVE_FAILED;
  }

  refresh();
  return { ok: true };
}

export async function deleteItemAction(entityInput: string, id: string): Promise<ActionResult> {
  const entity = entitySchema.safeParse(entityInput);
  const itemId = idSchema.safeParse(id);
  if (!entity.success || !itemId.success) return { ok: false, error: "Unknown item." };

  const user = await requireUser();
  try {
    const store = await getProfileStore(user);
    const deleted = await store.deleteItem(user.id, entity.data as CollectionEntity, itemId.data);
    if (!deleted) return { ok: false, error: "That entry no longer exists." };
  } catch {
    return { ok: false, error: "Could not delete. Please try again." };
  }
  refresh();
  return { ok: true };
}

export async function saveProfileAction(input: unknown): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  const user = await requireUser();
  try {
    await (await getProfileStore(user)).saveSingleton(user.id, "profiles", parsed.data);
  } catch {
    return SAVE_FAILED;
  }
  refresh();
  return { ok: true };
}

export async function saveGoalsAction(input: unknown): Promise<ActionResult> {
  const parsed = careerGoalSchema.safeParse(input);
  if (!parsed.success) return invalidResult(parsed.error);
  const user = await requireUser();
  try {
    await (await getProfileStore(user)).saveSingleton(user.id, "career_goals", parsed.data);
  } catch {
    return SAVE_FAILED;
  }
  refresh();
  return { ok: true };
}

/** Demo mode only: replace the sandbox with one of the fictional personas. */
export async function loadDemoPersonaAction(personaId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.isDemo) return { ok: false, error: "Demo data is only available in demo mode." };
  if (!getPersona(personaId)) return { ok: false, error: "Unknown demo profile." };
  await getDemoProfileStore().loadPersona(user.id, personaId);
  refresh();
  return { ok: true };
}

/** Demo mode only: empty the sandbox so you can start from a blank profile. */
export async function wipeDemoDataAction(): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.isDemo) return { ok: false, error: "Demo data is only available in demo mode." };
  await getDemoProfileStore().wipe(user.id);
  refresh();
  return { ok: true };
}

/** Confirm one item the user has reviewed, so it counts as verified. */
export async function confirmItemAction(entityInput: string, id: string): Promise<ActionResult> {
  const entity = entitySchema.safeParse(entityInput);
  const itemId = idSchema.safeParse(id);
  if (!entity.success || !itemId.success) return { ok: false, error: "Unknown item." };

  const user = await requireUser();
  try {
    const confirmed = await (
      await getProfileStore(user)
    ).confirmItem(user.id, entity.data, itemId.data);
    if (!confirmed) return { ok: false, error: "That entry no longer exists." };
  } catch {
    return SAVE_FAILED;
  }
  refresh();
  return { ok: true };
}

/** Confirm everything awaiting review. The UI asks the user to look first. */
export async function confirmAllAction(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const changed = await (await getProfileStore(user)).confirmAll(user.id);
    refresh();
    return { ok: true, message: `Confirmed ${changed} ${changed === 1 ? "item" : "items"}.` };
  } catch {
    return SAVE_FAILED;
  }
}
