// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fromDbRow, sortItems, toDbRow } from "@/db/profile/mapping";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { StoreError } from "@/db/profile/store";
import { SupabaseProfileStore } from "@/db/profile/supabase-store";
import { DEMO_PERSONAS, getPersona } from "@/db/seed/demo-personas";
import { collectionSchemas, profileSchema, skillSchema } from "@/lib/profile/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";

const skill = (name: string) => skillSchema.parse({ name, type: "language", level: "advanced" });

describe("demo personas", () => {
  it("are valid against the real schemas (they parse at import) and have distinct ids", () => {
    expect(DEMO_PERSONAS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(DEMO_PERSONAS.map((p) => p.id)).size).toBe(DEMO_PERSONAS.length);
    expect(getPersona("nobody")).toBeUndefined();
  });

  it("never include skills that duplicate each other within a persona", () => {
    for (const p of DEMO_PERSONAS) {
      const names = p.skills.map((s) => s.name.toLowerCase());
      expect(new Set(names).size, p.id).toBe(names.length);
    }
  });

  it("leaves Docker out of the first persona so the missing-skill path can be demonstrated", () => {
    const asha = getPersona("asha")!;
    expect(asha.skills.map((s) => s.name)).not.toContain("Docker");
    expect(JSON.stringify(asha)).not.toMatch(/docker/i);
  });
});

