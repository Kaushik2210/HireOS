import type { ProfileSnapshot } from "@/db/profile/store";
import {
  DIMENSION_IDS,
  DIMENSION_LABELS,
  answerFeedbackSchema,
  type AnswerFeedback,
  type Dimension,
  type DimensionId,
  type Question,
} from "@/lib/interview/types";
import { normalizeKey } from "@/lib/skills/catalog";
import { scanCatalogSkills } from "@/lib/skills/scan";
import { buildCandidate } from "@/services/matching/candidate";
import { verifiedSnapshot } from "@/services/profile/verified";

/** Bump when the rules or weights below change. */
export const INTERVIEW_SCORER_VERSION = 1;

/**
 * Practice scoring. It looks at how an answer is built: whether it has a shape, uses concrete
 * detail, covers what the question usually calls for, connects to the person's own verified
 * work, reads clearly, and stays honest about their profile. It cannot tell whether a
 * technical answer is correct, and it never predicts how an interviewer would react. Every
 * number comes from rules in this file and shows the inputs it used.
 */

const words = (text: string) => text.match(/[\p{L}\p{N}'+#./-]+/gu) ?? [];
const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const has = (text: string, re: RegExp) => re.test(text);

/* ---------- structure ---------- */

const STAR = [
  {
    part: "Situation",
    re: /\b(when|during|while|at my|in my|last (year|semester|summer)|my (project|team|internship|class)|we were|i was working|back (then|at))\b/i,
    tip: "set the scene: where you were and what was happening",
  },
  {
    part: "Task",
    re: /\b(my (task|role|job|goal|responsibility)|i was (responsible|asked|supposed|expected)|i (needed|had|wanted) to|the goal was|we needed|responsible for|aimed to)\b/i,
    tip: "say what you were responsible for or trying to achieve",
  },
  {
    part: "Action",
    re: /\bi\s+(?:then\s+|first\s+|also\s+|personally\s+)?(?!wanted|needed|hoped|planned|worried)(?:\w+ed|built|wrote|rewrote|led|ran|made|chose|took|found|began|taught|set up|split|broke|sent|drew|held|kept|gave|put|did)\b/i,
    tip: "describe what you yourself did, step by step",
  },
  {
    part: "Result",
    re: /\b(result|as a result|outcome|ended up|reduced|improved|increased|saved|cut|went from|delivered|shipped|which meant|so that|in the end|learned that)\b|\d+\s?%/i,
    tip: "finish with what changed because of what you did, ideally with a number",
  },
];

const TECHNICAL_SHAPE = [
  {
    part: "Definition",
    re: /\b(is a|is an|is the|means|refers to|are used|allows|lets you|works by|stands for|is when)\b/i,
    tip: "start by saying plainly what the thing is",
  },
  {
    part: "Reasoning",
    re: /\b(because|so that|therefore|which means|trade-?off|in order to|this is why|since|due to|the reason)\b/i,
    tip: "explain why it works that way, or what the trade-off is",
  },
  {
    part: "Example",
    re: /\b(for example|for instance|e\.g\.|such as|like when|in my|i used|i built|imagine|suppose|say you)\b/i,
    tip: "give a short example, ideally from something you have done",
  },
];

function structure(q: Question, answer: string): Dimension {
  const shape =
    q.kind === "technical"
      ? TECHNICAL_SHAPE
      : q.kind === "motivation"
        ? TECHNICAL_SHAPE.map((p, i) => ({ ...p, part: ["Position", "Reason", "Example"][i]! }))
        : STAR;
  const found = shape.filter((p) => has(answer, p.re));
  const missing = shape.filter((p) => !found.includes(p));
  const score = clamp((found.length / shape.length) * 100);
  return {
    id: "structure",
    label: DIMENSION_LABELS.structure,
    applicable: true,
    score,
    summary:
      missing.length === 0
        ? `Every part of the usual shape showed up (${shape.map((p) => p.part).join(", ")}).`
        : `Found ${found.length} of ${shape.length} parts: ${found.map((p) => p.part).join(", ") || "none"}.`,
    inputs: [
      { label: "Shape used", value: shape.map((p) => p.part).join(" / ") },
      { label: "Parts found", value: found.map((p) => p.part).join(", ") || "none" },
    ],
    suggestion:
      missing.length === 0
        ? null
        : `Your answer may be missing ${missing.map((p) => `a ${p.part.toLowerCase()}`).join(" and ")}. Try to ${missing[0]!.tip}.`,
  };
}

/* ---------- specificity ---------- */

const VAGUE =
  /\b(stuff|things|etc|somehow|kind of|sort of|basically|a lot of|really good|many ways|and so on|whatever)\b/gi;

function specificity(answer: string): Dimension {
  const numbers = new Set(answer.match(/\b\d[\d,.]*%?/g) ?? []);
  const skills = new Set(scanCatalogSkills(answer).map((s) => s.name));
  const proper = new Set(
    sentencesOf(answer).flatMap((sentence) =>
      words(sentence)
        .slice(1)
        .filter((w) => /^[A-Z][a-z]{2,}/.test(w) && w !== "I"),
    ),
  );
  const code = new Set(
    answer.match(/[a-z]+_[a-z_]+|\b[a-z]+[A-Z][a-zA-Z]+\b|\b\w+\(\)|`[^`]+`/g) ?? [],
  );
  const markers = numbers.size + skills.size + proper.size + code.size;
  const vague = (answer.match(VAGUE) ?? []).length;
  const score = clamp(Math.min(100, markers * 20) - Math.min(30, vague * 10));
  return {
    id: "specificity",
    label: DIMENSION_LABELS.specificity,
    applicable: true,
    score,
    summary:
      markers === 0
        ? "No numbers, tools or names showed up, so the answer stayed general."
        : `Found ${markers} concrete detail${markers === 1 ? "" : "s"}${vague > 0 ? `, and ${vague} vague phrase${vague === 1 ? "" : "s"}` : ""}.`,
    inputs: [
      { label: "Numbers", value: String(numbers.size) },
      { label: "Tools or skills named", value: [...skills].join(", ") || "none" },
      { label: "Names and terms", value: String(proper.size + code.size) },
      { label: "Vague phrases", value: String(vague) },
    ],
    suggestion:
      score >= 70
        ? null
        : 'It could help to add a number, a named tool or a specific detail, such as how big it was or how long it took, and to replace phrases like "stuff" or "kind of".',
  };
}

/* ---------- relevance ---------- */

function relevance(q: Question, answer: string): Dimension {
  if (q.expects.length === 0) {
    return {
      id: "relevance",
      label: DIMENSION_LABELS.relevance,
      applicable: false,
      score: null,
      summary: "This question has no expected topics to check against.",
      inputs: [],
      suggestion: null,
    };
  }
  const haystack = ` ${answer.toLowerCase()} `;
  const covered = q.expects.filter((group) =>
    group.some((w) => haystack.includes(w.toLowerCase())),
  );
  const score = clamp((covered.length / q.expects.length) * 100);
  const missed = q.expects.filter((g) => !covered.includes(g));
  return {
    id: "relevance",
    label: DIMENSION_LABELS.relevance,
    applicable: true,
    score,
    summary: `Touched ${covered.length} of ${q.expects.length} topics this question usually calls for.`,
    inputs: [
      { label: "Topics covered", value: `${covered.length} of ${q.expects.length}` },
      {
        label: "Topics not seen",
        value: missed.map((g) => g[0]!.trim()).join(", ") || "none",
      },
    ],
    suggestion:
      missed.length === 0
        ? null
        : `It may help to say something about ${missed
            .slice(0, 2)
            .map((g) => `"${g[0]!.trim()}"`)
            .join(
              " or ",
            )}. This is a prompt, not an answer key: use it only where it is true and relevant.`,
  };
}

/* ---------- evidence from your own work ---------- */

function evidence(q: Question, answer: string, snapshot: ProfileSnapshot): Dimension {
  if (q.kind === "technical") {
    return {
      id: "evidence",
      label: DIMENSION_LABELS.evidence,
      applicable: false,
      score: null,
      summary: "A concept question does not need an example from your own work.",
      inputs: [],
      suggestion: null,
    };
  }
  const v = verifiedSnapshot(snapshot);
  const names = [
    ...v.projects.map((p) => p.name),
    ...v.experiences.flatMap((e) => [e.organization, e.title]),
    ...v.skills.map((s) => s.name),
  ];
  const haystack = answer.toLowerCase();
  const mentioned = [
    ...new Set(names.filter((n) => n.length >= 3 && haystack.includes(n.toLowerCase()))),
  ];
  const score =
    mentioned.length >= 3 ? 100 : mentioned.length === 2 ? 70 : mentioned.length === 1 ? 45 : 10;
  return {
    id: "evidence",
    label: DIMENSION_LABELS.evidence,
    applicable: true,
    score,
    summary:
      mentioned.length === 0
        ? "The answer did not mention any project, employer or skill from your verified profile."
        : `Mentioned ${mentioned.length} item${mentioned.length === 1 ? "" : "s"} from your verified profile.`,
    inputs: [{ label: "From your profile", value: mentioned.slice(0, 6).join(", ") || "none" }],
    suggestion:
      score >= 70
        ? null
        : "It could help to tie the answer to something you have really done, such as one of your projects or roles, by name.",
  };
}

/* ---------- clarity ---------- */

const FILLER = /\b(um+|uh+|you know|basically|actually|literally|i guess|like,)\b/gi;

function clarity(answer: string): Dimension {
  const n = words(answer).length;
  const sentences = sentencesOf(answer);
  const avg = sentences.length === 0 ? 0 : n / sentences.length;
  const fillers = (answer.match(FILLER) ?? []).length;
  let base: number;
  if (n < 15) base = 10;
  else if (n < 30) base = 40;
  else if (n < 60) base = 70;
  else if (n <= 250) base = 100;
  else if (n <= 350) base = 80;
  else if (n <= 450) base = 55;
  else base = 35;
  const runOn = avg > 35 ? 15 : 0;
  const score = clamp(base - Math.min(25, fillers * 5) - runOn);
  const length = n < 60 ? "short" : n <= 250 ? "a comfortable length" : "long";
  return {
    id: "clarity",
    label: DIMENSION_LABELS.clarity,
    applicable: true,
    score,
    summary: `${n} words, ${length}${fillers > 0 ? `, with ${fillers} filler word${fillers === 1 ? "" : "s"}` : ""}.`,
    inputs: [
      { label: "Words", value: String(n) },
      { label: "Average sentence", value: `${Math.round(avg)} words` },
      { label: "Filler words", value: String(fillers) },
    ],
    suggestion:
      score >= 70
        ? null
        : n < 60
          ? "The answer may be too brief to show your thinking. Aim for roughly one to two minutes spoken, about 100 to 200 words."
          : n > 250
            ? "The answer may run long. Try to cut it to the parts that matter most."
            : "Shorter sentences and fewer filler words could make this easier to follow.",
  };
}

/* ---------- integrity ---------- */

const CLAIM =
  /\b(i|i've|i have)\s+(have\s+|also\s+|often\s+|regularly\s+)?(used|use|built|worked|work|know|developed|wrote|deployed|managed|led|ran|run|created|am (experienced|skilled|proficient|fluent))\b|\bmy experience (with|in)\b|\bexperienced (with|in)\b/i;
const HONEST =
  /\b(haven't|have not|never|not yet|no experience|not used|limited experience|only (read|studied|learned)|would learn|would need to learn|i'd learn)\b/i;

function integrity(q: Question, answer: string, snapshot: ProfileSnapshot): Dimension {
  const candidate = buildCandidate(snapshot);
  const unsupported = new Set<string>();
  for (const sentence of sentencesOf(answer)) {
    if (!CLAIM.test(sentence) || HONEST.test(sentence)) continue;
    for (const skill of scanCatalogSkills(sentence)) {
      if (
        !candidate.skills.has(normalizeKey(skill.name)) &&
        !candidate.mentionedKeys.has(normalizeKey(skill.name))
      ) {
        unsupported.add(skill.name);
      }
    }
  }
  const score = clamp(100 - unsupported.size * 35);
  const honestGap = q.gap && has(answer, HONEST);
  return {
    id: "integrity",
    label: DIMENSION_LABELS.integrity,
    applicable: true,
    score,
    summary:
      unsupported.size === 0
        ? honestGap
          ? `You were plain about not having used ${q.skill ?? "this"} yet, which is the honest way to answer.`
          : "Nothing you described using is missing from your verified profile."
        : `You describe using ${[...unsupported].join(", ")}, which ${unsupported.size === 1 ? "is" : "are"} not in your verified profile.`,
    inputs: [
      { label: "Claimed but not in your profile", value: [...unsupported].join(", ") || "none" },
      ...(q.gap
        ? [
            {
              label: "This is a skill the posting asks for and your profile lacks",
              value: q.skill ?? "",
            },
          ]
        : []),
    ],
    suggestion:
      unsupported.size > 0
        ? `If you have really used ${[...unsupported][0]}, add it to your profile first. If not, it may be safer to say what you do know and that you would learn the rest.`
        : q.gap && !honestGap
          ? `This job asks for ${q.skill}, which your profile does not show. A short honest answer ("I haven't used it yet; here is what I know and how I would learn it") usually serves you better than bluffing.`
          : null,
  };
}

/* ---------- combine ---------- */

export function scoreAnswer(
  question: Question,
  rawAnswer: string,
  snapshot: ProfileSnapshot,
): AnswerFeedback {
  const answer = rawAnswer.trim();
  const byId: Record<DimensionId, Dimension> = {
    structure: structure(question, answer),
    specificity: specificity(answer),
    relevance: relevance(question, answer),
    evidence: evidence(question, answer, snapshot),
    clarity: clarity(answer),
    integrity: integrity(question, answer, snapshot),
  };
  const dimensions = DIMENSION_IDS.map((id) => byId[id]);
  const live = dimensions.filter((d) => d.applicable && d.score !== null);
  const overall = clamp(live.reduce((t, d) => t + d.score!, 0) / Math.max(1, live.length));
  const improve = live
    .filter((d) => d.suggestion && d.score! < 70)
    .sort((a, b) => a.score! - b.score!)
    .slice(0, 3)
    .map((d) => d.suggestion!);
  return answerFeedbackSchema.parse({
    scorer_version: INTERVIEW_SCORER_VERSION,
    overall,
    band: overall >= 75 ? "strong" : overall >= 50 ? "decent" : "needs_work",
    dimensions,
    improve,
  });
}

/** The average of each dimension across a session's answers, ignoring answers where it did not apply. */
export function averageDimensions(feedbacks: readonly AnswerFeedback[]) {
  return DIMENSION_IDS.map((id) => {
    const scores = feedbacks
      .map((f) => f.dimensions.find((d) => d.id === id))
      .filter((d): d is Dimension => !!d && d.applicable && d.score !== null)
      .map((d) => d.score!);
    return {
      id,
      label: DIMENSION_LABELS[id],
      score: scores.length === 0 ? null : clamp(scores.reduce((t, s) => t + s, 0) / scores.length),
      answers: scores.length,
    };
  });
}
