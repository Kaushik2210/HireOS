import {
  ResumeStoreError,
  type NewResume,
  type ResumeRecord,
  type ResumeStore,
  type ResumeSummary,
} from "@/db/resume/store";

const MAX_SANDBOXES = 500;

const summarize = (r: ResumeRecord): ResumeSummary => ({
  id: r.id,
  file_name: r.file_name,
  kind: r.kind,
  size_bytes: r.size_bytes,
  page_count: r.page_count,
  health_score: r.health_score,
  created_at: r.created_at,
});

/**
 * Demo-mode store. Keeps the analysis results in server memory only. The uploaded file
 * itself is discarded after parsing, so there is nothing to download and nothing to leak.
 */
export class MemoryResumeStore implements ResumeStore {
  private readonly sandboxes = new Map<string, Map<string, ResumeRecord>>();

  private box(userId: string): Map<string, ResumeRecord> {
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

  async list(userId: string): Promise<ResumeSummary[]> {
    return [...this.box(userId).values()]
      .map(summarize)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async get(userId: string, id: string): Promise<ResumeRecord | null> {
    const record = this.box(userId).get(id);
    return record ? structuredClone(record) : null;
  }

  async findByHash(userId: string, sha256: string): Promise<ResumeSummary | null> {
    const hit = [...this.box(userId).values()].find((r) => r.sha256 === sha256);
    return hit ? summarize(hit) : null;
  }

  async count(userId: string): Promise<number> {
    return this.box(userId).size;
  }

  async create(userId: string, record: NewResume, _file: Uint8Array): Promise<ResumeSummary> {
    const box = this.box(userId);
    if ([...box.values()].some((r) => r.sha256 === record.sha256)) {
      throw new ResumeStoreError("duplicate");
    }
    const stored: ResumeRecord = {
      ...structuredClone(record),
      health_score: record.health.score,
      created_at: new Date().toISOString(),
      has_file: false,
    };
    box.set(record.id, stored);
    return summarize(stored);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    return this.box(userId).delete(id);
  }

  async signedUrl(): Promise<string | null> {
    return null;
  }
}
