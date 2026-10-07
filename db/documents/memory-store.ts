import { randomUUID } from "node:crypto";
import {
  DocumentStoreError,
  MAX_VERSIONS_PER_USER,
  type ApproveOutcome,
  type DocumentStore,
  type DocumentVersion,
  type NewVersion,
} from "@/db/documents/store";
import type { DocumentKind } from "@/lib/tailoring/types";

/** Bounds the demo sandbox so a long-running server cannot grow without limit. */
const MAX_SANDBOXES = 500;

/** Demo-mode store: one isolated, bounded, in-memory list per visitor. */
export class MemoryDocumentStore implements DocumentStore {
  private readonly sandboxes = new Map<string, DocumentVersion[]>();

  private box(userId: string): DocumentVersion[] {
    let box = this.sandboxes.get(userId);
    if (!box) {
      box = [];
      this.sandboxes.set(userId, box);
      if (this.sandboxes.size > MAX_SANDBOXES) {
        const oldest = this.sandboxes.keys().next();
        if (!oldest.done) this.sandboxes.delete(oldest.value);
      }
    }
    return box;
  }

  async list(userId: string, filter: { jobId?: string; kind?: DocumentKind } = {}) {
    return structuredClone(
      this.box(userId)
        .filter(
          (v) =>
            (!filter.jobId || v.jobId === filter.jobId) && (!filter.kind || v.kind === filter.kind),
        )
        .sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || b.versionNumber - a.versionNumber,
        ),
    );
  }

  async get(userId: string, id: string) {
    const found = this.box(userId).find((v) => v.id === id);
    return found ? structuredClone(found) : null;
  }

  async create(userId: string, input: NewVersion): Promise<DocumentVersion> {
    const box = this.box(userId);
    if (box.length >= MAX_VERSIONS_PER_USER) throw new DocumentStoreError("limit");
    const latest = box
      .filter((v) => v.jobId === input.jobId && v.kind === input.kind)
      .reduce((max, v) => Math.max(max, v.versionNumber), 0);
    const parent = input.parentId ? box.find((v) => v.id === input.parentId) : null;
    const version: DocumentVersion = {
      id: randomUUID(),
      jobId: input.jobId,
      kind: input.kind,
      versionNumber: latest + 1,
      parentId: parent ? parent.id : null,
      status: "draft",
      content: structuredClone(input.content),
      changes: structuredClone(input.changes),
      missing: structuredClone(input.missing),
      verification: structuredClone(input.verification),
      body: input.body,
      tailorVersion: input.content.doc.tailor_version,
      profileHash: input.profileHash,
      createdAt: new Date().toISOString(),
      approvedAt: null,
    };
    box.push(version);
    return structuredClone(version);
  }

  async approve(userId: string, id: string): Promise<ApproveOutcome> {
    const found = this.box(userId).find((v) => v.id === id);
    if (!found) return "not_found";
    if (found.status === "approved") return "already_approved";
    if (!found.verification.ok) return "blocked";
    found.status = "approved";
    found.approvedAt = new Date().toISOString();
    return "approved";
  }

  async remove(userId: string, id: string) {
    const box = this.box(userId);
    const index = box.findIndex((v) => v.id === id);
    if (index < 0) return false;
    const [removed] = box.splice(index, 1);
    for (const v of box) if (v.parentId === removed!.id) v.parentId = null;
    return true;
  }

  async removeForJob(userId: string, jobId: string) {
    const box = this.box(userId);
    this.sandboxes.set(
      userId,
      box.filter((v) => v.jobId !== jobId),
    );
  }
}
