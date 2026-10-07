// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { MemoryOutreachStore } from "@/db/outreach/memory-store";
import {
  MAX_DRAFTS,
  OutreachStoreError,
  type NewDraft,
  type OutreachDraft,
} from "@/db/outreach/store";
import { SupabaseOutreachStore } from "@/db/outreach/supabase-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { outreachInputSchema, type OutreachType } from "@/lib/outreach/types";
import { prepareDraft, prepareEdit } from "@/services/outreach/prepare";
import { makeJob } from "../fixtures/matching";

const job = makeJob({ required_skills: ["Python"] });
const snapPromise = new MemoryProfileStore("asha").getSnapshot("u");

async function draftInput(
  type: OutreachType = "recruiter",
  over: Record<string, unknown> = {},
): Promise<NewDraft> {
  const r = prepareDraft(
    await snapPromise,
    job,
    outreachInputSchema.parse({
      type,
      recipient_name: "Priya",
      shared_context: "We studied together.",
      ...over,
    }),
  );
  if (!r.ok) throw new Error(r.reason);
  return r.draft;
}

const bad = { ok: false, checked: 1, blocked: [{ claim_id: "x", text: "t", reason: "r" }] };

describe("prepareDraft and prepareEdit", () => {
  it("builds a draft with a passing check and the recipient details", async () => {
    const d = await draftInput();
    expect(d).toMatchObject({ type: "recruiter", recipientName: "Priya", jobId: job.id });
    expect(d.verification.ok).toBe(true);
    expect(d.profileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports why nothing can be built", async () => {
    const r = prepareDraft(await snapPromise, job, outreachInputSchema.parse({ type: "alumni" }));
    expect(r).toEqual({ ok: false, reason: "needs_context" });
  });

  it("re-checks an edit, marks it edited, and keeps an email subject", async () => {
    const store = new MemoryOutreachStore();
    const draft = await store.create("u", await draftInput());
    const good = prepareEdit(await snapPromise, job, draft, {
      text: "Hello Priya, I build REST APIs with Python.",
      subject: "Hello from Asha",
    });
    if (!good.ok) throw new Error(good.reason);
    expect(good.edit.doc.edited).toBe(true);
    expect(good.edit.doc.subject).toBe("Hello from Asha");
    expect(good.edit.verification.ok).toBe(true);

    const flagged = prepareEdit(await snapPromise, job, draft, { text: "I know Kubernetes." });
    if (!flagged.ok) throw new Error(flagged.reason);
    expect(flagged.edit.verification.ok).toBe(false);

    expect(prepareEdit(await snapPromise, job, draft, { text: "  " })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(prepareEdit(await snapPromise, job, draft, { text: "x".repeat(5001) })).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(prepareEdit(await snapPromise, job, draft, { text: "ok", subject: "" })).toEqual({
      ok: false,
      reason: "bad_subject",
    });
  });

  it("strips control characters from edited text and ignores a subject on a LinkedIn note", async () => {
    const store = new MemoryOutreachStore();
    const note = await store.create("u", await draftInput("linkedin_note"));
    const r = prepareEdit(await snapPromise, job, note, {
      text: "Hi\u0000 there",
      subject: "Ignored",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.edit.doc.text).toBe("Hi there");
    expect(r.edit.doc.subject).toBeNull();
  });

  it("flags an edited LinkedIn note over the limit", async () => {
    const store = new MemoryOutreachStore();
    const note = await store.create("u", await draftInput("linkedin_note"));
    const r = prepareEdit(await snapPromise, job, note, { text: "x".repeat(301) });
    if (!r.ok) throw new Error(r.reason);
    expect(r.edit.verification.blocked.map((b) => b.claim_id)).toContain("length");
  });
});

describe("MemoryOutreachStore", () => {
  it("saves and lists drafts newest first, per visitor", async () => {
    const store = new MemoryOutreachStore();
    const a = await store.create("a", await draftInput());
    await store.create("a", await draftInput("follow_up", { confirm_applied: true }));
    expect(await store.list("a")).toHaveLength(2);
    expect(await store.get("b", a.id)).toBeNull();
    expect(await store.approve("b", a.id)).toBe("not_found");
    expect(await store.markSent("b", a.id)).toBe("not_found");
    expect(await store.remove("b", a.id)).toBe(false);
    expect(await store.list("a", { jobId: "other" })).toEqual([]);
  });

  it("follows draft to approved to sent, in that order only", async () => {
    const store = new MemoryOutreachStore();
    const d = await store.create("u", await draftInput());
    expect(await store.markSent("u", d.id)).toBe("not_approved");
    expect(await store.approve("u", d.id)).toBe("approved");
    expect(await store.approve("u", d.id)).toBe("already_approved");
    expect(await store.markSent("u", d.id)).toBe("sent");
    expect(await store.markSent("u", d.id)).toBe("already_sent");
    const done = (await store.get("u", d.id))!;
    expect(done.status).toBe("sent");
    expect(done.approvedAt).not.toBeNull();
    expect(done.sentAt).not.toBeNull();
  });

  it("never approves a draft whose check failed, and edits can clear the problem", async () => {
    const store = new MemoryOutreachStore();
    const d = await store.create("u", { ...(await draftInput()), verification: bad });
    expect(await store.approve("u", d.id)).toBe("blocked");
    const fixed = prepareEdit(await snapPromise, job, d, {
      text: "Hello Priya, I build REST APIs with Python.",
    });
    if (!fixed.ok) throw new Error();
    expect(await store.edit("u", d.id, fixed.edit)).toBe("updated");
    expect(await store.approve("u", d.id)).toBe("approved");
  });

  it("freezes an approved draft's words", async () => {
    const store = new MemoryOutreachStore();
    const d = await store.create("u", await draftInput());
    await store.approve("u", d.id);
    const edit = prepareEdit(await snapPromise, job, d, { text: "Changed." });
    if (!edit.ok) throw new Error();
    expect(await store.edit("u", d.id, edit.edit)).toBe("locked");
    expect((await store.get("u", d.id))?.body).toBe(d.body);
    expect(await store.edit("u", "missing", edit.edit)).toBe("not_found");
  });

  it("returns copies, removes a job's drafts, and stops at the limit", async () => {
    const store = new MemoryOutreachStore();
    const d = await store.create("u", await draftInput());
    d.body = "tampered";
    expect((await store.get("u", d.id))?.body).not.toBe("tampered");
    await store.removeForJob("u", job.id);
    expect(await store.list("u")).toEqual([]);
    const input = await draftInput();
    for (let i = 0; i < MAX_DRAFTS; i++) await store.create("u", input);
    await expect(store.create("u", input)).rejects.toMatchObject({ kind: "limit" });
  });
});

function row(d: OutreachDraft) {
  return {
    id: d.id,
    job_id: d.jobId,
    type: d.type,
    channel: d.channel,
    recipient_name: d.recipientName,
    recipient_title: d.recipientTitle,
    shared_context: d.sharedContext,
    subject: d.subject,
    body: d.body,
    content: d.doc,
    verification: d.verification,
    profile_hash: d.profileHash,
    status: d.status,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    approved_at: d.approvedAt,
    sent_at: d.sentAt,
  };
}

interface Script {
  select?: unknown[][];
  insert?: { data?: unknown; error?: { code: string; message?: string } }[];
  update?: unknown[];
  delete?: unknown;
  error?: { code: string; message?: string };
}

function fake(script: Script) {
  const calls: { op: string; args?: unknown; filters: [string, unknown][] }[] = [];
  let inserts = 0;
  let selects = 0;
  let updates = 0;
  const client = {
    from() {
      const call = { op: "select", args: undefined as unknown, filters: [] as [string, unknown][] };
      calls.push(call);
      const result = () => {
        if (script.error) return { data: null, error: script.error };
        if (call.op === "insert") {
          const r = script.insert?.[inserts++] ?? {};
          return { data: r.data ?? null, error: r.error ?? null };
        }
        if (call.op === "update") return { data: script.update?.[updates++] ?? [], error: null };
        if (call.op === "delete") return { data: script.delete ?? [], error: null };
        return { data: script.select?.[selects++] ?? [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (a: unknown) => {
          call.op = "insert";
          call.args = a;
          return chain;
        },
        update: (a: unknown) => {
          call.op = "update";
          call.args = a;
          return chain;
        },
        delete: () => {
          call.op = "delete";
          return chain;
        },
        eq: (c: string, v: unknown) => {
          call.filters.push([c, v]);
          return chain;
        },
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

describe("SupabaseOutreachStore", () => {
  const make = async (over: Partial<OutreachDraft> = {}) => ({
    ...(await new MemoryOutreachStore().create("u", await draftInput())),
    ...over,
  });

  it("reads rows back into validated drafts, scoped to the user", async () => {
    const d = await make();
    const { client, calls } = fake({ select: [[row(d)]] });
    expect(await new SupabaseOutreachStore(client).list("u1", { jobId: "j1" })).toEqual([d]);
    expect(calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["job_id", "j1"],
    ]);
  });

  it("skips a stored row that no longer fits the schema", async () => {
    const d = await make();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...row(d), content: { nope: true } };
    const wrongType = { ...row(d), type: "spam" };
    const { client } = fake({ select: [[broken, wrongType, row(d)]] });
    expect(await new SupabaseOutreachStore(client).list("u")).toEqual([d]);
    spy.mockRestore();
  });

  it("inserts every column and returns the stored draft", async () => {
    const d = await make();
    const input = await draftInput();
    const { client, calls } = fake({ insert: [{ data: row(d) }] });
    expect(await new SupabaseOutreachStore(client).create("u1", input)).toEqual(d);
    expect(calls[0]!.args).toMatchObject({
      user_id: "u1",
      job_id: job.id,
      type: "recruiter",
      channel: "email",
      recipient_name: "Priya",
      subject: input.doc.subject,
      body: input.doc.text,
      profile_hash: input.profileHash,
    });
  });

  it("maps the limit trigger and other failures to safe errors, without row contents", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const limit = fake({
      insert: [{ error: { code: "P0001", message: "outreach draft limit reached" } }],
    });
    await expect(
      new SupabaseOutreachStore(limit.client).create("u", await draftInput()),
    ).rejects.toMatchObject({ kind: "limit" });
    const broken = fake({ error: { code: "42501", message: "secret draft text" } });
    const err = await new SupabaseOutreachStore(broken.client).list("u").catch((e) => e);
    expect(err).toBeInstanceOf(OutreachStoreError);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret draft text");
    spy.mockRestore();
  });

  it("edits only drafts, and tells a missing draft from a locked one", async () => {
    const d = await make();
    const edit = prepareEdit(await snapPromise, job, d, { text: "Hello." });
    if (!edit.ok) throw new Error();
    const ok = fake({ update: [[{ id: d.id }]] });
    expect(await new SupabaseOutreachStore(ok.client).edit("u", d.id, edit.edit)).toBe("updated");
    expect(ok.calls[0]!.filters).toContainEqual(["status", "draft"]);
    const locked = fake({ update: [[]], select: [[row({ ...d, status: "approved" })]] });
    expect(await new SupabaseOutreachStore(locked.client).edit("u", d.id, edit.edit)).toBe(
      "locked",
    );
    const missing = fake({ update: [[]], select: [[]] });
    expect(await new SupabaseOutreachStore(missing.client).edit("u", d.id, edit.edit)).toBe(
      "not_found",
    );
  });

  it("approves only passing drafts and sends only approved ones, guarding on status", async () => {
    const draft = await make();
    const ok = fake({ select: [[row(draft)]], update: [[{ id: draft.id }]] });
    expect(await new SupabaseOutreachStore(ok.client).approve("u", draft.id)).toBe("approved");
    expect(ok.calls.find((c) => c.op === "update")!.filters).toContainEqual(["status", "draft"]);
    const blocked = await make({ verification: bad });
    expect(
      await new SupabaseOutreachStore(fake({ select: [[row(blocked)]] }).client).approve(
        "u",
        blocked.id,
      ),
    ).toBe("blocked");
    expect(await new SupabaseOutreachStore(fake({ select: [[]] }).client).approve("u", "x")).toBe(
      "not_found",
    );

    const approved = await make({ status: "approved", approvedAt: "2026-10-07T00:00:00Z" });
    const sent = fake({ select: [[row(approved)]], update: [[{ id: approved.id }]] });
    expect(await new SupabaseOutreachStore(sent.client).markSent("u", approved.id)).toBe("sent");
    expect(sent.calls.find((c) => c.op === "update")!.filters).toContainEqual([
      "status",
      "approved",
    ]);
    expect(
      await new SupabaseOutreachStore(fake({ select: [[row(draft)]] }).client).markSent(
        "u",
        draft.id,
      ),
    ).toBe("not_approved");
    const done = await make({ status: "sent", approvedAt: "x", sentAt: "y" });
    expect(
      await new SupabaseOutreachStore(fake({ select: [[row(done)]] }).client).markSent(
        "u",
        done.id,
      ),
    ).toBe("already_sent");
  });

  it("deletes only the caller's row", async () => {
    const { client, calls } = fake({ delete: [{ id: "x" }] });
    expect(await new SupabaseOutreachStore(client).remove("u1", "x")).toBe(true);
    expect(calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["id", "x"],
    ]);
    expect(await new SupabaseOutreachStore(fake({ delete: [] }).client).remove("u1", "x")).toBe(
      false,
    );
  });
});
