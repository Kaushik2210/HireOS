/* eslint-disable no-console -- a command-line tool: printing is its job */
// Checks a real Supabase project against what HireOS expects. Reads .env.local, prints
// pass or fail for each check, and never prints a key. Run: npm run supabase:check
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
try {
  process.loadEnvFile(path.join(root, ".env.local"));
} catch {
  console.error(
    "No .env.local found. Copy .env.example to .env.local and fill in the Supabase values.",
  );
  process.exit(1);
}

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

let failures = 0;
const ok = (msg) => console.log(`  PASS  ${msg}`);
const bad = (msg, hint) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
  if (hint) console.log(`        ${hint}`);
};
const warn = (msg) => console.log(`  NOTE  ${msg}`);

if (!url || !anon) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set in .env.local.",
  );
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) {
  warn(
    "The URL does not look like https://<project-ref>.supabase.co. That is fine for a self-hosted setup.",
  );
}

const call = async (pathname, key, init = {}) => {
  try {
    const res = await fetch(`${url}${pathname}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (error) {
    return {
      status: 0,
      body: { message: error instanceof Error ? error.message : "request failed" },
    };
  }
};

// The tables the migrations create, read from the migration files themselves.
const dir = path.join(root, "supabase/migrations");
const tables = [
  ...new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .flatMap((f) =>
        [...readFileSync(path.join(dir, f), "utf8").matchAll(/create table public\.(\w+)/g)].map(
          (m) => m[1],
        ),
      ),
  ),
];

console.log("\nHireOS Supabase check\n");

console.log("Connection and sign-in settings");
const settings = await call("/auth/v1/settings", anon);
if (settings.status === 200) {
  ok("The project answers and the anon key is accepted.");
  if (settings.body?.disable_signup)
    warn("Sign-ups are turned off in Auth settings. Turn them on to create an account.");
  else ok("Email sign-up is enabled.");
  if (settings.body?.mailer_autoconfirm) {
    warn(
      "Email confirmation is OFF (accounts are confirmed automatically). Fine for local testing; turn it on before sharing the app.",
    );
  } else {
    ok("Email confirmation is on.");
  }
} else if (settings.status === 0) {
  bad("Could not reach the project.", `${settings.body?.message}. Check NEXT_PUBLIC_SUPABASE_URL.`);
} else {
  bad(
    `The anon key was rejected (HTTP ${settings.status}).`,
    "Copy the anon public key again from Project Settings, API.",
  );
}

console.log("\nTables and access rules (anon must be denied)");
let missing = 0;
for (const table of tables) {
  const r = await call(`/rest/v1/${table}?select=*&limit=1`, anon);
  const code = r.body?.code;
  if (r.status === 404 || code === "PGRST205" || code === "42P01") {
    missing++;
    bad(`${table}: not found`);
  } else if (r.status === 200 && Array.isArray(r.body) && r.body.length > 0) {
    bad(
      `${table}: an anonymous visitor can read rows`,
      "Row Level Security or grants are not as the migrations set them.",
    );
  } else if (r.status === 200 || r.status === 401 || r.status === 403 || code === "42501") {
    ok(`${table}: present, and anonymous access is closed`);
  } else {
    bad(`${table}: unexpected answer (HTTP ${r.status}${code ? `, ${code}` : ""})`);
  }
}
if (missing > 0) {
  console.log(
    "\n        Some tables are missing. Apply the migrations (see SUPABASE_SETUP.md, step 4).",
  );
}

console.log("\nServer-side checks");
if (!service) {
  warn("SUPABASE_SERVICE_ROLE_KEY is not set, so storage and seed checks were skipped.");
} else {
  const bucket = await call("/storage/v1/bucket/resumes", service);
  if (bucket.status === 200) {
    ok(
      `The private "resumes" bucket exists${bucket.body?.public === false ? "" : " (but it is public: it should be private)"}.`,
    );
    if (bucket.body?.public !== false) failures++;
  } else {
    bad(
      'The "resumes" storage bucket is missing.',
      "It is created by the migrations; apply them first.",
    );
  }
  const jobs = await call("/rest/v1/jobs?select=id&is_demo=eq.true&limit=1", service);
  if (jobs.status === 200 && Array.isArray(jobs.body) && jobs.body.length > 0) {
    ok("Demo jobs are loaded.");
  } else if (jobs.status === 200) {
    warn(
      "No demo jobs are loaded. That is fine; load supabase/seed.sql if you want sample jobs to browse.",
    );
  } else {
    bad("Could not read the jobs table with the service key.", "Check SUPABASE_SERVICE_ROLE_KEY.");
  }
}

console.log(
  failures === 0
    ? "\nAll checks passed. Start the app with npm run dev and create an account.\n"
    : `\n${failures} check${failures === 1 ? "" : "s"} failed. See SUPABASE_SETUP.md for the matching step.\n`,
);
process.exit(failures === 0 ? 0 : 1);
