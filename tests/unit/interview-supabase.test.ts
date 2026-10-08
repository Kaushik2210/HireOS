// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { MemoryInterviewStore } from "@/db/interviews/memory-store";
import { InterviewStoreError, type Interview } from "@/db/interviews/store";
import { SupabaseInterviewStore } from "@/db/interviews/supabase-store";
import { MemoryPracticeStore } from "@/db/practice/memory-store";
import { PracticeStoreError } from "@/db/practice/store";
import { SupabasePracticeStore } from "@/db/practice/supabase-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { MAX_INTERVIEWS, MAX_SESSIONS } from "@/lib/interview/types";
import { buildQuestions } from "@/services/interview/questions";
import { scoreAnswer } from "@/services/interview/score";
import { makeJob } from "../fixtures/matching";

interface Script {
  select?: unknown[][];
  insert?: { data?: unknown; error?: { code?: string; message?: string } }[];
  update?: { data?: unknown; error?: { code?: string; message?: string } }[];
  delete?: unknown;
  error?: { code?: string; message?: string };
}

function fake(script: Script) {
  const calls: { op: string; args?: unknown; filters: [string, unknown][] }[] = [];
  let selects = 0;
  let inserts = 0;
  let updates = 0;
  const client = {
    from() {
      const call = { op: "select", args: undefined as unknown, filters: [] as [string, unknown][] };
      calls.push(call);
      const result = () => {
        if (script.error) return { data: null, error: script.error };
        if (call.op === "insert") {
          const r = script.insert?.[inserts++] ?? {};
          return { data: r.data ?? null, error: r.error ?? null };
        }
        if (call.op === "update") {
          const r = script.update?.[updates++] ?? {};
          return { data: r.data ?? [], error: r.error ?? null };
        }
        if (call.op === "delete") return { data: script.delete ?? [], error: null };
        return { data: script.select?.[selects++] ?? [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (a: unknown) => ((call.op = "insert"), (call.args = a), chain),
        update: (a: unknown) => ((call.op = "update"), (call.args = a), chain),
        delete: () => ((call.op = "delete"), chain),
        eq: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
        order: () => chain,
        limit: () => chain,
        single: async () => result(),
        maybeSingle: async () => {
          const r = result();
          return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
        },
        then: (resolve: (v: unknown) => unknown) => resolve(result()),
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const newInterview = {
  applicationId: "00000000-0000-4000-8000-000000000001",
  roundLabel: "Phone screen",
  kind: "phone_screen" as const,
  format: "video" as const,
  scheduledOn: "2026-10-20",
  scheduledTime: "14:30",
  interviewer: "Priya",
  notes: null,
  checklist: [{ id: "g1", text: "Re-read the posting", done: false, source: "generated" as const }],
};

function interviewRow(i: Interview) {
  return {
    id: i.id,
    application_id: i.applicationId,
    round_label: i.roundLabel,
    kind: i.kind,
    format: i.format,
    scheduled_on: i.scheduledOn,
    scheduled_time: i.scheduledTime ? `${i.scheduledTime}:00` : null,
    interviewer: i.interviewer,
    notes: i.notes,
    status: i.status,
    checklist: i.checklist,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
  };
}

describe("MemoryInterviewStore", () => {
  it("lists soonest first, undated last, and filters by application", async () => {
    const s = new MemoryInterviewStore();
    const base = { ...newInterview, scheduledOn: null, scheduledTime: null };
    const late = await s.create("u", {
      ...newInterview,
      roundLabel: "Late",
      scheduledOn: "2026-11-01",
    });
    const early = await s.create("u", {
      ...newInterview,
      roundLabel: "Early",
      scheduledOn: "2026-10-05",
    });
    const none = await s.create("u", { ...base, roundLabel: "Undated", applicationId: "other" });
    expect((await s.list("u")).map((i) => i.id)).toEqual([early.id, late.id, none.id]);
    expect((await s.list("u", { applicationId: "other" })).map((i) => i.id)).toEqual([none.id]);
  });

  it("keeps visitors separate, returns copies, and stops at the limit", async () => {
    const s = new MemoryInterviewStore();
    const made = await s.create("a", newInterview);
    expect(await s.get("b", made.id)).toBeNull();
    expect(await s.remove("b", made.id)).toBe(false);
    made.checklist[0]!.done = true;
    expect((await s.get("a", made.id))!.checklist[0]!.done).toBe(false);
    for (let i = 1; i < MAX_INTERVIEWS; i++) await s.create("a", newInterview);
    await expect(s.create("a", newInterview)).rejects.toMatchObject({ kind: "limit" });
  });
});

describe("SupabaseInterviewStore", () => {
  it("reads rows back with the time as HH:MM, scoped to the user", async () => {
    const made = await new MemoryInterviewStore().create("u", newInterview);
    const { client, calls } = fake({ select: [[interviewRow(made)]] });
    const list = await new SupabaseInterviewStore(client).list("u1", { applicationId: "app1" });
    expect(list).toEqual([made]);
    expect(calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["application_id", "app1"],
    ]);
  });

  it("skips a stored row that no longer fits the schema", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const made = await new MemoryInterviewStore().create("u", newInterview);
    const { client } = fake({
      select: [[{ ...interviewRow(made), kind: "chat" }, interviewRow(made)]],
    });
    expect(await new SupabaseInterviewStore(client).list("u")).toEqual([made]);
    spy.mockRestore();
  });

  it("creates with the owner, and maps a refused application to not found", async () => {
    const made = await new MemoryInterviewStore().create("u", newInterview);
    const ok = fake({ insert: [{ data: interviewRow(made) }] });
    await new SupabaseInterviewStore(ok.client).create("u1", newInterview);
    expect(ok.calls[0]!.args).toMatchObject({
      user_id: "u1",
      application_id: newInterview.applicationId,
      round_label: "Phone screen",
      scheduled_time: "14:30",
    });
    const refused = fake({ insert: [{ error: { code: "42501" } }] });
    await expect(
      new SupabaseInterviewStore(refused.client).create("u1", newInterview),
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("maps the limit to a safe error, without row contents", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const limit = fake({
      insert: [{ error: { code: "P0001", message: "interview limit reached" } }],
    });
    await expect(
      new SupabaseInterviewStore(limit.client).create("u", newInterview),
    ).rejects.toMatchObject({ kind: "limit" });
    const broken = fake({ error: { code: "XX000", message: "secret interview notes" } });
    const err = await new SupabaseInterviewStore(broken.client).list("u").catch((e) => e);
    expect(err).toBeInstanceOf(InterviewStoreError);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret interview notes");
    spy.mockRestore();
  });

  it("updates, sets the checklist and deletes only the caller's row", async () => {
    const ok = fake({ update: [{ data: [{ id: "x" }] }, { data: [] }], delete: [{ id: "x" }] });
    const store = new SupabaseInterviewStore(ok.client);
    const fields = {
      roundLabel: "R",
      kind: "technical" as const,
      format: null,
      scheduledOn: null,
      scheduledTime: null,
      interviewer: null,
      notes: null,
      status: "completed" as const,
    };
    expect(await store.update("u1", "x", fields)).toBe("updated");
    expect(ok.calls[0]!.args).toMatchObject({ round_label: "R", status: "completed" });
    expect(ok.calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["id", "x"],
    ]);
    expect(await store.setChecklist("u1", "x", [])).toBe("not_found");
    expect(await store.remove("u1", "x")).toBe(true);
  });
});

/* ---------- practice ---------- */

const profiles = new MemoryProfileStore("asha");
const job = makeJob({ required_skills: ["Python", "SQL"] });

async function session() {
  const snap = await profiles.getSnapshot("u");
  const questions = buildQuestions(snap, job, "technical", 3);
  const store = new MemoryPracticeStore();
  const created = await store.create("u", {
    jobId: job.id,
    jobTitle: job.title,
    companyName: job.company_name,
    focus: "technical",
    questions,
    round: 0,
  });
  return { snap, questions, created, store };
}

function sessionRow(s: Awaited<ReturnType<typeof session>>["created"]) {
  return {
    id: s.id,
    job_id: s.jobId,
    job_title: s.jobTitle,
    company_name: s.companyName,
    focus: s.focus,
    question_count: s.questionCount,
    questions: s.questions,
    round: s.round,
    status: s.status,
    overall: s.overall,
    dimensions: s.dimensions,
    created_at: s.createdAt,
    completed_at: s.completedAt,
  };
}

describe("MemoryPracticeStore", () => {
  it("takes answers in order and finishes with the true average", async () => {
    const { snap, questions, created, store } = await session();
    const fb = (text: string, i: number) => scoreAnswer(questions[i]!, text, snap);
    expect(await store.submitAnswer("u", created.id, 1, "x", fb("x", 1))).toBe("out_of_order");
    expect(await store.finish("u", created.id, [])).toBe("incomplete");
    const scores: number[] = [];
    for (let i = 0; i < 3; i++) {
      const f = fb(
        "A list is mutable because you can change it. For example I used one in my project.",
        i,
      );
      scores.push(f.overall);
      expect(await store.submitAnswer("u", created.id, i, "answer", f)).toBe("saved");
    }
    expect(await store.submitAnswer("u", created.id, 3, "x", fb("x", 0))).toBe("out_of_order");
    expect(
      await store.finish("u", created.id, [
        { id: "structure", label: "Structure", score: 50, answers: 3 },
      ]),
    ).toBe("finished");
    const done = (await store.get("u", created.id))!;
    expect(done.session).toMatchObject({
      status: "completed",
      overall: Math.round(scores.reduce((a, b) => a + b, 0) / 3),
    });
    expect(await store.submitAnswer("u", created.id, 0, "x", fb("x", 0))).toBe("finished");
    expect(await store.finish("u", created.id, [])).toBe("already_finished");
  });

  it("keeps visitors apart, detaches a deleted job, and stops at the limit", async () => {
    const { created, store } = await session();
    expect(await store.get("b", created.id)).toBeNull();
    expect(
      await store.submitAnswer(
        "b",
        created.id,
        0,
        "x",
        scoreAnswer(created.questions[0]!, "x", await profiles.getSnapshot("u")),
      ),
    ).toBe("not_found");
    expect(await store.remove("b", created.id)).toBe(false);
    await store.detachJob("u", job.id);
    expect((await store.get("u", created.id))!.session.jobId).toBeNull();
    for (let i = 1; i < MAX_SESSIONS; i++)
      await store.create("u", {
        jobId: job.id,
        jobTitle: "R",
        companyName: "C",
        focus: "technical",
        questions: created.questions,
        round: 0,
      });
    await expect(
      store.create("u", {
        jobId: job.id,
        jobTitle: "R",
        companyName: "C",
        focus: "technical",
        questions: created.questions,
        round: 0,
      }),
    ).rejects.toBeInstanceOf(PracticeStoreError);
  });
});

describe("SupabasePracticeStore", () => {
  it("reads a session and its answers back, validated, scoped to the user", async () => {
    const { snap, created, store } = await session();
    await store.submitAnswer(
      "u",
      created.id,
      0,
      "I used Python.",
      scoreAnswer(created.questions[0]!, "I used Python.", snap),
    );
    const got = (await store.get("u", created.id))!;
    const answerRow = {
      id: got.answers[0]!.id,
      position: 0,
      question: got.answers[0]!.question,
      answer: got.answers[0]!.answer,
      feedback: got.answers[0]!.feedback,
      overall: got.answers[0]!.overall,
      created_at: got.answers[0]!.createdAt,
    };
    const { client, calls } = fake({
      select: [[sessionRow(created)], [answerRow, { ...answerRow, id: "bad", feedback: {} }]],
    });
    const out = (await new SupabasePracticeStore(client).get("u1", created.id))!;
    expect(out.session).toEqual(created);
    expect(out.answers).toHaveLength(1);
    expect(calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["id", created.id],
    ]);
  });

  it("creates with the questions and their count, and maps the limit", async () => {
    const { created } = await session();
    const ok = fake({ insert: [{ data: sessionRow(created) }] });
    await new SupabasePracticeStore(ok.client).create("u1", {
      jobId: job.id,
      jobTitle: "T",
      companyName: "C",
      focus: "technical",
      questions: created.questions,
      round: 2,
    });
    expect(ok.calls[0]!.args).toMatchObject({
      user_id: "u1",
      focus: "technical",
      question_count: 3,
      round: 2,
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const limit = fake({
      insert: [{ error: { code: "P0001", message: "practice session limit reached" } }],
    });
    await expect(
      new SupabasePracticeStore(limit.client).create("u", {
        jobId: "j",
        jobTitle: "T",
        companyName: "C",
        focus: "technical",
        questions: created.questions,
        round: 0,
      }),
    ).rejects.toMatchObject({ kind: "limit" });
    spy.mockRestore();
  });

  it("saves answers in order, telling an out-of-order or finished session apart", async () => {
    const { snap, created } = await session();
    const fb = scoreAnswer(created.questions[0]!, "x", snap);
    const open = fake({ select: [[sessionRow(created)], []], insert: [{}] });
    expect(
      await new SupabasePracticeStore(open.client).submitAnswer("u1", created.id, 0, "x", fb),
    ).toBe("saved");
    expect(open.calls.find((c) => c.op === "insert")!.args).toMatchObject({
      user_id: "u1",
      session_id: created.id,
      position: 0,
      overall: fb.overall,
    });
    const skip = fake({ select: [[sessionRow(created)], []] });
    expect(
      await new SupabasePracticeStore(skip.client).submitAnswer("u1", created.id, 2, "x", fb),
    ).toBe("out_of_order");
    const done = fake({
      select: [
        [
          {
            ...sessionRow(created),
            status: "completed",
            overall: 50,
            completed_at: "2026-10-01T00:00:00Z",
          },
        ],
        [],
      ],
    });
    expect(
      await new SupabasePracticeStore(done.client).submitAnswer("u1", created.id, 0, "x", fb),
    ).toBe("finished");
    const race = fake({
      select: [[sessionRow(created)], []],
      insert: [{ error: { code: "23505" } }],
    });
    expect(
      await new SupabasePracticeStore(race.client).submitAnswer("u1", created.id, 0, "x", fb),
    ).toBe("out_of_order");
    expect(
      await new SupabasePracticeStore(fake({ select: [[]] }).client).submitAnswer(
        "u1",
        "x",
        0,
        "x",
        fb,
      ),
    ).toBe("not_found");
  });

  it("finishes only a complete session, with the average, guarded on status", async () => {
    const { snap, created, store } = await session();
    for (let i = 0; i < 3; i++)
      await store.submitAnswer(
        "u",
        created.id,
        i,
        "x",
        scoreAnswer(created.questions[i]!, "x", snap),
      );
    const got = (await store.get("u", created.id))!;
    const answers = got.answers.map((a) => ({
      id: a.id,
      position: a.position,
      question: a.question,
      answer: a.answer,
      feedback: a.feedback,
      overall: a.overall,
      created_at: a.createdAt,
    }));
    const ok = fake({
      select: [[sessionRow(created)], answers],
      update: [{ data: [{ id: created.id }] }],
    });
    expect(await new SupabasePracticeStore(ok.client).finish("u1", created.id, [])).toBe(
      "finished",
    );
    const update = ok.calls.find((c) => c.op === "update")!;
    expect(update.args).toMatchObject({
      status: "completed",
      overall: Math.round(got.answers.reduce((t, a) => t + a.overall, 0) / 3),
    });
    expect(update.filters).toContainEqual(["status", "in_progress"]);
    const partial = fake({ select: [[sessionRow(created)], answers.slice(0, 1)] });
    expect(await new SupabasePracticeStore(partial.client).finish("u1", created.id, [])).toBe(
      "incomplete",
    );
  });

  it("deletes only the caller's row", async () => {
    const { client, calls } = fake({ delete: [{ id: "x" }] });
    expect(await new SupabasePracticeStore(client).remove("u1", "x")).toBe(true);
    expect(calls[0]!.filters).toEqual([
      ["user_id", "u1"],
      ["id", "x"],
    ]);
    expect(await new SupabasePracticeStore(fake({ delete: [] }).client).remove("u1", "x")).toBe(
      false,
    );
  });
});
