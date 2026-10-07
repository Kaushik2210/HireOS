// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryApplicationStore } from "@/db/applications/memory-store";
import { ApplicationStoreError, type Application } from "@/db/applications/store";
import { SupabaseApplicationStore } from "@/db/applications/supabase-store";
import { MemoryDocumentStore } from "@/db/documents/memory-store";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { DEFAULT_JOB_QUERY } from "@/lib/jobs/schemas";
import { prepareResumeVersion } from "@/services/tailoring/prepare";

let jobs = new MemoryJobStore();
let applications = new MemoryApplicationStore();
let documents = new MemoryDocumentStore();
let user: { id: string; email: string | null; isDemo: boolean } | null = null;
const revalidatePath = vi.fn();

class RedirectSignal extends Error {}

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!user) throw new RedirectSignal("/login");
    return user;
  },
}));
vi.mock("@/db/jobs", () => ({ getJobStore: async () => jobs }));
vi.mock("@/db/documents", () => ({ getDocumentStore: async () => documents }));
vi.mock("@/db/applications", () => ({
  getApplicationStore: async () => applications,
  getDemoApplicationStore: () => applications,
}));

const actions = await import("@/features/applications/actions");

const firstJob = async () => (await jobs.search("user-1", DEFAULT_JOB_QUERY)).jobs[0]!;

beforeEach(() => {
  jobs = new MemoryJobStore();
  applications = new MemoryApplicationStore();
  documents = new MemoryDocumentStore();
  user = { id: "user-1", email: null, isDemo: true };
  revalidatePath.mockClear();
});

async function tracked(status = "shortlisted") {
  const job = await firstJob();
  await actions.trackJobAction({ jobId: job.id, status });
  const [app] = await applications.list("user-1");
  return { job, app: app! };
}

