/* eslint-disable no-console -- a command-line tool: printing is its job */
// Joins every migration, in order, into one file you can paste into the Supabase SQL Editor.
// It is a convenience for people who would rather not install the Supabase CLI.
// Run: npm run supabase:bundle   (writes supabase/.temp/setup.sql, which git ignores)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "supabase/migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const out = [
  "-- HireOS database setup: every migration, in order. Run once on a new, empty project.",
  `-- ${files.length} migrations.`,
  "",
  ...files.flatMap((f) => [
    `-- ===== ${f} =====`,
    readFileSync(path.join(dir, f), "utf8").trim(),
    "",
  ]),
].join("\n");

const target = path.join(root, "supabase/.temp");
mkdirSync(target, { recursive: true });
const file = path.join(target, "setup.sql");
writeFileSync(file, out);
console.log(
  `Wrote ${files.length} migrations (${Math.round(out.length / 1024)} KB) to ${path.relative(root, file)}`,
);
console.log(
  "Open that file, copy everything, and paste it into the Supabase SQL Editor, then Run.",
);
