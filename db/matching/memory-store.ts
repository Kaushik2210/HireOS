import type { MatchStore, StoredMatch } from "@/db/matching/store";
import type { MatchResult } from "@/lib/matching/types";

/** Bounds the demo sandbox so a long-running server cannot grow without limit. */
const MAX_SANDBOXES = 500;
const MAX_MATCHES_PER_USER = 2000;

/** Demo-mode store: one isolated, bounded, in-memory map per visitor. */
export class MemoryMatchStore implements MatchStore {
  private readonly sandboxes = new Map<string, Map<string, StoredMatch>>();

  private box(userId: string): Map<string, StoredMatch> {
    let box = this.sandboxes.get(userId);
    if (!box) {
      box = new Map();
      this.sandboxes.set(userId, box);
      if (this.sandboxes.size > MAX_SANDBOXES) {
        const oldest = this.sandboxes.keys().next();
        if (!oldest.done) this.sandboxes.delete(oldest.value);
      }
    }
    return box;
  }

  async get(userId: string, jobId: string): Promise<StoredMatch | null> {
    const found = this.box(userId).get(jobId);
    return found ? structuredClone(found) : null;
  }

  async save(userId: string, jobId: string, result: MatchResult, profileHash: string) {
    const box = this.box(userId);
    if (!box.has(jobId) && box.size >= MAX_MATCHES_PER_USER) {
      const oldest = box.keys().next();
      if (!oldest.done) box.delete(oldest.value);
    }
    box.set(jobId, {
      jobId,
      result: structuredClone(result),
      profileHash,
      computedAt: new Date().toISOString(),
    });
  }
}