describe("trackJobAction", () => {
  it("adds a job to the pipeline with its title and company copied", async () => {
    const { job, app } = await tracked();
    expect(app).toMatchObject({
      jobId: job.id,
      jobTitle: job.title,
      companyName: job.company_name,
      status: "shortlisted",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/applications");
  });

  it("says when a job is already tracked, and refuses unknown jobs and late starts", async () => {
    const { job } = await tracked();
    expect(await actions.trackJobAction({ jobId: job.id })).toEqual({
      ok: false,
      error: "This job is already in your pipeline.",
    });
    expect(
      (await actions.trackJobAction({ jobId: "00000000-0000-4000-8000-000000000001" })).ok,
    ).toBe(false);
    expect((await actions.trackJobAction({ jobId: job.id, status: "offer" })).ok).toBe(false);
    expect(
      (await actions.trackJobAction({ jobId: job.id, status: "applied", applied_on: "2999-01-01" }))
        .ok,
    ).toBe(false);
  });

  it("dates an applied start, with the date the person gives", async () => {
    const job = await firstJob();
    await actions.trackJobAction({ jobId: job.id, status: "applied", applied_on: "2026-10-01" });
    expect((await applications.list("user-1"))[0]).toMatchObject({
      status: "applied",
      appliedOn: "2026-10-01",
    });
  });

  it("requires sign-in", async () => {
    user = null;
    await expect(actions.trackJobAction({ jobId: (await firstJob()).id })).rejects.toBeInstanceOf(
      RedirectSignal,
    );
  });
});

describe("moveApplicationAction", () => {
  it("moves along allowed transitions, with a note, and refuses the rest", async () => {
    const { app } = await tracked();
    expect(
      await actions.moveApplicationAction({
        id: app.id,
        status: "applied",
        note: "Applied on their site",
      }),
    ).toEqual({ ok: true });
    expect(await actions.moveApplicationAction({ id: app.id, status: "offer" })).toEqual({
      ok: false,
      error: "That move is not allowed from the current status.",
    });
    const got = (await applications.get("user-1", app.id))!;
    expect(got.application.status).toBe("applied");
    expect(got.events.at(-1)).toMatchObject({
      kind: "status_changed",
      note: "Applied on their site",
    });
  });

  it("rejects bad input and other people's applications", async () => {
    const { app } = await tracked();
    expect((await actions.moveApplicationAction({ id: "x", status: "applied" })).ok).toBe(false);
    expect((await actions.moveApplicationAction({ id: app.id, status: "hired" })).ok).toBe(false);
    user = { id: "someone-else", email: null, isDemo: true };
    expect(await actions.moveApplicationAction({ id: app.id, status: "applied" })).toEqual({
      ok: false,
      error: "That application no longer exists.",
    });
  });
});

describe("updateDetailsAction", () => {
  async function savedResume(jobId: string, kind: "resume" | "letter" = "resume") {
    const snap = await new MemoryProfileStore("asha").getSnapshot("user-1");
    const job = (await jobs.get("user-1", jobId))!;
    const prepared = prepareResumeVersion(snap, job);
    if (!prepared.ok) throw new Error();
    const input =
      kind === "resume" ? prepared.input : { ...prepared.input, kind: "cover_letter" as const };
    return documents.create("user-1", input);
  }

  it("saves notes and a follow-up date", async () => {
    const { app } = await tracked();
    expect(
      await actions.updateDetailsAction({
        id: app.id,
        notes: "  Recruiter is Priya  ",
        follow_up_on: "2026-10-20",
      }),
    ).toEqual({ ok: true, message: "Saved." });
    expect((await applications.get("user-1", app.id))!.application).toMatchObject({
      notes: "Recruiter is Priya",
      followUpOn: "2026-10-20",
    });
  });

  it("links only the person's own saved documents for this job", async () => {
    const { app, job } = await tracked();
    const resume = await savedResume(job.id);
    expect(
      (await actions.updateDetailsAction({ id: app.id, resume_version_id: resume.id })).ok,
    ).toBe(true);
    expect((await applications.get("user-1", app.id))!.application.resumeVersionId).toBe(resume.id);

    // A resume is not a cover letter, and a made-up or another job's document is refused.
    const wrongKind = await actions.updateDetailsAction({
      id: app.id,
      cover_letter_version_id: resume.id,
    });
    expect(wrongKind).toEqual({
      ok: false,
      error: "Choose one of your own saved documents for this job.",
    });
    expect(
      (
        await actions.updateDetailsAction({
          id: app.id,
          resume_version_id: "00000000-0000-4000-8000-000000000001",
        })
      ).ok,
    ).toBe(false);
    const other = (await jobs.search("user-1", { ...DEFAULT_JOB_QUERY, page: 2 })).jobs[0]!;
    const elsewhere = await savedResume(other.id);
    expect(
      (await actions.updateDetailsAction({ id: app.id, resume_version_id: elsewhere.id })).ok,
    ).toBe(false);
  });

  it("rejects over-long notes and unknown applications", async () => {
    const { app } = await tracked();
    expect((await actions.updateDetailsAction({ id: app.id, notes: "x".repeat(2001) })).ok).toBe(
      false,
    );
    expect(
      await actions.updateDetailsAction({ id: "00000000-0000-4000-8000-000000000001" }),
    ).toEqual({
      ok: false,
      error: "That application no longer exists.",
    });
  });
});

describe("addEventAction, deleteApplicationAction and the demo wipe", () => {
  it("adds a note or a follow-up record, and nothing else", async () => {
    const { app } = await tracked();
    expect(
      (await actions.addEventAction({ id: app.id, kind: "note", note: "Left a voicemail" })).ok,
    ).toBe(true);
    expect((await actions.addEventAction({ id: app.id, kind: "followed_up" })).ok).toBe(true);
    expect(await actions.addEventAction({ id: app.id, kind: "note", note: "  " })).toEqual({
      ok: false,
      error: "Write something first.",
    });
    expect(
      (await actions.addEventAction({ id: app.id, kind: "status_changed", note: "x" })).ok,
    ).toBe(false);
    expect((await applications.get("user-1", app.id))!.events.map((e) => e.kind)).toEqual([
      "created",
      "note",
      "followed_up",
    ]);
  });

  it("deletes only the caller's application", async () => {
    const { app } = await tracked();
    user = { id: "someone-else", email: null, isDemo: true };
    expect((await actions.deleteApplicationAction(app.id)).ok).toBe(false);
    user = { id: "user-1", email: null, isDemo: true };
    expect(await actions.deleteApplicationAction(app.id)).toEqual({ ok: true });
    expect((await actions.deleteApplicationAction("nope")).ok).toBe(false);
  });

  it("clears only the sample applications, and only in demo mode", async () => {
    applications = new MemoryApplicationStore({
      loadDemoJobs: async () => (await jobs.search("u", DEFAULT_JOB_QUERY)).jobs,
    });
    const job = (await jobs.search("u", { ...DEFAULT_JOB_QUERY, page: 2 })).jobs[0]!;
    await applications.create("user-1", {
      jobId: job.id,
      jobTitle: job.title,
      companyName: job.company_name,
      status: "shortlisted",
      appliedOn: null,
    });
    const before = await applications.list("user-1");
    expect(before.some((a) => a.isDemo)).toBe(true);
    expect(await actions.wipeDemoApplicationsAction()).toEqual({
      ok: true,
      message: "Sample applications cleared.",
    });
    expect((await applications.list("user-1")).map((a) => a.isDemo)).toEqual([false]);
    user = { id: "real", email: "a@b.c", isDemo: false };
    expect((await actions.wipeDemoApplicationsAction()).ok).toBe(false);
  });
});

/* ---------- the Supabase store, against a fake client ---------- */

function row(a: Application) {
  return {
    id: a.id,
    job_id: a.jobId,
    job_title: a.jobTitle,
    company_name: a.companyName,
    status: a.status,
    applied_on: a.appliedOn,
    follow_up_on: a.followUpOn,
    notes: a.notes,
    resume_version_id: a.resumeVersionId,
    cover_letter_version_id: a.coverLetterVersionId,
    status_changed_at: a.statusChangedAt,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

interface Script {
  select?: unknown[][];
  insert?: { data?: unknown; error?: { code?: string; message?: string } }[];
  update?: { data?: unknown; error?: { code?: string; message?: string } }[];
  rpc?: { error?: { code?: string; message?: string } | null };
  delete?: unknown;
  error?: { code?: string; message?: string };
}

function fake(script: Script) {
  const calls: { op: string; args?: unknown; filters: [string, unknown][] }[] = [];
  let selects = 0;
  let inserts = 0;
  let updates = 0;
  const client = {
    rpc(name: string, args: unknown) {
      calls.push({ op: `rpc:${name}`, args, filters: [] });
      return Promise.resolve({ error: script.rpc?.error ?? null });
    },
    from() {
      const call = { op: "select", args: undefined as unknown, filters: [] as [string, unknown][] };
      calls.push(call);
      const result = () => {
        if (script.error) return { data: null, error: script.error };
        if (call.op === "insert") {
          const r = script.insert?.[inserts++] ?? {};
          return { data: r.data ?? null, error: r.error ?? null };
        }
        if (call.op === "update") {
          const r = script.update?.[updates++] ?? {};
          return { data: r.data ?? [], error: r.error ?? null };
        }
        if (call.op === "delete") return { data: script.delete ?? [], error: null };
        return { data: script.select?.[selects++] ?? [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (a: unknown) => ((call.op = "insert"), (call.args = a), chain),
        update: (a: unknown) => ((call.op = "update"), (call.args = a), chain),
        delete: () => ((call.op = "delete"), chain),
        eq: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
        in: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
        order: () => chain,
        limit: () => chain,
        single: async () => result(),
        maybeSingle: async () => {
          const r = result();
          return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
        },
        then: (resolve: (v: unknown) => unknown) => resolve(result()),
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("SupabaseApplicationStore", () => {
  const sample = async () => {
    const mem = new MemoryApplicationStore();
    return mem.create("u", {
      jobId: "00000000-0000-4000-8000-000000000001",
      jobTitle: "Role",
      companyName: "Acme",
      status: "shortlisted",
      appliedOn: null,
    });
  };

  it("reads applications and their events back, scoped to the user", async () => {
    const app = await sample();
    const event = {
      id: "e1",
      application_id: app.id,
      kind: "created",
      from_status: null,
      to_status: "shortlisted",
      note: null,
      created_at: app.createdAt,
    };
    const { client, calls } = fake({
      select: [[row(app)], [row(app)], [event, { ...event, id: "bad", kind: "teleported" }]],
    });
    const store = new SupabaseApplicationStore(client);
    expect(await store.list("u1")).toEqual([app]);
    const got = await store.get("u1", app.id);
    expect(got!.application).toEqual(app);
    expect(got!.events).toHaveLength(1);
    expect(calls[0]!.filters).toEqual([["user_id", "u1"]]);
  });

  it("skips a stored row that no longer fits the schema", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await sample();
    const { client } = fake({ select: [[{ ...row(app), status: "hired" }, row(app)]] });
    expect(await new SupabaseApplicationStore(client).list("u")).toEqual([app]);
    spy.mockRestore();
  });

  it("creates with the job's title and company and an application date only when applied", async () => {
    const app = await sample();
    const input = { jobId: app.jobId!, jobTitle: "Role", companyName: "Acme", appliedOn: null };
    const shortlisted = fake({ insert: [{ data: row(app) }] });
    await new SupabaseApplicationStore(shortlisted.client).create("u1", {
      ...input,
      status: "shortlisted",
    });
    expect(shortlisted.calls[0]!.args).toMatchObject({
      user_id: "u1",
      job_title: "Role",
      status: "shortlisted",
      applied_on: null,
    });
    const applied = fake({ insert: [{ data: row(app) }] });
    await new SupabaseApplicationStore(applied.client).create("u1", {
      ...input,
      status: "applied",
      appliedOn: "2026-10-01",
    });
    expect(applied.calls[0]!.args).toMatchObject({ status: "applied", applied_on: "2026-10-01" });
  });

  it("maps duplicates, the limit and check failures to safe errors, without row contents", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = {
      jobId: "j",
      jobTitle: "Role",
      companyName: "Acme",
      status: "shortlisted" as const,
      appliedOn: null,
    };
    const kind = async (error: { code?: string; message?: string }) =>
      (
        await new SupabaseApplicationStore(fake({ insert: [{ error }] }).client)
          .create("u", input)
          .catch((e) => e)
      ).kind;
    expect(await kind({ code: "23505" })).toBe("duplicate");
    expect(await kind({ code: "P0001", message: "application limit reached" })).toBe("limit");
    expect(await kind({ code: "23514" })).toBe("invalid");
    expect(await kind({ code: "XX000", message: "secret notes text" })).toBe("unknown");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret notes text");
    expect(new ApplicationStoreError("limit").kind).toBe("limit");
    spy.mockRestore();
  });

  it("moves through the database function and tells the outcomes apart", async () => {
    const ok = fake({});
    expect(
      await new SupabaseApplicationStore(ok.client).changeStatus(
        "u",
        "id1",
        "applied",
        "n",
        "2026-10-01",
      ),
    ).toBe("moved");
    expect(ok.calls[0]).toMatchObject({
      op: "rpc:change_application_status",
      args: { p_id: "id1", p_status: "applied", p_note: "n", p_on: "2026-10-01" },
    });
    const outcome = (message: string) =>
      new SupabaseApplicationStore(fake({ rpc: { error: { message } } }).client).changeStatus(
        "u",
        "id",
        "applied",
        null,
        null,
      );
    expect(await outcome("application not found")).toBe("not_found");
    expect(await outcome("that move is not allowed from applied")).toBe("not_allowed");
  });

  it("adds notes through the database function", async () => {
    const store = (message?: string) =>
      new SupabaseApplicationStore(fake({ rpc: { error: message ? { message } : null } }).client);
    expect(await store().addEvent("u", "id", "note", "hi")).toBe("added");
    expect(await store("a note needs text").addEvent("u", "id", "note", " ")).toBe("invalid");
    expect(await store("application not found").addEvent("u", "id", "followed_up", null)).toBe(
      "not_found",
    );
  });

  it("updates only the person's own working fields, and maps a refused document to a clear outcome", async () => {
    const update = {
      notes: "n",
      followUpOn: "2026-10-20",
      resumeVersionId: null,
      coverLetterVersionId: null,
    };
    const ok = fake({ update: [{ data: [{ id: "x" }] }] });
    expect(await new SupabaseApplicationStore(ok.client).updateDetails("u1", "x", update)).toBe(
      "updated",
    );
    expect(ok.calls[0]!.args).toEqual({
      notes: "n",
      follow_up_on: "2026-10-20",
      resume_version_id: null,
      cover_letter_version_id: null,
    });
    expect(ok.calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["id", "x"],
    ]);
    expect(
      await new SupabaseApplicationStore(fake({ update: [{ data: [] }] }).client).updateDetails(
        "u",
        "x",
        update,
      ),
    ).toBe("not_found");
    expect(
      await new SupabaseApplicationStore(
        fake({ update: [{ error: { code: "42501" } }] }).client,
      ).updateDetails("u", "x", update),
    ).toBe("invalid_document");
  });

  it("reads only the events the follow-up engine needs", async () => {
    const event = {
      id: "e1",
      application_id: "a",
      kind: "followed_up",
      from_status: null,
      to_status: null,
      note: null,
      created_at: "2026-10-01T00:00:00Z",
    };
    const { client, calls } = fake({ select: [[event]] });
    expect(await new SupabaseApplicationStore(client).activity("u1")).toHaveLength(1);
    expect(calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["kind", ["created", "status_changed", "followed_up"]],
    ]);
  });

  it("deletes only the caller's row", async () => {
    const { client, calls } = fake({ delete: [{ id: "x" }] });
    expect(await new SupabaseApplicationStore(client).remove("u1", "x")).toBe(true);
    expect(calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["id", "x"],
    ]);
    expect(await new SupabaseApplicationStore(fake({ delete: [] }).client).remove("u1", "x")).toBe(
      false,
    );
  });
});
