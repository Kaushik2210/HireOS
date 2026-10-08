import { randomUUID } from "node:crypto";
import {
  InterviewStoreError,
  type Interview,
  type InterviewFields,
  type InterviewStore,
  type NewInterview,
  type UpdateOutcome,
} from "@/db/interviews/store";
import { MAX_INTERVIEWS, type InterviewStatus } from "@/lib/interview/types";

/** Bounds the demo sandbox so a long-running server cannot grow without limit. */
const MAX_SANDBOXES = 500;

const sortKey = (i: Interview) => `${i.scheduledOn ?? "9999-99-99"}T${i.scheduledTime ?? "99:99"}`;

/** Demo-mode store: one isolated, bounded, in-memory list per visitor. */
export class MemoryInterviewStore implements InterviewStore {
  private readonly sandboxes = new Map<string, Interview[]>();

  private box(userId: string): Interview[] {
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

  async list(userId: string, filter: { applicationId?: string } = {}) {
    return structuredClone(
      this.box(userId)
        .filter((i) => !filter.applicationId || i.applicationId === filter.applicationId)
        .sort(
          (a, b) => sortKey(a).localeCompare(sortKey(b)) || a.createdAt.localeCompare(b.createdAt),
        ),
    );
  }

  async get(userId: string, id: string) {
    const found = this.box(userId).find((i) => i.id === id);
    return found ? structuredClone(found) : null;
  }

  async create(userId: string, input: NewInterview): Promise<Interview> {
    const box = this.box(userId);
    if (box.length >= MAX_INTERVIEWS) throw new InterviewStoreError("limit");
    const now = new Date().toISOString();
    const interview: Interview = {
      id: randomUUID(),
      applicationId: input.applicationId,
      roundLabel: input.roundLabel,
      kind: input.kind,
      format: input.format,
      scheduledOn: input.scheduledOn,
      scheduledTime: input.scheduledTime,
      interviewer: input.interviewer,
      notes: input.notes,
      status: "scheduled",
      checklist: structuredClone(input.checklist),
      createdAt: now,
      updatedAt: now,
    };
    box.push(interview);
    return structuredClone(interview);
  }

  async update(
    userId: string,
    id: string,
    fields: InterviewFields & { status: InterviewStatus },
  ): Promise<UpdateOutcome> {
    const found = this.box(userId).find((i) => i.id === id);
    if (!found) return "not_found";
    Object.assign(found, fields, { updatedAt: new Date().toISOString() });
    return "updated";
  }

  async setChecklist(userId: string, id: string, checklist: Interview["checklist"]) {
    const found = this.box(userId).find((i) => i.id === id);
    if (!found) return "not_found" as const;
    found.checklist = structuredClone(checklist);
    found.updatedAt = new Date().toISOString();
    return "updated" as const;
  }

  async remove(userId: string, id: string) {
    const box = this.box(userId);
    const index = box.findIndex((i) => i.id === id);
    if (index < 0) return false;
    box.splice(index, 1);
    return true;
  }

  /** The database removes a deleted application's rounds by cascade; the demo store does it here. */
  async removeForApplication(userId: string, applicationId: string) {
    this.sandboxes.set(
      userId,
      this.box(userId).filter((i) => i.applicationId !== applicationId),
    );
  }
}
