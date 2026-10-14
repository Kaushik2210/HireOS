/* eslint-disable no-console -- a command-line tool: printing is its job */
// Captures the README screenshots from a running demo-mode server.
//
//   npm run build
//   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next start -p 3100
//   npm run screenshots            (or: node scripts/capture-screenshots.mjs http://localhost:3100)
//
// Everything shown is the fictional sample persona and sample jobs: no real data.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const base = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
const out = path.resolve(import.meta.dirname, "../docs/screenshots");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
const page = await desktop.newPage();

async function shot(name, url, options = {}) {
  await page.goto(`${base}${url}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  if (options.prepare) await options.prepare();
  // Let layout settle (fonts, the graph's SVG) before the picture is taken.
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(out, `${name}.png`),
    fullPage: options.fullPage ?? false,
  });
  console.log("captured", name);
}

await shot("dashboard", "/dashboard");
await shot("profile", "/profile");
await shot("jobs", "/jobs");

// A job with a breakdown, found by following the first card.
await page.goto(`${base}/jobs`);
const first = page.locator('a[href^="/jobs/"]').first();
const jobHref = await first.getAttribute("href");
if (!jobHref) throw new Error("no job link found");
// Long pages are captured as one tall view rather than a full-page stitch, so the sticky
// sidebar stays whole.
await page.setViewportSize({ width: 1440, height: 1500 });
await shot("job-detail", jobHref);
await shot("tailor", `${jobHref}/tailor`);
await shot("outreach", `${jobHref}/outreach`);
await page.setViewportSize({ width: 1440, height: 900 });

await shot("matches", "/matches");
await shot("applications", "/applications");
await shot("interviews", "/interviews");
await page.setViewportSize({ width: 1440, height: 1300 });
await shot("analytics", "/analytics");
await shot("gaps", "/gaps");
await page.setViewportSize({ width: 1440, height: 900 });
await shot("graph", "/graph");
await shot("privacy", "/settings");

// One phone-width view, to show the layout holds.
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  isMobile: true,
});
const mobile = await phone.newPage();
await mobile.goto(`${base}/dashboard`);
await mobile.getByRole("heading", { level: 1 }).first().waitFor();
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: path.join(out, "dashboard-mobile.png") });
console.log("captured dashboard-mobile");

await browser.close();
