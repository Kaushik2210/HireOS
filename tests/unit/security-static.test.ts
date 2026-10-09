// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Source-level guards for the rules the security model rests on. They read the code, so a
// change that quietly breaks a rule fails here instead of in review.

const root = path.resolve(__dirname, "../..");
const APP_DIRS = ["app", "components", "features", "hooks", "lib", "services", "db", "utils", "ai"];

function walk(dir: string): string[] {
  const full = path.join(root, dir);
  try {
    statSync(full);
  } catch {
    return [];
  }
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel.replaceAll("\\", "/")] : [];
  });
}

const FILES = [...APP_DIRS.flatMap(walk), "proxy.ts", "instrumentation-client.ts"];
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("dangerous constructs", () => {
  const PATTERNS: [string, RegExp][] = [
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["eval()", /\beval\s*\(/],
    ["new Function()", /new\s+Function\s*\(/],
    ["innerHTML assignment", /\.(inner|outer)HTML\s*=/],
    ["document.write", /document\.write\s*\(/],
    ["insertAdjacentHTML", /insertAdjacentHTML/],
  ];

  for (const [name, pattern] of PATTERNS) {
    it(`never uses ${name}`, () => {
      const hits = FILES.filter((f) => pattern.test(stripComments(read(f))));
      expect(hits).toEqual([]);
    });
  }

  it("never logs anything but fixed messages with ids or codes", () => {
    const calls = FILES.flatMap((f) =>
      [...stripComments(read(f)).matchAll(/console\.(\w+)\(/g)].map((m) => `${f}: ${m[1]}`),
    );
    // Only error-level logging, and only in the places that report a failure.
    expect(calls.filter((c) => !c.endsWith(": error"))).toEqual([]);
  });
});

// Type-only imports vanish at build time, so they cannot pull server code into the browser.
const withoutTypeImports = (src: string) => src.replace(/^import type [^;]*;$/gm, "");

describe("secrets stay on the server", () => {
  it("reads the process environment only in the configuration module", () => {
    const allowed = new Set(["lib/env.ts"]);
    const hits = FILES.filter((f) => {
      if (allowed.has(f)) return false;
      // NODE_ENV is a build constant, not a secret.
      const uses = [...stripComments(read(f)).matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]);
      return uses.some((name) => name !== "NODE_ENV");
    });
    expect(hits).toEqual([]);
  });

  it("limits browser-visible variables to the two Supabase values", () => {
    const names = new Set(
      FILES.flatMap((f) => [...read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)].map((m) => m[0])),
    );
    expect([...names].sort()).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("uses the service role key in one place and imports its client from three", () => {
    const keyUsers = FILES.filter((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(read(f)));
    expect(keyUsers.sort()).toEqual(["lib/env.ts", "lib/supabase/admin.ts"]);

    const importers = FILES.filter((f) => /@\/lib\/supabase\/admin/.test(read(f)));
    // Audit logging, shared rate limits and account deletion are the only system work.
    expect(importers.sort()).toEqual([
      "features/account/actions.ts",
      "lib/security/limits.ts",
      "services/audit.ts",
    ]);
  });

  it("keeps server-only code out of client components", () => {
    const clientFiles = FILES.filter((f) => /^\s*["']use client["']/.test(read(f)));
    expect(clientFiles.length).toBeGreaterThan(10);
    const FORBIDDEN = [
      /from ["']@\/db\//,
      /from ["']@\/lib\/supabase\//,
      /from ["']@\/lib\/env["']/,
      /from ["']@\/services\/audit["']/,
      /from ["']node:/,
      /from ["']next\/headers["']/,
      /from ["']server-only["']/,
    ];
    const hits = clientFiles.flatMap((f) =>
      FORBIDDEN.filter((p) => p.test(withoutTypeImports(read(f)))).map((p) => `${f}: ${p.source}`),
    );
    expect(hits).toEqual([]);
  });
});

describe("server actions", () => {
  const actionFiles = FILES.filter((f) => /^features\/[^/]+\/actions\.ts$/.test(f));

  it("are found", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(8);
  });

  it("are marked as server actions", () => {
    for (const file of actionFiles) {
      expect(read(file).trimStart().startsWith('"use server"'), file).toBe(true);
    }
  });

  it("each resolve the signed-in user before touching data", () => {
    const PUBLIC_BY_DESIGN = new Set([
      "signInAction",
      "signUpAction",
      "signOutAction",
      "requestPasswordResetAction",
    ]);
    const gaps: string[] = [];
    for (const file of actionFiles) {
      const src = stripComments(read(file));
      const chunks = src.split(/(?=\nexport async function )/).slice(1);
      for (const chunk of chunks) {
        const name = /export async function (\w+)/.exec(chunk)![1]!;
        if (PUBLIC_BY_DESIGN.has(name)) continue;
        // Directly, or through a helper in the same file that does.
        if (!/requireUser\(|loadContext\(|withInterview\(/.test(chunk))
          gaps.push(`${file}: ${name}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it("limit how fast a person can change things", () => {
    const missing: string[] = [];
    for (const file of actionFiles.filter((f) => !f.startsWith("features/auth/"))) {
      const src = stripComments(read(file));
      if (!/limitAction\(/.test(src)) missing.push(file);
    }
    expect(missing).toEqual([]);
  });

  it("validate their input with a schema before doing anything", () => {
    const unvalidated: string[] = [];
    const NO_INPUT = /\(\s*\)\s*:\s*Promise/; // takes no arguments
    for (const file of actionFiles) {
      const src = stripComments(read(file));
      for (const chunk of src.split(/(?=\nexport async function )/).slice(1)) {
        const signature = chunk.slice(0, chunk.indexOf("{"));
        const name = /export async function (\w+)/.exec(chunk)![1]!;
        if (NO_INPUT.test(signature)) continue;
        // A schema, or for a lone flag or id an explicit check against a type or an allow-list.
        if (!/\.(safeParse|parse)\(|Schema\b|typeof \w+ !== |getPersona\(/.test(chunk)) {
          unvalidated.push(`${file}: ${name}`);
        }
      }
    }
    expect(unvalidated).toEqual([]);
  });
});

describe("route handlers", () => {
  const routes = FILES.filter((f) => /^app\/.*route\.ts$/.test(f));

  it("are found", () => {
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it("check the origin of every request that changes or exports data", () => {
    const gaps: string[] = [];
    for (const file of routes) {
      const src = stripComments(read(file));
      const changes = /export async function (POST|PUT|PATCH|DELETE)\b/.test(src);
      if (changes && !/isSameOrigin\(/.test(src)) gaps.push(file);
    }
    expect(gaps).toEqual([]);
  });

  it("answer only signed-in callers, except the sign-in callback", () => {
    const gaps = routes
      .filter((f) => f !== "app/auth/callback/route.ts")
      .filter((f) => !/getCurrentUser\(/.test(stripComments(read(f))));
    expect(gaps).toEqual([]);
  });
});
