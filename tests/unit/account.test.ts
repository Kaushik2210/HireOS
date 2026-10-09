// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDemoProfileStore } from "@/db/profile";
import type { AdminClient } from "@/services/account/delete";

type TestUser = { id: string; email: string | null; isDemo: boolean };
let user: TestUser | null = null;
let admin: unknown = null;
const recordAudit = vi.fn();
const signOut = vi.fn();

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => user,
  requireUser: async () => {
    if (!user) throw new RedirectSignal("/login");
    return user;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => admin }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));
vi.mock("@/services/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

const { deleteAccount } = await import("@/services/account/delete");
const accountActions = await import("@/features/account/actions");
const jobActions = await import("@/features/jobs/actions");
const { POST } = await import("@/app/api/account/export/route");
const { resetActionLimits } = await import("@/lib/security/action-limits");

async function redirected(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
}

function fakeAdmin(
  options: {
    files?: string[];
    listError?: boolean;
    removeError?: boolean;
    deleteError?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let files = [...(options.files ?? [])];
  const client: AdminClient = {
    storage: {
      from: () => ({
        list: async () => {
          calls.push("list");
          return options.listError
            ? { data: null, error: { message: "x" } }
            : { data: files.map((name) => ({ name })), error: null };
        },
        remove: async (paths: string[]) => {
          calls.push(`remove:${paths.join(",")}`);
          if (options.removeError) return { error: { message: "x" } };
          files = [];
          return { error: null };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          calls.push(`deleteUser:${id}`);
          return { error: options.deleteError ? { message: "x" } : null };
        },
      },
    },
  };
  return { client, calls };
}

beforeEach(() => {
  user = { id: "user-1", email: "a@example.test", isDemo: false };
  admin = null;
  recordAudit.mockReset();
  signOut.mockReset().mockResolvedValue({});
  resetActionLimits();
});

describe("deleteAccount", () => {
  it("removes uploaded files first, then the account", async () => {
    const { client, calls } = fakeAdmin({ files: ["r1.pdf", "r2.docx"] });
    expect(await deleteAccount("u-9", client)).toBe("deleted");
    expect(calls).toEqual(["list", "remove:u-9/r1.pdf,u-9/r2.docx", "list", "deleteUser:u-9"]);
  });

  it("works for an account with no files", async () => {
    const { client, calls } = fakeAdmin();
    expect(await deleteAccount("u-9", client)).toBe("deleted");
    expect(calls).toEqual(["list", "deleteUser:u-9"]);
  });

  it("leaves the account alone when files cannot be listed or removed", async () => {
    for (const options of [{ listError: true }, { files: ["a.pdf"], removeError: true }]) {
      const { client, calls } = fakeAdmin(options);
      expect(await deleteAccount("u-9", client)).toBe("failed");
      expect(calls.some((c) => c.startsWith("deleteUser"))).toBe(false);
    }
  });

  it("reports failure when the account itself cannot be deleted", async () => {
    const { client } = fakeAdmin({ deleteError: true });
    expect(await deleteAccount("u-9", client)).toBe("failed");
  });

  it("never throws", async () => {
    const broken = {
      storage: {
        from: () => {
          throw new Error("boom");
        },
      },
      auth: { admin: { deleteUser: async () => ({ error: null }) } },
    } as unknown as AdminClient;
    expect(await deleteAccount("u-9", broken)).toBe("failed");
  });
});

describe("deleteAccountAction", () => {
  it("needs the typed phrase, and checks it on the server", async () => {
    const f = fakeAdmin();
    admin = f.client;
    for (const confirm of ["", "delete", "yes please", "delete my account now"]) {
      const result = await accountActions.deleteAccountAction({ confirm });
      expect(result.ok).toBe(false);
    }
    expect(f.calls).toEqual([]);
  });

  it("deletes the signed-in account, records it without the user, and sends them to sign in", async () => {
    const f = fakeAdmin({ files: ["x.pdf"] });
    admin = f.client;
    const to = await redirected(
      accountActions.deleteAccountAction({ confirm: "  Delete My Account " }),
    );
    expect(to).toBe("/login?reason=deleted");
    expect(f.calls).toContain("deleteUser:user-1");
    expect(f.calls.join()).toContain("remove:user-1/x.pdf");
    expect(recordAudit).toHaveBeenCalledWith("account.deleted", null);
    expect(signOut).toHaveBeenCalled();
  });

  it("can only act on the caller, whatever the request carries", async () => {
    const f = fakeAdmin();
    admin = f.client;
    await redirected(
      accountActions.deleteAccountAction({ confirm: "delete my account", userId: "someone-else" }),
    );
    expect(f.calls.filter((c) => c.startsWith("deleteUser"))).toEqual(["deleteUser:user-1"]);
  });

  it("refuses demo sandboxes and servers without the admin key", async () => {
    const f = fakeAdmin();
    admin = f.client;
    user = { id: "d", email: null, isDemo: true };
    expect((await accountActions.deleteAccountAction({ confirm: "delete my account" })).ok).toBe(
      false,
    );
    expect(f.calls).toEqual([]);

    user = { id: "user-1", email: null, isDemo: false };
    admin = null;
    const result = await accountActions.deleteAccountAction({ confirm: "delete my account" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("not available") });
  });

  it("keeps the account when deletion fails and says so", async () => {
    admin = fakeAdmin({ deleteError: true }).client;
    const result = await accountActions.deleteAccountAction({ confirm: "delete my account" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Nothing was lost") });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("stops repeated attempts", async () => {
    admin = fakeAdmin({ deleteError: true }).client;
    for (let i = 0; i < 5; i++) {
      await accountActions.deleteAccountAction({ confirm: "delete my account" });
    }
    const result = await accountActions.deleteAccountAction({ confirm: "delete my account" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Too many") });
  });
});

describe("signOutEverywhereAction", () => {
  it("ends every session and records it", async () => {
    const to = await redirected(accountActions.signOutEverywhereAction());
    expect(to).toBe("/login");
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(recordAudit).toHaveBeenCalledWith("auth.sign_out_all", "user-1");
  });

  it("does nothing to a demo sandbox beyond leaving", async () => {
    user = { id: "d", email: null, isDemo: true };
    expect(await redirected(accountActions.signOutEverywhereAction())).toBe("/login");
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/export", () => {
  const ORIGIN = "https://app.test";
  const post = (headers: Record<string, string> = { origin: ORIGIN }) =>
    POST(new NextRequest(`${ORIGIN}/api/account/export`, { method: "POST", headers }));

  const GOOD_JOB = {
    company_name: "Acme Robotics",
    title: "Backend Engineer",
    location: "Pune",
    work_mode: "hybrid",
    job_type: "full_time",
    apply_url: "https://careers.acme.example/jobs/1",
    description:
      "Build services for our fleet.\n\nRequirements\n• 3+ years of experience with Python and PostgreSQL\n• Experience with Docker",
  };

  beforeEach(() => {
    user = { id: `export-${crypto.randomUUID()}`, email: "a@example.test", isDemo: true };
  });

  it("refuses cross-site requests and signed-out callers", async () => {
    expect((await post({ origin: "https://evil.test" })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    user = null;
    expect((await post()).status).toBe(401);
  });

  it("returns the person's data as a download that is never cached", async () => {
    await getDemoProfileStore().loadPersona(user!.id, "asha");
    await redirected(jobActions.addJobAction(GOOD_JOB));

    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="hireos-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const body = (await res.json()) as {
      format: string;
      account: { id: string; email: string };
      profile: { skills: unknown[] };
      jobs_added_by_you: { title: string; owner_user_id: string }[];
      applications: unknown[];
      notes: string[];
    };
    expect(body.format).toBe("hireos-export-1");
    expect(body.account.id).toBe(user!.id);
    expect(body.profile.skills.length).toBeGreaterThan(0);
    expect(body.jobs_added_by_you.map((j) => j.title)).toEqual(["Backend Engineer"]);
    expect(body.jobs_added_by_you.every((j) => j.owner_user_id === user!.id)).toBe(true);
    expect(body.notes.join(" ")).toMatch(/demo data/i);
  });

  it("holds nothing that belongs to another person or to the shared catalogue", async () => {
    const other = { id: `export-other-${crypto.randomUUID()}`, email: null, isDemo: true };
    const mine = user!;
    user = other;
    await getDemoProfileStore().loadPersona(other.id, "rohan");
    await redirected(jobActions.addJobAction({ ...GOOD_JOB, title: "Secret Other Role" }));
    user = mine;

    const text = await (await post()).text();
    expect(text).not.toContain("Secret Other Role");
    expect(text).not.toContain(other.id);
  });

  it("limits how often a person can export", async () => {
    for (let i = 0; i < 5; i++) expect((await post()).status).toBe(200);
    const res = await post();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
