import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import {
  BEHAVIORAL_QUESTIONS,
  MOTIVATION_QUESTIONS,
  SKILL_QUESTIONS,
  type BankQuestion,
} from "@/lib/interview/bank";
import { questionSchema, type MockFocus, type Question } from "@/lib/interview/types";
import { normalizeKey, normalizeSkill } from "@/lib/skills/catalog";
import { buildCandidate } from "@/services/matching/candidate";
import { verifiedSnapshot } from "@/services/profile/verified";

const rotate = <T>(list: readonly T[], by: number): T[] => {
  if (list.length === 0) return [];
  const k = ((by % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
};

const fill = (text: string, job: Job) =>
  text.replaceAll("{company}", job.company_name).replaceAll("{title}", job.title);

const fromBank = (
  id: string,
  kind: Question["kind"],
  q: BankQuestion,
  job: Job,
  skill: string | null = null,
  gap = false,
): Question => ({
  id,
  kind,
  text: fill(q.text, job),
  skill,
  expects: q.expects,
  gap,
});

/** What to draw from, per kind of practice, in the order the questions are asked. */
const PLAN: Record<MockFocus, { kind: Question["kind"]; weight: number }[]> = {
  technical: [
    { kind: "technical", weight: 6 },
    { kind: "project", weight: 2 },
    { kind: "behavioral", weight: 2 },
  ],
  behavioral: [
    { kind: "behavioral", weight: 7 },
    { kind: "project", weight: 1.5 },
    { kind: "experience", weight: 1.5 },
  ],
  screen: [
    { kind: "motivation", weight: 3 },
    { kind: "project", weight: 2 },
    { kind: "technical", weight: 2 },
    { kind: "behavioral", weight: 3 },
  ],
  final: [
    { kind: "motivation", weight: 1 },
    { kind: "technical", weight: 4 },
    { kind: "project", weight: 2 },
    { kind: "behavioral", weight: 3 },
  ],
};

/** When a pool runs short, these are tried in turn. */
const FALLBACK: Question["kind"][] = [
  "technical",
  "behavioral",
  "project",
  "experience",
  "motivation",
];

/** Splits `count` across the plan by weight, largest remainders first, so it always sums. */
function allocate(count: number, plan: { kind: Question["kind"]; weight: number }[]) {
  const total = plan.reduce((t, p) => t + p.weight, 0);
  const shares = plan.map((p) => ({ kind: p.kind, exact: (p.weight / total) * count }));
  const out = shares.map((s) => ({ kind: s.kind, n: Math.floor(s.exact), rest: s.exact % 1 }));
  let left = count - out.reduce((t, s) => t + s.n, 0);
  for (const s of [...out].sort((a, b) => b.rest - a.rest)) {
    if (left-- > 0) s.n++;
  }
  return out.map(({ kind, n }) => ({ kind, n }));
}

/**
 * Chooses practice questions for a job from the built-in bank and the person's verified
 * profile. Technical questions follow the skills the posting asks for: those the person has
 * come first, and a skill they lack is still asked once (marked as a gap) because that is a
 * real thing to be ready for. Project and experience questions use their own verified items.
 * The same inputs always give the same questions; `round` rotates the choice so a second
 * practice session covers different ones.
 */
export function buildQuestions(
  snapshot: ProfileSnapshot,
  job: Job,
  focus: MockFocus,
  count: number,
  round = 0,
): Question[] {
  const v = verifiedSnapshot(snapshot);
  const have = buildCandidate(snapshot).skills;

  /* ---------- pools ---------- */
  const wanted = [
    ...job.required_skills,
    ...job.preferred_skills.filter((s) => !job.required_skills.includes(s)),
  ]
    .map((s) => normalizeSkill(s).name)
    .filter((name, i, all) => all.indexOf(name) === i && SKILL_QUESTIONS[name]);
  const owned = wanted.filter((n) => have.has(normalizeKey(n)));
  const gaps = wanted.filter((n) => !have.has(normalizeKey(n))).slice(0, 2);
  const technical: Question[] = [];
  const bankFor = (name: string) => rotate(SKILL_QUESTIONS[name]!, round);
  const askAbout = (name: string, depth: number) => {
    const q = bankFor(name)[depth];
    return q
      ? fromBank(`skill:${name}:${q.key}`, "technical", q, job, name, !have.has(normalizeKey(name)))
      : null;
  };
  // One question per skill first, so the set spans the posting before going deeper. The first
  // skill the person lacks comes after at most three they have, so a short set still has one.
  const ownedFirst = owned.map((n) => askAbout(n, 0)).filter((q): q is Question => q !== null);
  const gapFirst = gaps.map((n) => askAbout(n, 0)).filter((q): q is Question => q !== null);
  const opening = [...ownedFirst];
  opening.splice(Math.min(3, opening.length), 0, ...gapFirst);
  technical.push(...opening);
  for (const depth of [1, 2]) {
    for (const name of owned) {
      const q = askAbout(name, depth);
      if (q) technical.push(q);
    }
  }
  // A posting that names none of the bank's skills still gets general technical practice.
  if (technical.length === 0) {
    for (const name of ["Data Structures", "SQL", "Git"]) {
      const q = bankFor(name)[0];
      if (q) technical.push(fromBank(`skill:${name}:${q.key}`, "technical", q, job, name, false));
    }
  }

  const projects: Question[] = rotate(v.projects, round).map((p) => ({
    id: `project:${p.id}`,
    kind: "project",
    text: `Tell me about ${p.name}. What was the hardest technical decision you made, and why did you make it?`,
    skill: null,
    expects: [
      ["decid", "chose", "chosen", "trade-off", "instead of", "because"],
      ["problem", "requirement", "constraint", "needed", "goal"],
      ["result", "learned", "outcome", "worked", "changed"],
    ],
    gap: false,
  }));

  const experiences: Question[] = rotate(
    [...v.experiences].sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? "")),
    round,
  ).map((e) => ({
    id: `experience:${e.id}`,
    kind: "experience",
    text: `At ${e.organization} you worked as ${e.title}. What are you proudest of from that time, and what did you personally do?`,
    skill: null,
    expects: [
      ["i ", "my "],
      ["built", "wrote", "led", "designed", "fixed", "improved", "delivered", "organi", "created"],
      ["result", "outcome", "impact", "helped", "learned", "reduced", "increased"],
    ],
    gap: false,
  }));

  const behavioral = rotate(BEHAVIORAL_QUESTIONS, round).map((q) =>
    fromBank(`behavioral:${q.key}`, "behavioral", q, job),
  );
  const motivation = rotate(MOTIVATION_QUESTIONS, round).map((q) =>
    fromBank(`motivation:${q.key}`, "motivation", q, job),
  );

  const pools: Record<Question["kind"], Question[]> = {
    technical,
    project: projects,
    experience: experiences,
    behavioral,
    motivation,
  };

  /* ---------- choose ---------- */
  const plan = PLAN[focus];
  const taken = new Set<string>();
  const chosen = new Map<Question["kind"], Question[]>();
  const take = (kind: Question["kind"], n: number) => {
    const got = chosen.get(kind) ?? [];
    for (const q of pools[kind]) {
      if (n <= 0) break;
      if (taken.has(q.id)) continue;
      taken.add(q.id);
      got.push(q);
      n--;
    }
    chosen.set(kind, got);
    return n;
  };

  let shortfall = 0;
  for (const { kind, n } of allocate(count, plan)) shortfall += take(kind, n);
  for (const kind of FALLBACK) {
    if (shortfall <= 0) break;
    shortfall = take(kind, shortfall);
  }

  // Ask in the order of the plan, then anything added by the fallback.
  const order = [
    ...plan.map((p) => p.kind),
    ...FALLBACK.filter((k) => !plan.some((p) => p.kind === k)),
  ];
  const out: Question[] = [];
  for (const kind of [...new Set(order)]) out.push(...(chosen.get(kind) ?? []));
  return out.slice(0, count).map((q) => questionSchema.parse(q));
}
