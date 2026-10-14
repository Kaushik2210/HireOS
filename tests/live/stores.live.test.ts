// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseApplicationStore } from "@/db/applications/supabase-store";
import { SupabaseJobStore } from "@/db/jobs/supabase-store";
import { SupabaseProfileStore } from "@/db/profile/supabase-store";
import { SupabaseResumeStore } from "@/db/resume/supabase-store";
import { DEFAULT_JOB_QUERY } from "@/lib/jobs/schemas";
import { skillSchema } from "@/lib/profile/schemas";
import { normalizeRawJob } from "@/services/jobs/normalize";
import { MANUAL_SOURCE } from "@/services/jobs/providers/registry";
import { processResumeUpload } from "@/services/resume/upload";
import { CLASSIC } from "../fixtures/resume-texts";
import { makePdf } from "../fixtures/files";
import { createTestUser, liveReady, removeTestUsers, URL, type TestUser } from "./helpers";

// The store classes against a real Supabase stack, as two real accounts. These are the paths
// the unit tests can only check against fakes.

const suite = liveReady ? describe : describe.skip;

suite(`live Supabase (${URL || "not configured"})`, () => {
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    a = await createTestUser("a");
    b = await createTestUser("b");
  }, 60_000);

  afterAll(async () => {
    await removeTestUsers(a, b);
  }, 60_000);

  describe("profile", () => {
    it("saves, lists, confirms and deletes items, per account", async () => {
      const storeA = new SupabaseProfileStore(a.client);
      const storeB = new SupabaseProfileStore(b.client);

      const created = await storeA.createItem(
        a.id,
        "skills",
        skillSchema.parse({ name: "Rust", type: "language", level: "advanced" }),
      );
      expect(created.name).toBe("Rust");

      const snapshot = await storeA.getSnapshot(a.id);
      expect(snapshot.skills.map((s) => s.name)).toContain("Rust");

      // The other account sees none of it, and cannot touch it.
      expect((await storeB.getSnapshot(b.id)).skills).toEqual([]);
      expect(await storeB.deleteItem(b.id, "skills", created.id)).toBe(false);
      expect((await storeA.getSnapshot(a.id)).skills).toHaveLength(1);

      expect(await storeA.deleteItem(a.id, "skills", created.id)).toBe(true);
      expect((await storeA.getSnapshot(a.id)).skills).toEqual([]);
    });

    it("keeps a duplicate skill out", async () => {
      const store = new SupabaseProfileStore(a.client);
      const skill = skillSchema.parse({ name: "Go", type: "language", level: "beginner" });
      await store.createItem(a.id, "skills", skill);
      await expect(store.createItem(a.id, "skills", skill)).rejects.toMatchObject({
        kind: "duplicate",
      });
    });
  });

  describe("jobs", () => {
    it("shows the shared catalogue to everyone and private jobs only to their owner", async () => {
      const storeA = new SupabaseJobStore(a.client);
      const storeB = new SupabaseJobStore(b.client);

      const normalized = normalizeRawJob(
        {
          company_name: "Live Test Co",
          title: "Private Platform Engineer",
          location: "Pune",
          description: "Requirements\n• 3+ years of experience with Python and Docker",
        },
        MANUAL_SOURCE,
      );
      if (!normalized.ok) throw new Error(normalized.reason);
      const created = await storeA.createPrivate(a.id, normalized.job);
      expect(created.owner_user_id).toBe(a.id);

      expect((await storeA.get(a.id, created.id))?.title).toBe("Private Platform Engineer");
      expect(await storeB.get(b.id, created.id)).toBeNull();

      const foundByA = await storeA.search(a.id, { ...DEFAULT_JOB_QUERY, q: "Private Platform" });
      const foundByB = await storeB.search(b.id, { ...DEFAULT_JOB_QUERY, q: "Private Platform" });
      expect(foundByA.jobs.map((j) => j.id)).toContain(created.id);
      expect(foundByB.jobs.map((j) => j.id)).not.toContain(created.id);

      // The sample catalogue is visible to both.
      const shared = await storeB.search(b.id, DEFAULT_JOB_QUERY);
      expect(shared.total).toBeGreaterThan(0);

      expect(await storeB.deletePrivate(b.id, created.id)).toBe(false);
      expect(await storeA.deletePrivate(a.id, created.id)).toBe(true);
      expect(await storeA.get(a.id, created.id)).toBeNull();
    });
  });

  describe("resumes and storage", () => {
    it("uploads, reads back, serves a signed link, isolates and deletes the file with the row", async () => {
      const storeA = new SupabaseResumeStore(a.client);
      const storeB = new SupabaseResumeStore(b.client);

      const bytes = await makePdf(CLASSIC);
      const outcome = await processResumeUpload({
        userId: a.id,
        bytes,
        fileName: "live-test.pdf",
        store: storeA,
      });
      if (!outcome.ok) throw new Error(`upload failed: ${JSON.stringify(outcome)}`);
      const id = outcome.resume.id;

      const record = await storeA.get(a.id, id);
      expect(record?.has_file).toBe(true);
      expect(record?.parsed.skills.length).toBeGreaterThan(0);

      // A signed link works for the owner and downloads the same bytes.
      const url = await storeA.signedUrl(a.id, id);
      expect(url).toMatch(/^https?:\/\//);
      const downloaded = new Uint8Array(await (await fetch(url!)).arrayBuffer());
      expect(downloaded.byteLength).toBe(bytes.byteLength);

      // The other account can neither read, link nor delete it.
      expect(await storeB.get(b.id, id)).toBeNull();
      expect(await storeB.signedUrl(b.id, id)).toBeNull();
      expect(await storeB.delete(b.id, id)).toBe(false);
      expect(await storeB.list(b.id)).toEqual([]);

      // The same file again is recognised, not stored twice.
      const again = await processResumeUpload({
        userId: a.id,
        bytes,
        fileName: "copy.pdf",
        store: storeA,
      });
      expect(again.ok && again.duplicate).toBe(true);

      expect(await storeA.delete(a.id, id)).toBe(true);
      expect(await storeA.get(a.id, id)).toBeNull();
      const left = await a.client.storage.from("resumes").list(a.id);
      expect(left.data ?? []).toEqual([]);
    }, 60_000);

    it("keeps one account's folder closed to another account's session", async () => {
      const path = `${a.id}/probe.pdf`;
      const asB = await b.client.storage
        .from("resumes")
        .upload(path, Buffer.from("%PDF-1.4 x"), { contentType: "application/pdf" });
      expect(asB.error).not.toBeNull();
      const listed = await b.client.storage.from("resumes").list(a.id);
      expect(listed.data ?? []).toEqual([]);
    });
  });

  describe("applications", () => {
    it("tracks a job, moves it along allowed steps only, logs history and isolates accounts", async () => {
      const jobs = new SupabaseJobStore(a.client);
      const apps = new SupabaseApplicationStore(a.client);
      const other = new SupabaseApplicationStore(b.client);

      const { jobs: found } = await jobs.search(a.id, DEFAULT_JOB_QUERY);
      const job = found[0]!;
      const created = await apps.create(a.id, {
        jobId: job.id,
        jobTitle: job.title,
        companyName: job.company_name,
        status: "shortlisted",
        appliedOn: null,
      });
      expect(created.status).toBe("shortlisted");

      await expect(
        apps.create(a.id, {
          jobId: job.id,
          jobTitle: job.title,
          companyName: job.company_name,
          status: "shortlisted",
          appliedOn: null,
        }),
      ).rejects.toMatchObject({ kind: "duplicate" });

      expect(await apps.changeStatus(a.id, created.id, "offer", null, null)).toBe("not_allowed");
      expect(await apps.changeStatus(a.id, created.id, "applied", null, null)).toBe("moved");
      expect(await apps.changeStatus(a.id, created.id, "interview", "Phone screen", null)).toBe(
        "moved",
      );

      const detail = await apps.get(a.id, created.id);
      expect(detail?.application.status).toBe("interview");
      const kinds = detail?.events.map((e) => e.kind) ?? [];
      expect(kinds.length).toBeGreaterThanOrEqual(3);

      expect(await apps.addEvent(a.id, created.id, "note", "Spoke to the recruiter")).toBe("added");

      // Nothing of it is visible or movable from the other account.
      expect(await other.get(b.id, created.id)).toBeNull();
      expect(await other.list(b.id)).toEqual([]);
      expect(await other.changeStatus(b.id, created.id, "rejected", null, null)).toBe("not_found");
      expect(await other.remove(b.id, created.id)).toBe(false);

      expect(await apps.remove(a.id, created.id)).toBe(true);
    });
  });
});
