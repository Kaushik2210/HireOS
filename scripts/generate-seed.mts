import { writeFileSync } from "node:fs";
import path from "node:path";
import { generateJobsSeedSql } from "@/db/seed/jobs-sql";

// Regenerates supabase/seed.sql from the demo dataset. Run with `npm run seed:generate`.
const target = path.resolve(process.cwd(), "supabase/seed.sql");
const sql = await generateJobsSeedSql();
writeFileSync(target, sql, "utf8");
process.stdout.write(`Wrote ${target} (${sql.length} bytes)\n`);
