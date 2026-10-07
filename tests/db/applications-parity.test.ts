// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryApplicationStore } from "@/db/applications/memory-store";
import { INITIAL_STATUSES, STATUSES } from "@/lib/applications/types";
import { as, createDb, createUser } from "./helpers";

/**
 * The demo store and the database must behave the same, because the demo is what people
 * see. This runs the same random script against both and compares every observable result.
 */

let db: PGlite;
let jobs: { id: string; title: string }[];

beforeAll(async () => {
  db = await createDb({ seed: true });
  jobs = (
    await db.query<{ id: string; title: string }>("select id, title from public.jobs limit 40")
  ).rows;
}, 90_000);

afterAll(async () => {
  await db.close();
});

/** A small deterministic random number generator, so a failure can be replayed. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, list: readonly T[]) => list[Math.floor(rand() * list.length)]!;

describe("the demo store matches the database", () => {
  it.each([1, 2, 3])(
    "for a random script (seed %i)",
    async (seed) => {
      const rand = rng(seed);
      // A fresh person per script, so earlier runs cannot make a job look already tracked.
      const user = await createUser(db);
      const sql = <T>(fn: () => Promise<T>) => as(db, "authenticated", user, fn);
      const memory = new MemoryApplicationStore();
      const dbIds: string[] = [];
      const memIds: string[] = [];
      const outcomes: string[] = [];
      const memoryOutcomes: string[] = [];

      for (let i = 0; i < 30; i++) {
        const job = jobs[(seed * 7 + i) % jobs.length]!;
        const status = pick(rand, INITIAL_STATUSES);
        const appliedOn = status === "applied" && rand() < 0.5 ? "2026-10-01" : null;

        let memId = "";
        try {
          memId = (
            await memory.create("u", {
              jobId: job.id,
              jobTitle: job.title,
              companyName: "Co",
              status,
              appliedOn,
            })
          ).id;
          memoryOutcomes.push("created");
        } catch (e) {
          memoryOutcomes.push(`create:${(e as { kind?: string }).kind}`);
        }
        let dbId = "";
        try {
          dbId = (
            await sql(() =>
              db.query<{ id: string }>(
                `insert into public.applications (user_id, job_id, job_title, company_name, status, applied_on)
               values ($1, $2, $3, 'Co', $4, $5) returning id`,
                [
                  user,
                  job.id,
                  job.title,
                  status,
                  status === "applied"
                    ? (appliedOn ?? new Date().toISOString().slice(0, 10))
                    : null,
                ],
              ),
            )
          ).rows[0]!.id;
          outcomes.push("created");
        } catch (e) {
          outcomes.push(`create:${/unique|duplicate/i.test(String(e)) ? "duplicate" : "other"}`);
        }
        if (memId && dbId) {
          memIds.push(memId);
          dbIds.push(dbId);
        }
      }
      expect(memoryOutcomes).toEqual(outcomes);
      expect(memIds.length).toBe(dbIds.length);

      for (let step = 0; step < 150; step++) {
        const k = Math.floor(rand() * memIds.length);
        const memId = memIds[k]!;
        const dbId = dbIds[k]!;
        const roll = rand();
        let a: string;
        let b: string;
        if (roll < 0.6) {
          const to = pick(rand, STATUSES);
          const note = rand() < 0.3 ? `note ${step}` : null;
          const on = to === "applied" && rand() < 0.5 ? "2026-09-15" : null;
          a = await memory.changeStatus("u", memId, to, note, on);
          try {
            await sql(() =>
              db.query("select public.change_application_status($1, $2, $3, $4)", [
                dbId,
                to,
                note,
                on,
              ]),
            );
            b = "moved";
          } catch (e) {
            b = /not allowed/.test(String(e)) ? "not_allowed" : `error:${e}`;
          }
        } else if (roll < 0.8) {
          const kind = pick(rand, ["note", "followed_up"] as const);
          const note = kind === "note" && rand() < 0.8 ? `n${step}` : null;
          a = await memory.addEvent("u", memId, kind, note);
          try {
            await sql(() =>
              db.query("select public.add_application_event($1, $2, $3)", [dbId, kind, note]),
            );
            b = "added";
          } catch (e) {
            b = /needs text/.test(String(e)) ? "invalid" : `error:${e}`;
          }
        } else {
          const follow = rand() < 0.5 ? null : "2026-10-20";
          const current = (await memory.get("u", memId))!.application;
          a = await memory.updateDetails("u", memId, {
            notes: current.notes,
            followUpOn: follow,
            resumeVersionId: null,
            coverLetterVersionId: null,
          });
          await sql(() =>
            db.query("update public.applications set follow_up_on = $2 where id = $1", [
              dbId,
              follow,
            ]),
          );
          b = "updated";
        }
        expect(a === "moved" || a === "added" || a === "updated" ? a : a, `step ${step}`).toBe(b);
      }

      for (let k = 0; k < memIds.length; k++) {
        const mem = (await memory.get("u", memIds[k]!))!;
        const row = (
          await db.query<{
            status: string;
            applied_on: string | null;
            follow_up_on: string | null;
          }>(
            "select status, applied_on::text, follow_up_on::text from public.applications where id = $1",
            [dbIds[k]],
          )
        ).rows[0]!;
        expect(mem.application.status, `application ${k}`).toBe(row.status);
        expect(mem.application.appliedOn, `application ${k}`).toBe(row.applied_on);
        expect(mem.application.followUpOn, `application ${k}`).toBe(row.follow_up_on);
        const events = (
          await db.query<{
            kind: string;
            from_status: string | null;
            to_status: string | null;
            note: string | null;
          }>(
            "select kind, from_status, to_status, note from public.application_events where application_id = $1 order by created_at, id",
            [dbIds[k]],
          )
        ).rows;
        expect(
          mem.events.map((e) => ({
            kind: e.kind,
            from_status: e.fromStatus,
            to_status: e.toStatus,
            note: e.note,
          })),
          `events of application ${k}`,
        ).toEqual(events);
      }
    },
    120_000,
  );
});
