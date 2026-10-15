// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseApplicationStore } from "@/db/applications/supabase-store";
import { SupabaseDocumentStore } from "@/db/documents/supabase-store";
import { SupabaseInterviewStore } from "@/db/interviews/supabase-store";
import { SupabaseJobStore } from "@/db/jobs/supabase-store";
import { SupabaseMatchStore } from "@/db/matching/supabase-store";
import { SupabaseOutreachStore } from "@/db/outreach/supabase-store";
import { SupabasePracticeStore } from "@/db/practice/supabase-store";
import { SupabaseProfileStore } from "@/db/profile/supabase-store";
import { getPersona } from "@/db/seed/demo-personas";
import { COLLECTION_ENTITIES, type CollectionEntity } from "@/lib/profile/schemas";
import type { Job } from "@/lib/jobs/schemas";
import { DEFAULT_JOB_QUERY } from "@/lib/jobs/schemas";
import { buildQuestions } from "@/services/interview/questions";
import { rankJobs } from "@/services/matching/rank";
import { buildCandidate } from "@/services/matching/candidate";
import { prepareDraft } from "@/services/outreach/prepare";
import { prepareLetterVersion, prepareResumeVersion } from "@/services/tailoring/prepare";
import { createTestUser, liveReady, removeTestUsers, URL, type TestUser } from "./helpers";

// The rest of the stores, against a real Supabase stack, as two real accounts: the person's
// documents, outreach drafts, interview rounds, practice sessions and saved match snapshots.

const suite = liveReady ? describe : describe.skip;

