// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { MemoryDocumentStore } from "@/db/documents/memory-store";
import { DocumentStoreError, MAX_VERSIONS_PER_USER, type NewVersion } from "@/db/documents/store";
import { SupabaseDocumentStore } from "@/db/documents/supabase-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { prepareLetterVersion, prepareResumeVersion } from "@/services/tailoring/prepare";
import { makeJob, snapshotFrom } from "../fixtures/matching";

const job = makeJob({ required_skills: ["Python"] });

async function input(over: Partial<NewVersion> = {}): Promise<NewVersion> {
  const snap = await new MemoryProfileStore("asha").getSnapshot("u");
  const p = prepareResumeVersion(snap, job);
  if (!p.ok) throw new Error(p.reason);
  return { ...p.input, ...over };
}

const bad = { ok: false, checked: 1, blocked: [{ claim_id: "x", text: "t", reason: "r" }] };

describe("prepare", () => {
  it("builds a resume version from the profile, with a passing check and a profile hash", async () => {
    const i = await input();
    expect(i.kind).toBe("resume");
    expect(i.verification.ok).toBe(true);
    expect(i.profileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(i.body).toContain("SKILLS");
  });

  it("reports why nothing can be built", async () => {
    expect(prepareResumeVersion(await snapshotFrom({}), job)).toEqual({
      ok: false,
      reason: "nothing_verified",
    });
    expect(
      prepareLetterVersion(
        await snapshotFrom({ profile: null, skills: [["Python", "advanced"]] }),
        job,
      ),
    ).toEqual({ ok: false, reason: "no_profile" });
  });

  it("marks an edited letter as edited and checks it against the profile", async () => {
    const snap = await new MemoryProfileStore("asha").getSnapshot("u");
    const generated = prepareLetterVersion(snap, job);
    if (!generated.ok || generated.input.content.kind !== "cover_letter") throw new Error();
    expect(generated.input.content.doc.edited).toBe(false);

    const same = prepareLetterVersion(snap, job, { text: generated.input.body });
    if (!same.ok || same.input.content.kind !== "cover_letter") throw new Error();
    expect(same.input.content.doc.edited).toBe(false);

    const edited = prepareLetterVersion(snap, job, {
      text: `${generated.input.body}\n\nI know Kubernetes well.`,
    });
    if (!edited.ok || edited.input.content.kind !== "cover_letter") throw new Error();
    expect(edited.input.content.doc.edited).toBe(true);
    expect(edited.input.verification.ok).toBe(false);

    expect(prepareLetterVersion(snap, job, { text: "   " })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(prepareLetterVersion(snap, job, { text: "x".repeat(20001) })).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("MemoryDocumentStore", () => {
  it("numbers versions per job and kind, newest first", async () => {
    const store = new MemoryDocumentStore();
    const a = await store.create("u", await input());
    const b = await store.create("u", await input({ parentId: a.id }));
    const other = await store.create("u", await input({ jobId: "other-job" }));
    expect([a.versionNumber, b.versionNumber, other.versionNumber]).toEqual([1, 2, 1]);
    expect(b.parentId).toBe(a.id);
    expect((await store.list("u", { jobId: job.id })).map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(await store.list("u", { kind: "cover_letter" })).toEqual([]);
  });

  it("keeps each visitor separate", async () => {
    const store = new MemoryDocumentStore();
    const v = await store.create("a", await input());
    expect(await store.get("b", v.id)).toBeNull();
    expect(await store.approve("b", v.id)).toBe("not_found");
    expect(await store.remove("b", v.id)).toBe(false);
  });

  it("approves a passing draft once, and never a blocked one", async () => {
    const store = new MemoryDocumentStore();
    const good = await store.create("u", await input());
    expect(await store.approve("u", good.id)).toBe("approved");
    expect(await store.approve("u", good.id)).toBe("already_approved");
    expect((await store.get("u", good.id))?.approvedAt).not.toBeNull();
    const blocked = await store.create("u", await input({ verification: bad }));
    expect(await store.approve("u", blocked.id)).toBe("blocked");
    expect((await store.get("u", blocked.id))?.status).toBe("draft");
  });

  it("returns copies, so callers cannot change what is stored", async () => {
    const store = new MemoryDocumentStore();
    const v = await store.create("u", await input());
    v.body = "tampered";
    const got = await store.get("u", v.id);
    got!.verification.ok = false;
    expect((await store.get("u", v.id))?.body).not.toBe("tampered");
    expect((await store.get("u", v.id))?.verification.ok).toBe(true);
  });

  it("deletes a version and detaches its children; removes a job's versions", async () => {
    const store = new MemoryDocumentStore();
    const a = await store.create("u", await input());
    const b = await store.create("u", await input({ parentId: a.id }));
    expect(await store.remove("u", a.id)).toBe(true);
    expect((await store.get("u", b.id))?.parentId).toBeNull();
    await store.removeForJob("u", job.id);
    expect(await store.list("u")).toEqual([]);
  });

  it("stops at the per-user limit", async () => {
    const store = new MemoryDocumentStore();
    const i = await input();
    for (let n = 0; n < MAX_VERSIONS_PER_USER; n++) await store.create("u", i);
    await expect(store.create("u", i)).rejects.toMatchObject({ kind: "limit" });
  });
});

function row(v: Awaited<ReturnType<MemoryDocumentStore["create"]>>) {
  return {
    id: v.id,
    job_id: v.jobId,
    kind: v.kind,
    version_number: v.versionNumber,
    parent_id: v.parentId,
    status: v.status,
    content: v.content,
    changes: v.changes,
    missing: v.missing,
    verification: v.verification,
    body: v.body,
    tailor_version: v.tailorVersion,
    profile_hash: v.profileHash,
    created_at: v.createdAt,
    approved_at: v.approvedAt,
  };
}

interface Script {
  select?: unknown[][];
  insert?: { data?: unknown; error?: { code: string; message?: string } }[];
  update?: unknown;
  delete?: unknown;
  error?: { code: string; message?: string };
}

/** A chainable fake that records calls and returns scripted results per operation. */
function fake(script: Script) {
  const calls: { op: string; args?: unknown; filters: [string, unknown][] }[] = [];
  let inserts = 0;
  let selects = 0;
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
        if (call.op === "update") return { data: script.update ?? [], error: null };
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

describe("SupabaseDocumentStore", () => {
  it("reads rows back into validated versions, scoped to the user", async () => {
    const v = await new MemoryDocumentStore().create("u", await input());
    const { client, calls } = fake({ select: [[row(v)]] });
    const list = await new SupabaseDocumentStore(client).list("u1", {
      jobId: "j1",
      kind: "resume",
    });
    expect(list).toEqual([v]);
    expect(calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["job_id", "j1"],
      ["kind", "resume"],
    ]);
  });

  it("skips a stored row that no longer fits the schema", async () => {
    const v = await new MemoryDocumentStore().create("u", await input());
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...row(v), content: { kind: "resume", doc: {} } };
    const mismatched = { ...row(v), kind: "cover_letter" };
    const { client } = fake({ select: [[broken, mismatched, row(v)]] });
    expect(await new SupabaseDocumentStore(client).list("u")).toEqual([v]);
    spy.mockRestore();
  });

  it("numbers a new version after the latest, and retries when two saves collide", async () => {
    const v = await new MemoryDocumentStore().create("u", await input());
    const { client, calls } = fake({
      select: [[{ version_number: 4 }], [{ version_number: 5 }]],
      insert: [{ error: { code: "23505" } }, { data: row(v) }],
    });
    const created = await new SupabaseDocumentStore(client).create("u1", await input());
    expect(created).toEqual(v);
    const numbers = calls
      .filter((c) => c.op === "insert")
      .map((c) => (c.args as { version_number: number }).version_number);
    expect(numbers).toEqual([5, 6]);
  });

  it("maps the limit trigger and other failures to safe errors, without row contents", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const limit = fake({
      select: [[]],
      insert: [{ error: { code: "P0001", message: "document version limit reached" } }],
    });
    await expect(
      new SupabaseDocumentStore(limit.client).create("u", await input()),
    ).rejects.toMatchObject({
      kind: "limit",
    });
    const broken = fake({ error: { code: "42501", message: "secret row text" } });
    const err = await new SupabaseDocumentStore(broken.client).list("u").catch((e) => e);
    expect(err).toBeInstanceOf(DocumentStoreError);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret row text");
    spy.mockRestore();
  });

  it("approves only passing drafts, filtering on status so a race cannot double-approve", async () => {
    const mem = new MemoryDocumentStore();
    const draft = await mem.create("u", await input());
    const blocked = await mem.create("u", await input({ verification: bad }));
    const ok = fake({ select: [[row(draft)]], update: [{ id: draft.id }] });
    expect(await new SupabaseDocumentStore(ok.client).approve("u", draft.id)).toBe("approved");
    expect(ok.calls.find((c) => c.op === "update")!.filters).toContainEqual(["status", "draft"]);
    expect(
      await new SupabaseDocumentStore(fake({ select: [[row(blocked)]] }).client).approve(
        "u",
        blocked.id,
      ),
    ).toBe("blocked");
    expect(
      await new SupabaseDocumentStore(fake({ select: [[]] }).client).approve("u", "nope"),
    ).toBe("not_found");
    expect(
      await new SupabaseDocumentStore(fake({ select: [[row(draft)]], update: [] }).client).approve(
        "u",
        draft.id,
      ),
    ).toBe("already_approved");
  });

  it("deletes only the caller's row", async () => {
    const { client, calls } = fake({ delete: [{ id: "x" }] });
    expect(await new SupabaseDocumentStore(client).remove("u1", "x")).toBe(true);
    expect(calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["id", "x"],
    ]);
    expect(await new SupabaseDocumentStore(fake({ delete: [] }).client).remove("u1", "x")).toBe(
      false,
    );
  });
});