describe("MemoryProfileStore", () => {
  it("seeds each new sandbox with the default persona and isolates sandboxes", async () => {
    const store = new MemoryProfileStore("asha");
    const a = await store.getSnapshot("visitor-a");
    expect(a.profile?.full_name).toBe("Asha Raman");

    await store.createItem("visitor-a", "skills", skill("Rust"));
    const b = await store.getSnapshot("visitor-b");
    expect(b.skills.map((s) => s.name)).not.toContain("Rust");
    expect((await store.getSnapshot("visitor-a")).skills.map((s) => s.name)).toContain("Rust");
  });

  it("starts blank when no default persona is configured", async () => {
    const snap = await new MemoryProfileStore(null).getSnapshot("u");
    expect(snap.profile).toBeNull();
    expect(snap.skills).toEqual([]);
  });

  it("returns copies, so callers cannot mutate stored state", async () => {
    const store = new MemoryProfileStore("asha");
    const first = await store.getSnapshot("u");
    first.skills.length = 0;
    first.profile!.full_name = "Tampered";
    const second = await store.getSnapshot("u");
    expect(second.skills.length).toBeGreaterThan(0);
    expect(second.profile?.full_name).toBe("Asha Raman");
  });

  it("creates, updates and deletes items, keeping created_at and bumping updated_at", async () => {
    const store = new MemoryProfileStore(null);
    const created = await store.createItem("u", "skills", skill("Go"));
    expect(created).toMatchObject({ source: "manual", confirmed: true });

    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.updateItem("u", "skills", created.id, {
      ...skill("Go"),
      level: "expert",
    });
    expect(updated.level).toBe("expert");
    expect(updated.created_at).toBe(created.created_at);
    expect(updated.updated_at > created.updated_at).toBe(true);

    expect(await store.deleteItem("u", "skills", created.id)).toBe(true);
    expect(await store.deleteItem("u", "skills", created.id)).toBe(false);
  });

  it("rejects duplicate skill names ignoring case, but allows renaming away and same-item saves", async () => {
    const store = new MemoryProfileStore(null);
    const go = await store.createItem("u", "skills", skill("Go"));
    await expect(store.createItem("u", "skills", skill("GO"))).rejects.toMatchObject({
      kind: "duplicate",
    });
    await expect(store.updateItem("u", "skills", go.id, skill("Go"))).resolves.toBeDefined();
  });

  it("throws not_found when updating an item that is not there or belongs to another sandbox", async () => {
    const store = new MemoryProfileStore(null);
    const mine = await store.createItem("owner", "skills", skill("Go"));
    await expect(
      store.updateItem("owner", "skills", crypto.randomUUID(), skill("Go")),
    ).rejects.toBeInstanceOf(StoreError);
    await expect(
      store.updateItem("intruder", "skills", mine.id, skill("Go")),
    ).rejects.toMatchObject({
      kind: "not_found",
    });
    expect(await store.deleteItem("intruder", "skills", mine.id)).toBe(false);
  });

  it("treats an edit as the user vouching for a resume-proposed item", async () => {
    const store = new MemoryProfileStore(null);
    const proposed = await store.createItem("u", "skills", skill("Go"), {
      source: "resume",
      confirmed: false,
    });
    expect(proposed.confirmed).toBe(false);
    const edited = await store.updateItem("u", "skills", proposed.id, skill("Go"));
    expect(edited).toMatchObject({ confirmed: true, source: "resume" });
  });

  it("saves singletons idempotently and keeps a stable id", async () => {
    const store = new MemoryProfileStore(null);
    const data = profileSchema.parse({ full_name: "A" });
    const first = await store.saveSingleton("u", "profiles", data);
    const second = await store.saveSingleton("u", "profiles", { ...data, full_name: "B" });
    expect(second.id).toBe(first.id);
    expect((await store.getSnapshot("u")).profile?.full_name).toBe("B");
  });

  it("loads personas, wipes, and rejects unknown personas", async () => {
    const store = new MemoryProfileStore(null);
    await store.loadPersona("u", "meera");
    expect((await store.getSnapshot("u")).profile?.full_name).toBe("Meera Nair");
    await store.wipe("u");
    const snap = await store.getSnapshot("u");
    expect(snap.profile).toBeNull();
    expect(snap.education).toEqual([]);
    await expect(store.loadPersona("u", "ghost")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("evicts the oldest sandboxes so memory stays bounded", async () => {
    const store = new MemoryProfileStore(null);
    await store.createItem("first", "skills", skill("Go"));
    for (let i = 0; i < 505; i++) await store.getSnapshot(`filler-${i}`);
    expect((await store.getSnapshot("first")).skills).toEqual([]);
  });

  it("counts items per collection", async () => {
    const store = new MemoryProfileStore("asha");
    expect(await store.countItems("u", "skills")).toBe(getPersona("asha")!.skills.length);
  });
});

describe("row mapping", () => {
  it("converts months to first-of-month dates and back, and drops private columns", () => {
    const row = toDbRow("education", { institution: "X", start_date: "2024-08", end_date: null });
    expect(row.start_date).toBe("2024-08-01");
    expect(row.end_date).toBeNull();
    const back = fromDbRow("education", { ...row, user_id: "u", is_demo: false });
    expect(back.start_date).toBe("2024-08");
    expect(back).not.toHaveProperty("user_id");
    expect(back).not.toHaveProperty("is_demo");
  });

  it("round-trips every persona item through the database representation", () => {
    for (const persona of DEMO_PERSONAS) {
      for (const project of persona.projects) {
        const back = fromDbRow("projects", toDbRow("projects", project));
        expect(collectionSchemas.projects.parse(back)).toEqual(project);
      }
    }
  });

  it("sorts newest first with undated items last, and skills by type then name", () => {
    const items = [
      { start_date: "2022-01", created_at: "1" },
      { start_date: null, created_at: "2" },
      { start_date: "2024-01", created_at: "3" },
    ];
    expect(sortItems("projects", items).map((i) => i.start_date)).toEqual([
      "2024-01",
      "2022-01",
      null,
    ]);
    const skills = [
      { type: "tool", name: "Git", created_at: "1" },
      { type: "language", name: "Python", created_at: "1" },
      { type: "language", name: "Go", created_at: "1" },
    ];
    expect(sortItems("skills", skills).map((s) => s.name)).toEqual(["Go", "Python", "Git"]);
  });
});

/** Records the query chain and resolves with a canned result. */
function fakeSupabase(result: {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number;
}) {
  const calls: { table: string; ops: [string, unknown[]][] }[] = [];
  const client = {
    from(table: string) {
      const entry = { table, ops: [] as [string, unknown[]][] };
      calls.push(entry);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "insert", "update", "upsert", "delete", "order"]) {
        chain[op] = (...args: unknown[]) => {
          entry.ops.push([op, args]);
          return chain;
        };
      }
      chain.maybeSingle = () =>
        Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
      chain.single = () =>
        Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({ data: result.data ?? [], error: result.error ?? null, count: result.count ?? 0 });
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("SupabaseProfileStore", () => {
  it("scopes updates and deletes to both the row id and the user id", async () => {
    const { client, calls } = fakeSupabase({
      data: {
        id: "i1",
        name: "Go",
        type: "language",
        level: "advanced",
        years: null,
        source: "manual",
        confirmed: true,
      },
    });
    const store = new SupabaseProfileStore(client);
    await store.updateItem("user-1", "skills", "i1", skill("Go"));
    const update = calls[0]!.ops;
    expect(update).toContainEqual(["eq", ["id", "i1"]]);
    expect(update).toContainEqual(["eq", ["user_id", "user-1"]]);

    const del = fakeSupabase({ data: [{ id: "i1" }] });
    expect(await new SupabaseProfileStore(del.client).deleteItem("user-1", "skills", "i1")).toBe(
      true,
    );
    expect(del.calls[0]!.ops).toContainEqual(["eq", ["user_id", "user-1"]]);
  });

  it("marks an edited item as confirmed and writes months as dates", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "i1", institution: "X", degree: "Y", start_date: "2024-08-01" },
    });
    await new SupabaseProfileStore(client).updateItem(
      "u",
      "education",
      "i1",
      collectionSchemas.education.parse({
        institution: "X",
        degree: "Y",
        start_date: "2024-08",
      }),
    );
    const [, args] = calls[0]!.ops.find(([op]) => op === "update")!;
    expect(args[0]).toMatchObject({ confirmed: true, start_date: "2024-08-01" });
  });

  it("sets user_id, source and confirmed on create, from the server and not the form", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "i1", name: "Go", type: "language", level: "advanced", years: null },
    });
    await new SupabaseProfileStore(client).createItem("user-1", "skills", skill("Go"), {
      source: "resume",
      confirmed: false,
    });
    const [, args] = calls[0]!.ops.find(([op]) => op === "insert")!;
    expect(args[0]).toMatchObject({ user_id: "user-1", source: "resume", confirmed: false });
  });

  it("upserts singletons on user_id", async () => {
    const { client, calls } = fakeSupabase({ data: { id: "p1", full_name: "A" } });
    await new SupabaseProfileStore(client).saveSingleton(
      "user-1",
      "profiles",
      profileSchema.parse({ full_name: "A" }),
    );
    const [, args] = calls[0]!.ops.find(([op]) => op === "upsert")!;
    expect(args[1]).toEqual({ onConflict: "user_id" });
    expect(args[0]).toMatchObject({ user_id: "user-1" });
  });

  it("maps a unique violation to a duplicate error", async () => {
    const { client } = fakeSupabase({
      error: { code: "23505", message: "duplicate key value (secret-name)" },
    });
    await expect(
      new SupabaseProfileStore(client).createItem("u", "skills", skill("Go")),
    ).rejects.toMatchObject({
      kind: "duplicate",
    });
  });

  it("reports not_found when an update matches no row", async () => {
    const { client } = fakeSupabase({ data: null });
    await expect(
      new SupabaseProfileStore(client).updateItem("u", "skills", "i1", skill("Go")),
    ).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  it("turns other database errors into an opaque error and never logs row contents", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase({
      error: { code: "XX000", message: "failed on row with email a@b.co" },
    });
    const error = await new SupabaseProfileStore(client)
      .createItem("u", "skills", skill("Go"))
      .catch((e) => e);
    expect(error).toBeInstanceOf(StoreError);
    expect(error.message).not.toContain("a@b.co");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("a@b.co");
    spy.mockRestore();
  });

  it("confirms a single item scoped to the row and the user", async () => {
    const { client, calls } = fakeSupabase({ data: [{ id: "i1" }] });
    expect(await new SupabaseProfileStore(client).confirmItem("user-1", "skills", "i1")).toBe(true);
    const ops = calls[0]!.ops;
    expect(ops).toContainEqual(["update", [{ confirmed: true }]]);
    expect(ops).toContainEqual(["eq", ["id", "i1"]]);
    expect(ops).toContainEqual(["eq", ["user_id", "user-1"]]);

    const none = fakeSupabase({ data: [] });
    expect(await new SupabaseProfileStore(none.client).confirmItem("user-1", "skills", "x")).toBe(
      false,
    );
  });

  it("confirms all pending items across every collection, only for this user", async () => {
    const { client, calls } = fakeSupabase({ data: [{ id: "a" }, { id: "b" }] });
    const changed = await new SupabaseProfileStore(client).confirmAll("user-1");
    expect(calls.map((c) => c.table)).toEqual([
      "education",
      "experiences",
      "projects",
      "certifications",
      "skills",
      "achievements",
    ]);
    expect(changed).toBe(12); // two rows reported per table in this fake
    for (const call of calls) {
      expect(call.ops).toContainEqual(["eq", ["user_id", "user-1"]]);
      expect(call.ops).toContainEqual(["eq", ["confirmed", false]]);
    }
  });

  it("returns the deleted flag false when nothing matched", async () => {
    const { client } = fakeSupabase({ data: [] });
    expect(await new SupabaseProfileStore(client).deleteItem("u", "skills", "missing")).toBe(false);
  });
});
