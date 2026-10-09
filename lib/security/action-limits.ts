import type { ActionResult } from "@/lib/action-result";
import { createSharedLimiter, type SharedLimiter } from "@/lib/security/limits";

/**
 * Per-person brakes on server actions. They are generous for a human using the app and
 * exist to stop a script (or a stuck loop) from hammering the database, filling a quota or
 * running up the cost of anything expensive added later.
 *
 * - "write": any change a person makes (save, edit, delete, move).
 * - "heavy": work that builds something (a document version, a draft, a practice session,
 *   an import).
 */
export type ActionKind = "write" | "heavy";

const LIMITERS: Record<ActionKind, SharedLimiter> = {
  write: createSharedLimiter({ name: "action-write", limit: 180, windowMs: 60_000 }),
  heavy: createSharedLimiter({ name: "action-heavy", limit: 60, windowMs: 60 * 60_000 }),
};

const TOO_MANY: ActionResult = {
  ok: false,
  error: "You are doing that very quickly. Please wait a moment and try again.",
};

/** Returns an error result when the person is over the limit, otherwise null. */
export async function limitAction(
  userId: string,
  kind: ActionKind = "write",
): Promise<ActionResult | null> {
  const { ok } = await LIMITERS[kind].check(userId);
  return ok ? null : TOO_MANY;
}

/** Clears local counters (tests). */
export function resetActionLimits(): void {
  for (const limiter of Object.values(LIMITERS)) limiter.reset();
}
