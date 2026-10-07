import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import { normalizeKey } from "@/lib/skills/catalog";
import { scanCatalogSkills } from "@/lib/skills/scan";
import type {
  BlockedClaim,
  Claim,
  LetterDoc,
  ResumeDoc,
  SourceRef,
  Verification,
} from "@/lib/tailoring/types";
import { verifiedSnapshot } from "@/services/profile/verified";
import { DATE_WORDS } from "@/services/tailoring/dates";
import { allResumeClaims } from "@/services/tailoring/render";

/**
 * The integrity check. It does not trust the builder: it re-reads every claim against the
 * user's verified profile and blocks anything it cannot trace to a stored item.
 *
 *   1. every claim names the item and fields it came from, and the user owns that item;
 *   2. the claim's words are those fields' words (nothing added, nothing rephrased);
 *   3. every skill, tool or technology named appears in the source item;
 *   4. every number appears in the source item.
 */

type Item = Record<string, unknown> & { id: string };

function lookup(snapshot: ProfileSnapshot): Map<string, Item> {
  const v = verifiedSnapshot(snapshot);
  const map = new Map<string, Item>();
  const add = (entity: string, items: Item[]) => {
    for (const item of items) map.set(`${entity}:${item.id}`, item);
  };
  add("education", v.education as unknown as Item[]);
  add("experiences", v.experiences as unknown as Item[]);
  add("projects", v.projects as unknown as Item[]);
  add("certifications", v.certifications as unknown as Item[]);
  add("skills", v.skills as unknown as Item[]);
  add("achievements", v.achievements as unknown as Item[]);
  // The profile record is the user's own and is never a pending import.
  if (v.profile) map.set(`profiles:${v.profile.id}`, v.profile as unknown as Item);
  return map;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function fieldValue(item: Item, field: string): string | null {
  const m = /^highlights\.(\d+)$/.exec(field);
  if (m) {
    const list = item.highlights;
    const text = Array.isArray(list) ? list[Number(m[1])] : undefined;
    return typeof text === "string" ? text : null;
  }
  const value = item[field];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string").join(", ");
  return null;
}

/** All free text an item holds, for checking that named skills and numbers really appear. */
function corpusOf(item: Item): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(item)) {
    if (key === "id" || key === "created_at" || key === "updated_at") continue;
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) parts.push(...value.filter((x) => typeof x === "string"));
  }
  return parts.join("\n");
}

const skillKeysIn = (text: string) =>
  new Set(scanCatalogSkills(text).map((s) => normalizeKey(s.name)));
const numbersIn = (text: string) => new Set(text.match(/\d+(?:[.,]\d+)*/g) ?? []);

const DATE_FIELDS = new Set([
  "start_date",
  "end_date",
  "issued_date",
  "expires_date",
  "is_current",
]);
const GLUE = /\b(?:in|at)\b/gi;
const PUNCT_ONLY = /^[\s,;:()·|–—.-]*$/;

/** True when `text` is nothing but the given values joined by punctuation or "in"/"at". */
function composedOf(text: string, values: string[]): boolean {
  let rest = norm(text);
  for (const value of [...values].sort((a, b) => b.length - a.length)) {
    const v = norm(value);
    if (v) rest = rest.split(v).join(" ");
  }
  return PUNCT_ONLY.test(rest.replace(GLUE, " "));
}