suite(`live Supabase workflow (${URL || "not configured"})`, () => {
  let a: TestUser;
  let b: TestUser;
  let job: Job;

  async function seedProfile(user: TestUser) {
    const store = new SupabaseProfileStore(user.client);
    const persona = getPersona("asha")!;
    await store.saveSingleton(user.id, "profiles", persona.profile);
    await store.saveSingleton(user.id, "career_goals", persona.goals);
    for (const entity of COLLECTION_ENTITIES as readonly CollectionEntity[]) {
      for (const item of persona[entity] as never[]) {
        await store.createItem(user.id, entity, item, { source: "manual", confirmed: true });
      }
    }
    return store.getSnapshot(user.id);
  }

  beforeAll(async () => {
    a = await createTestUser("wa");
    b = await createTestUser("wb");
    const jobs = await new SupabaseJobStore(a.client).search(a.id, DEFAULT_JOB_QUERY);
    job = jobs.jobs[0]!;
  }, 90_000);

  afterAll(async () => {
    await removeTestUsers(a, b);
  }, 60_000);

  it("saves, approves and isolates tailored documents", async () => {
    const snapshot = await seedProfile(a);
    const docsA = new SupabaseDocumentStore(a.client);
    const docsB = new SupabaseDocumentStore(b.client);

    const prepared = prepareResumeVersion(snapshot, job);
    if (!prepared.ok) throw new Error(prepared.reason);
    const saved = await docsA.create(a.id, prepared.input);
    expect(saved.versionNumber).toBe(1);
    expect(saved.verification.ok).toBe(true);

    const second = await docsA.create(a.id, prepared.input);
    expect(second.versionNumber).toBe(2);

    const letter = prepareLetterVersion(snapshot, job);
    if (!letter.ok) throw new Error(letter.reason);
    expect((await docsA.create(a.id, letter.input)).versionNumber).toBe(1);
    expect((await docsA.list(a.id, { jobId: job.id })).length).toBe(3);

    expect(await docsA.approve(a.id, saved.id)).toBe("approved");
    expect(await docsA.approve(a.id, saved.id)).toBe("already_approved");

    // Nothing is visible to, or approvable by, the other account.
    expect(await docsB.get(b.id, saved.id)).toBeNull();
    expect(await docsB.list(b.id)).toEqual([]);
    expect(await docsB.approve(b.id, second.id)).toBe("not_found");
    expect(await docsB.remove(b.id, second.id)).toBe(false);

    expect(await docsA.remove(a.id, second.id)).toBe(true);
  }, 60_000);

  it("stores outreach drafts, freezes them once approved, and isolates accounts", async () => {
    const snapshot = await new SupabaseProfileStore(a.client).getSnapshot(a.id);
    const outA = new SupabaseOutreachStore(a.client);
    const outB = new SupabaseOutreachStore(b.client);

    const prepared = prepareDraft(snapshot, job, {
      type: "linkedin_note",
      recipient_name: "Priya",
      recipient_title: "Engineering Manager",
      shared_context: null,
      confirm_applied: false,
      confirm_spoken: false,
    });
    if (!prepared.ok) throw new Error(prepared.reason);

    const draft = await outA.create(a.id, prepared.draft);
    expect(draft.status).toBe("draft");
    expect((await outA.list(a.id, { jobId: job.id })).map((d) => d.id)).toContain(draft.id);

    expect(await outB.get(b.id, draft.id)).toBeNull();
    expect(await outB.approve(b.id, draft.id)).toBe("not_found");
    expect(await outB.remove(b.id, draft.id)).toBe(false);

    expect(await outA.approve(a.id, draft.id)).toBe("approved");
    // An approved draft is frozen: the database refuses edits.
    const edit = await outA.edit(a.id, draft.id, {
      doc: { ...prepared.draft.doc, text: "Changed after approval", edited: true },
      verification: prepared.draft.verification,
      profileHash: prepared.draft.profileHash,
    });
    expect(edit).not.toBe("saved");

    expect(await outA.markSent(a.id, draft.id)).toBe("sent");
    expect(await outA.remove(a.id, draft.id)).toBe(true);
  }, 60_000);

  it("keeps interview rounds and practice sessions private to their owner", async () => {
    const snapshot = await new SupabaseProfileStore(a.client).getSnapshot(a.id);
    const apps = new SupabaseApplicationStore(a.client);
    const interviewsA = new SupabaseInterviewStore(a.client);
    const interviewsB = new SupabaseInterviewStore(b.client);
    const practiceA = new SupabasePracticeStore(a.client);
    const practiceB = new SupabasePracticeStore(b.client);

    const app = await apps.create(a.id, {
      jobId: job.id,
      jobTitle: job.title,
      companyName: job.company_name,
      status: "shortlisted",
      appliedOn: null,
    });

    const round = await interviewsA.create(a.id, {
      applicationId: app.id,
      roundLabel: "Phone screen",
      kind: "phone_screen",
      format: "video",
      scheduledOn: null,
      scheduledTime: null,
      interviewer: null,
      notes: null,
      checklist: [],
    } as never);
    expect(round.roundLabel).toBe("Phone screen");
    expect(await interviewsB.get(b.id, round.id)).toBeNull();
    expect(await interviewsB.list(b.id)).toEqual([]);
    expect(await interviewsB.remove(b.id, round.id)).toBe(false);

    const questions = buildQuestions(snapshot, job, "technical", 3);
    expect(questions.length).toBeGreaterThan(0);
    const session = await practiceA.create(a.id, {
      jobId: job.id,
      jobTitle: job.title,
      companyName: job.company_name,
      focus: "technical",
      questions,
      round: 0,
    });
    expect(await practiceB.get(b.id, session.id)).toBeNull();
    expect(await practiceB.list(b.id)).toEqual([]);
    expect(await practiceB.remove(b.id, session.id)).toBe(false);

    // Out-of-order answers are refused by the store, not just by the page.
    const early = await practiceA.submitAnswer(a.id, session.id, 2, "an answer", {
      score: 50,
      dimensions: [],
      strengths: [],
      improvements: [],
      flags: [],
    } as never);
    expect(early).not.toBe("saved");

    expect(await practiceA.remove(a.id, session.id)).toBe(true);
    expect(await interviewsA.remove(a.id, round.id)).toBe(true);
    expect(await apps.remove(a.id, app.id)).toBe(true);
  }, 60_000);

  it("saves a match snapshot per account and reads it back", async () => {
    const snapshot = await new SupabaseProfileStore(a.client).getSnapshot(a.id);
    const matchesA = new SupabaseMatchStore(a.client);
    const matchesB = new SupabaseMatchStore(b.client);

    const candidate = buildCandidate(snapshot);
    const result = rankJobs([job], candidate)[0]!.match;
    await matchesA.save(a.id, job.id, result, candidate.hash);

    const stored = await matchesA.get(a.id, job.id);
    expect(stored?.result.strength).toBe(result.strength);
    expect(await matchesB.get(b.id, job.id)).toBeNull();
  }, 60_000);
});
