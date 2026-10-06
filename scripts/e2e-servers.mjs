// Builds once, then serves the production build twice for e2e:
//   :3100  demo mode (no keys)
//   :3101  auth enabled, pointed at an unreachable Supabase URL, so unauthenticated
//          routing and failure states can be tested without a real project
import { spawn, spawnSync } from "node:child_process";

const next = ["node_modules/next/dist/bin/next"];
const build = spawnSync(process.execPath, [...next, "build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [];
const start = (port, env) => {
  const child = spawn(process.execPath, [...next, "start", "-p", String(port)], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
};
const stopAll = () => children.forEach((c) => c.kill());
process.on("SIGTERM", stopAll);
process.on("SIGINT", stopAll);
process.on("exit", stopAll);

async function waitFor(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { redirect: "manual" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`Server at ${url} did not start`);
}

start(3101, {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
  APP_URL: "http://localhost:3101",
});
await waitFor("http://localhost:3101/login");

// Started last: Playwright waits on this one, so both are up when tests begin.
start(3100, {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  APP_URL: "",
});
await new Promise(() => {});
