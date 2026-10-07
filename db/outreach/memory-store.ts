import { randomUUID } from "node:crypto";
import {
  MAX_DRAFTS,
  OutreachStoreError,
  type ApproveOutcome,
  type DraftEdit,
  type EditOutcome,
  type NewDraft,
  type OutreachDraft,
  type OutreachStore,
  type SentOutcome,
} from "@/db/outreach/store";

/** Bounds the demo sandbox so a long-running server cannot grow without limit. */
const MAX_SANDBOXES = 500;

/** Demo-mode store: one isolated, bounded, in-memory list per visitor. */
export class MemoryOutreachStore implements OutreachStore {
  private readonly sandboxes = new Map<string, OutreachDraft[]>();

  private box(userId: string): OutreachDraft[] {
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

  async list(userId: string, filter: { jobId?: string } = {}) {
    return structuredClone(
      this.box(userId)
        .filter((d) => !filter.jobId || d.jobId === filter.jobId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async get(userId: string, id: string) {
    const found = this.box(userId).find((d) => d.id === id);
    return found ? structuredClone(found) : null;
  }

  async create(userId: string, input: NewDraft): Promise<OutreachDraft> {
    const box = this.box(userId);
    if (box.length >= MAX_DRAFTS) throw new OutreachStoreError("limit");
    const now = new Date().toISOString();
    const draft: OutreachDraft = {
      id: randomUUID(),
      jobId: input.jobId,
      type: input.type,
      channel: input.doc.channel,
      recipientName: input.recipientName,
      recipientTitle: input.recipientTitle,
      sharedContext: input.sharedContext,
      subject: input.doc.subject,
      body: input.doc.text,
      doc: structuredClone(input.doc),
      verification: structuredClone(input.verification),
      profileHash: input.profileHash,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      sentAt: null,
    };
    box.push(draft);
    return structuredClone(draft);
  }

  async edit(userId: string, id: string, edit: DraftEdit): Promise<EditOutcome> {
    const found = this.box(userId).find((d) => d.id === id);
    if (!found) return "not_found";
    if (found.status !== "draft") return "locked";
    found.doc = structuredClone(edit.doc);
    found.subject = edit.doc.subject;
    found.body = edit.doc.text;
    found.verification = structuredClone(edit.verification);
    found.profileHash = edit.profileHash;
    found.updatedAt = new Date().toISOString();
    return "updated";
  }

  async approve(userId: string, id: string): Promise<ApproveOutcome> {
    const found = this.box(userId).find((d) => d.id === id);
    if (!found) return "not_found";
    if (found.status !== "draft") return "already_approved";
    if (!found.verification.ok) return "blocked";
    found.status = "approved";
    found.approvedAt = found.updatedAt = new Date().toISOString();
    return "approved";
  }

  async markSent(userId: string, id: string): Promise<SentOutcome> {
    const found = this.box(userId).find((d) => d.id === id);
    if (!found) return "not_found";
    if (found.status === "sent") return "already_sent";
    if (found.status !== "approved") return "not_approved";
    found.status = "sent";
    found.sentAt = found.updatedAt = new Date().toISOString();
    return "sent";
  }

  async remove(userId: string, id: string) {
    const box = this.box(userId);
    const index = box.findIndex((d) => d.id === id);
    if (index < 0) return false;
    box.splice(index, 1);
    return true;
  }

  async removeForJob(userId: string, jobId: string) {
    this.sandboxes.set(
      userId,
      this.box(userId).filter((d) => d.jobId !== jobId),
    );
  }
}