function checkClaim(claim: Claim, items: Map<string, Item>): string | null {
  if (claim.refs.length === 0) return "It names no source in your profile.";

  const corpus: string[] = [];
  const values: string[] = [];
  const years = new Set<string>();
  let usesDates = false;

  for (const ref of claim.refs) {
    const item = items.get(`${ref.entity}:${ref.id}`);
    if (!item) return "Its source is not one of your verified profile items.";
    corpus.push(corpusOf(item));
    for (const field of ref.fields) {
      if (DATE_FIELDS.has(field)) {
        usesDates = true;
        const v = item[field];
        if (typeof v === "string") years.add(v.slice(0, 4));
        continue;
      }
      const value = fieldValue(item, field);
      if (value === null || value.trim() === "") {
        return `The field "${field}" is empty or missing on its source.`;
      }
      values.push(value);
    }
  }

  const exactKinds: Claim["kind"][] = ["headline", "summary", "skill", "bullet"];
  if (exactKinds.includes(claim.kind)) {
    if (values.length !== 1 || norm(claim.text) !== norm(values[0]!)) {
      return "Its wording does not match the field it was taken from.";
    }
  } else if (claim.kind === "heading") {
    if (!composedOf(claim.text, values)) {
      return "Its wording does not match the fields it was taken from.";
    }
  } else if (claim.kind === "detail") {
    // Dates are written as months and years; everything else must be a stored value.
    let rest = norm(claim.text);
    for (const value of [...values].sort((a, b) => b.length - a.length)) {
      rest = rest.split(norm(value)).join(" ");
    }
    for (const word of DATE_WORDS) rest = rest.replace(new RegExp(`\\b${word}\\b`, "g"), " ");
    const found = rest.match(/\b\d{4}\b/g) ?? [];
    if (found.length > 0 && !usesDates) return "It states a date its source does not have.";
    for (const y of found) {
      if (!years.has(y)) return `It states the year ${y}, which its source does not have.`;
    }
    rest = rest.replace(/\b\d{4}\b/g, " ");
    if (!PUNCT_ONLY.test(rest)) return "It contains words that are not in its source.";
  }

  const source = corpus.join("\n");
  const have = skillKeysIn(source);
  for (const found of scanCatalogSkills(claim.text)) {
    if (!have.has(normalizeKey(found.name))) {
      return `It names ${found.name}, which is not in its source item.`;
    }
  }
  const haveNumbers = numbersIn(source);
  for (const n of numbersIn(claim.text)) {
    if (!haveNumbers.has(n) && !years.has(n)) {
      return `It contains the number ${n}, which is not in its source item.`;
    }
  }
  return null;
}

function toVerification(checked: number, blocked: BlockedClaim[]): Verification {
  return { ok: blocked.length === 0, checked, blocked };
}

export function verifyResume(doc: ResumeDoc, snapshot: ProfileSnapshot): Verification {
  const items = lookup(snapshot);
  const claims = allResumeClaims(doc);
  const blocked: BlockedClaim[] = [];
  for (const claim of claims) {
    const reason = checkClaim(claim, items);
    if (reason) blocked.push({ claim_id: claim.id, text: claim.text, reason });
  }
  return toVerification(claims.length, blocked);
}

/** Words allowed through because they come from the posting itself. */
function jobSpans(job: Job): string[] {
  return [job.title, job.company_name].filter(Boolean);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Checks letter text, generated or edited, against the whole verified profile: any skill
 * named must be one the person has, and any number must appear in their profile. The role
 * title and company come from the posting and are allowed as written.
 */
export function verifyLetterText(
  text: string,
  snapshot: ProfileSnapshot,
  job: Job,
): { checked: number; blocked: BlockedClaim[] } {
  const items = lookup(snapshot);
  const profileText = [...items.values()].map(corpusOf).join("\n");
  const haveSkills = skillKeysIn(profileText);
  const haveNumbers = numbersIn(profileText);

  const blocked: BlockedClaim[] = [];
  const list = sentences(text);
  list.forEach((sentence, index) => {
    let rest = sentence;
    for (const span of jobSpans(job).sort((a, b) => b.length - a.length)) {
      rest = rest.split(span).join(" ");
    }
    for (const found of scanCatalogSkills(rest)) {
      if (!haveSkills.has(normalizeKey(found.name))) {
        blocked.push({
          claim_id: `sentence:${index}`,
          text: sentence,
          reason: `It names ${found.name}, which is not in your verified profile.`,
        });
        return;
      }
    }
    for (const n of numbersIn(rest)) {
      if (!haveNumbers.has(n)) {
        blocked.push({
          claim_id: `sentence:${index}`,
          text: sentence,
          reason: `It contains the number ${n}, which is not in your verified profile.`,
        });
        return;
      }
    }
  });
  return { checked: list.length, blocked };
}

/** A letter passes when its generated claims trace to verified items and its final text is grounded. */
export function verifyLetter(doc: LetterDoc, snapshot: ProfileSnapshot, job: Job): Verification {
  const items = lookup(snapshot);
  const blocked: BlockedClaim[] = [];
  let checked = 0;

  if (!doc.edited) {
    for (const claim of doc.paragraphs.flat()) {
      checked++;
      for (const ref of claim.refs as SourceRef[]) {
        const ok = ref.entity === "jobs" ? ref.id === job.id : items.has(`${ref.entity}:${ref.id}`);
        if (!ok) {
          blocked.push({
            claim_id: claim.id,
            text: claim.text,
            reason: "Its source is not one of your verified profile items.",
          });
          break;
        }
      }
    }
  }

  const textual = verifyLetterText(doc.text, snapshot, job);
  return toVerification(Math.max(checked, textual.checked), [...blocked, ...textual.blocked]);
}
