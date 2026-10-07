import { randomUUID } from "node:crypto";
import { buildDemoApplications } from "@/db/applications/demo-seed";
import {
  ApplicationStoreError,
  type Application,
  type ApplicationEvent,
  type ApplicationWithEvents,
  type DemoApplicationStore,
  type DetailsUpdate,
  type EventOutcome,
  type MoveOutcome,
  type NewApplication,
  type UpdateOutcome,
} from "@/db/applications/store";
import type { Job } from "@/lib/jobs/schemas";
import { MAX_APPLICATIONS, canMove, type EventKind, type Status } from "@/lib/applications/types";

/** Bounds the demo sandbox so a long-running server cannot grow without limit. */
const MAX_SANDBOXES = 500;

interface Sandbox {
  applications: Application[];
  events: ApplicationEvent[];
  seeded: boolean;
}

export interface MemoryApplicationOptions {
  /** Jobs the sample applications can attach to. Without it no samples are created. */
  loadDemoJobs?: () => Promise<readonly Job[]>;
  now?: () => Date;
}

const dateOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Demo-mode store. It mirrors the database rules (allowed moves, one application per job,
 * append-only events, the same limits) so the demo behaves like the real thing.
 */
export class MemoryApplicationStore implements DemoApplicationStore {
  private readonly sandboxes = new Map<string, Sandbox>();
  private readonly now: () => Date;

  constructor(private readonly options: MemoryApplicationOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  private async box(userId: string): Promise<Sandbox> {
    let box = this.sandboxes.get(userId);
    if (!box) {
      box = { applications: [], events: [], seeded: false };
      this.sandboxes.set(userId, box);
      if (this.sandboxes.size > MAX_SANDBOXES) {
        const oldest = this.sandboxes.keys().next();
        if (!oldest.done) this.sandboxes.delete(oldest.value);
      }
    }
    if (!box.seeded) {
      box.seeded = true;
      if (this.options.loadDemoJobs) {
        const samples = buildDemoApplications(
          await this.options.loadDemoJobs(),
          this.now(),
          randomUUID,
        );
        for (const s of samples) {
          box.applications.push(s.application);
          box.events.push(...s.events);
        }
      }
    }
    return box;
  }

  private log(
    box: Sandbox,
    applicationId: string,
    kind: EventKind,
    fields: Partial<Pick<ApplicationEvent, "fromStatus" | "toStatus" | "note">> = {},
  ) {
    box.events.push({
      id: randomUUID(),
      applicationId,
      kind,
      fromStatus: fields.fromStatus ?? null,
      toStatus: fields.toStatus ?? null,
      note: fields.note ?? null,
      createdAt: this.now().toISOString(),
    });
  }

  async list(userId: string) {
    const box = await this.box(userId);
    return structuredClone(
      [...box.applications].sort((a, b) => b.statusChangedAt.localeCompare(a.statusChangedAt)),
    );
  }

  async get(userId: string, id: string): Promise<ApplicationWithEvents | null> {
    const box = await this.box(userId);
    const application = box.applications.find((a) => a.id === id);
    if (!application) return null;
    return structuredClone({
      application,
      events: box.events
        .filter((e) => e.applicationId === id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    });
  }

  async getByJob(userId: string, jobId: string) {
    const found = (await this.box(userId)).applications.find((a) => a.jobId === jobId);
    return found ? structuredClone(found) : null;
  }

  async create(userId: string, input: NewApplication): Promise<Application> {
    const box = await this.box(userId);
    if (box.applications.some((a) => a.jobId === input.jobId)) {
      throw new ApplicationStoreError("duplicate");
    }
    if (box.applications.length >= MAX_APPLICATIONS) throw new ApplicationStoreError("limit");
    const now = this.now();
    let appliedOn: string | null = null;
    if (input.status === "applied") {
      appliedOn = input.appliedOn ?? dateOf(now);
      if (appliedOn > dateOf(new Date(now.getTime() + 86_400_000))) {
        throw new ApplicationStoreError("invalid");
      }
    }
    const iso = now.toISOString();
    const application: Application = {
      id: randomUUID(),
      jobId: input.jobId,
      jobTitle: input.jobTitle,
      companyName: input.companyName,
      status: input.status,
      appliedOn,
      followUpOn: null,
      notes: null,
      resumeVersionId: null,
      coverLetterVersionId: null,
      statusChangedAt: iso,
      createdAt: iso,
      updatedAt: iso,
      isDemo: false,
    };
    box.applications.push(application);
    this.log(box, application.id, "created", { toStatus: input.status });
    return structuredClone(application);
  }

  async changeStatus(
    userId: string,
    id: string,
    to: Status,
    note: string | null,
    appliedOn: string | null,
  ): Promise<MoveOutcome> {
    const box = await this.box(userId);
    const app = box.applications.find((a) => a.id === id);
    if (!app) return "not_found";
    if (!canMove(app.status, to)) return "not_allowed";
    const from = app.status;
    app.status = to;
    if (to === "applied") app.appliedOn = appliedOn ?? app.appliedOn ?? dateOf(this.now());
    app.statusChangedAt = app.updatedAt = this.now().toISOString();
    this.log(box, id, "status_changed", { fromStatus: from, toStatus: to, note });
    return "moved";
  }

  async updateDetails(userId: string, id: string, update: DetailsUpdate): Promise<UpdateOutcome> {
    const box = await this.box(userId);
    const app = box.applications.find((a) => a.id === id);
    if (!app) return "not_found";
    const followChanged = update.followUpOn !== app.followUpOn;
    const docsChanged =
      update.resumeVersionId !== app.resumeVersionId ||
      update.coverLetterVersionId !== app.coverLetterVersionId;
    app.notes = update.notes;
    app.followUpOn = update.followUpOn;
    app.resumeVersionId = update.resumeVersionId;
    app.coverLetterVersionId = update.coverLetterVersionId;
    app.updatedAt = this.now().toISOString();
    if (followChanged) {
      this.log(box, id, "follow_up_set", { note: update.followUpOn ?? "cleared" });
    }
    if (docsChanged) this.log(box, id, "documents_linked");
    return "updated";
  }

  async addEvent(
    userId: string,
    id: string,
    kind: "note" | "followed_up",
    note: string | null,
  ): Promise<EventOutcome> {
    const box = await this.box(userId);
    if (!box.applications.some((a) => a.id === id)) return "not_found";
    if (kind === "note" && !note?.trim()) return "invalid";
    this.log(box, id, kind, { note: note?.trim() || null });
    return "added";
  }

  async remove(userId: string, id: string) {
    const box = await this.box(userId);
    const index = box.applications.findIndex((a) => a.id === id);
    if (index < 0) return false;
    box.applications.splice(index, 1);
    box.events = box.events.filter((e) => e.applicationId !== id);
    return true;
  }

  async detachJob(userId: string, jobId: string) {
    const box = await this.box(userId);
    for (const a of box.applications) if (a.jobId === jobId) a.jobId = null;
  }

  async wipeDemo(userId: string) {
    const box = await this.box(userId);
    const ids = new Set(box.applications.filter((a) => a.isDemo).map((a) => a.id));
    box.applications = box.applications.filter((a) => !ids.has(a.id));
    box.events = box.events.filter((e) => !ids.has(e.applicationId));
    return ids.size;
  }

  async hasDemo(userId: string) {
    return (await this.box(userId)).applications.some((a) => a.isDemo);
  }
}
