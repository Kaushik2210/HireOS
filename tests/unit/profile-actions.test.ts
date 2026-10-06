// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { MAX_ITEMS_PER_COLLECTION } from "@/lib/profile/constants";

let store = new MemoryProfileStore(null);
let user: { id: string; email: string | null; isDemo: boolean } | null = {
  id: "user-1",
  email: "a@b.co",
  isDemo: false,
};
const revalidatePath = vi.fn();

class RedirectSignal extends Error {}

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!user) throw new RedirectSignal("/login");
    return user;
  },
}));
vi.mock("@/db/profile", () => ({
  getProfileStore: async () => store,
  getDemoProfileStore: () => store,
}));

const actions = await import("@/features/profile/actions");

const skill = { name: "js", type: "language", level: "advanced", years: 2 };
const id = () => crypto.randomUUID();

beforeEach(() => {
  store = new MemoryProfileStore(null);
  user = { id: "user-1", email: "a@b.co", isDemo: false };
  revalidatePath.mockClear();
});

describe("saveItemAction", () => {
  it("creates an item, standardising a recognised skill name, and refreshes the pages", async () => {
    expect(await actions.saveItemAction("skills", null, skill)).toEqual({ ok: true });
    const { skills } = await store.getSnapshot("user-1");
    expect(skills.map((s) => s.name)).toEqual(["JavaScript"]);
    expect(revalidatePath).toHaveBeenCalledWith("/profile");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("keeps unrecognised skills as typed", async () => {
    await actions.saveItemAction("skills", null, { ...skill, name: "Obscure Tool" });
    expect((await store.getSnapshot("user-1")).skills[0]?.name).toBe("Obscure Tool");
  });

  it("returns field errors for invalid input and stores nothing", async () => {
    const r = await actions.saveItemAction("projects", null, {
      name: "",
      url: "javascript:alert(1)",
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.fieldErrors?.name).toBeDefined();
      expect(r.fieldErrors?.url).toBeDefined();
    }
    expect((await store.getSnapshot("user-1")).projects).toEqual([]);
  });

  it("rejects an unknown section or malformed id without touching the store", async () => {
    expect(await actions.saveItemAction("users", null, {})).toMatchObject({ ok: false });
    expect(await actions.saveItemAction("skills; drop table", null, skill)).toMatchObject({
      ok: false,
    });
    expect(await actions.saveItemAction("skills", "not-a-uuid", skill)).toMatchObject({
      ok: false,
    });
  });

  it("reports a duplicate skill against the name field, matching aliases too", async () => {
    await actions.saveItemAction("skills", null, skill);
    const r = await actions.saveItemAction("skills", null, { ...skill, name: "JavaScript" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.fieldErrors?.name?.[0]).toMatch(/already/i);
  });

  it("updates an existing item", async () => {
    await actions.saveItemAction("skills", null, skill);
    const [created] = (await store.getSnapshot("user-1")).skills;
    await actions.saveItemAction("skills", created!.id, {
      ...skill,
      name: "JavaScript",
      level: "expert",
    });
    expect((await store.getSnapshot("user-1")).skills[0]?.level).toBe("expert");
  });

  it("will not update an item that does not exist or belongs to someone else", async () => {
    const other = await store.createItem("someone-else", "skills", {
      name: "Go",
      type: "language",
      level: "advanced",
      years: null,
    });
    const hijack = await actions.saveItemAction("skills", other.id, { ...skill, name: "Hijacked" });
    expect(hijack).toMatchObject({ ok: false });
    expect((await store.getSnapshot("someone-else")).skills[0]?.name).toBe("Go");
    expect(await actions.saveItemAction("skills", id(), skill)).toMatchObject({ ok: false });
  });

  it("enforces the per-section limit", async () => {
    for (let i = 0; i < MAX_ITEMS_PER_COLLECTION; i++) {
      await store.createItem("user-1", "achievements", {
        title: `A${i}`,
        category: "award",
        description: null,
        achieved_on: null,
      });
    }
    const r = await actions.saveItemAction("achievements", null, {
      title: "One too many",
      category: "award",
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/up to 50/);
  });

  it("requires a signed-in user", async () => {
    user = null;
    await expect(actions.saveItemAction("skills", null, skill)).rejects.toBeInstanceOf(
      RedirectSignal,
    );
  });

  it("returns a generic error when the store fails, without leaking details", async () => {
    store.createItem = async () => {
      throw new Error("connection string postgres://secret@host");
    };
    const r = await actions.saveItemAction("skills", null, skill);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});

describe("deleteItemAction", () => {
  it("deletes only the caller's own item", async () => {
    const mine = await store.createItem("user-1", "skills", {
      name: "Go",
      type: "language",
      level: "advanced",
      years: null,
    });
    const theirs = await store.createItem("other", "skills", {
      name: "Rust",
      type: "language",
      level: "advanced",
      years: null,
    });

    expect(await actions.deleteItemAction("skills", theirs.id)).toMatchObject({ ok: false });
    expect((await store.getSnapshot("other")).skills).toHaveLength(1);

    expect(await actions.deleteItemAction("skills", mine.id)).toEqual({ ok: true });
    expect((await store.getSnapshot("user-1")).skills).toEqual([]);
  });

  it("validates its inputs", async () => {
    expect(await actions.deleteItemAction("nope", id())).toMatchObject({ ok: false });
    expect(await actions.deleteItemAction("skills", "1; drop table skills")).toMatchObject({
      ok: false,
    });
  });
});

describe("profile and goals", () => {
  it("saves the profile and validates it", async () => {
    expect(await actions.saveProfileAction({ full_name: "Asha", work_modes: ["remote"] })).toEqual({
      ok: true,
    });
    expect((await store.getSnapshot("user-1")).profile?.work_modes).toEqual(["remote"]);
    expect(await actions.saveProfileAction({ full_name: "" })).toMatchObject({ ok: false });
    expect(
      await actions.saveProfileAction({ full_name: "A", work_modes: ["teleport"] }),
    ).toMatchObject({ ok: false });
  });

  it("saves career goals and validates them", async () => {
    expect(
      await actions.saveGoalsAction({ target_roles: ["Backend Engineer"], timeline_months: 6 }),
    ).toEqual({ ok: true });
    expect((await store.getSnapshot("user-1")).goals?.target_roles).toEqual(["Backend Engineer"]);
    expect(await actions.saveGoalsAction({ timeline_months: 0 })).toMatchObject({ ok: false });
  });
});

describe("demo-only actions", () => {
  it("are refused for real accounts", async () => {
    expect(await actions.loadDemoPersonaAction("asha")).toMatchObject({ ok: false });
    expect(await actions.wipeDemoDataAction()).toMatchObject({ ok: false });
  });

  it("load a persona and wipe the sandbox in demo mode", async () => {
    user = { id: "demo-x", email: null, isDemo: true };
    expect(await actions.loadDemoPersonaAction("asha")).toEqual({ ok: true });
    expect((await store.getSnapshot("demo-x")).profile?.full_name).toBe("Asha Raman");
    expect(await actions.loadDemoPersonaAction("ghost")).toMatchObject({ ok: false });
    expect(await actions.wipeDemoDataAction()).toEqual({ ok: true });
    expect((await store.getSnapshot("demo-x")).profile).toBeNull();
  });
});
