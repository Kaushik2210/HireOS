import { findDateSpan } from "@/services/resume/dates";

export interface Block {
  /** Non-bullet lines that open an entry: title, organisation, dates. */
  header: string[];
  bullets: string[];
  /** Longer free-text lines after the header (descriptions). */
  extra: string[];
}

export const isBullet = (line: string) => line.startsWith("• ");
export const stripBullet = (line: string) => line.replace(/^•\s+/, "").trim();
export const hasDate = (line: string) => findDateSpan(line) !== null;

/** Truncates at a word boundary so schema length caps are never hit mid-word. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Splits a header line on separators that commonly divide title, organisation and place. */
export function splitPieces(line: string): string[] {
  return line
    .split(/\s*[|·]\s*|\s+[–—-]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** A wrapped second line of a bullet, as opposed to the start of a new entry. */
const CONNECTIVE = /^(of|and|the|for|in|at|to|a|an|&|-|–|\|)$/i;

function isContinuation(line: string, previous: string): boolean {
  if (hasDate(line)) return false;
  // Wrapped text normally resumes mid-sentence, in lower case.
  if (/^[a-z]/.test(line)) return true;
  // Pipes and "(A, B)" lists mark a new entry header, never a wrapped line.
  if (/[|(]/.test(line)) return false;
  const titleCase = line.split(" ").every((w) => /^[A-Z0-9]/.test(w) || CONNECTIVE.test(w));
  return previous.length >= 70 && !/[.!?:]$/.test(previous) && line.length < 90 && !titleCase;
}

/**
 * Groups a section's lines into entries. Real resumes vary widely, so this favours
 * simple rules: an entry is header lines followed by bullets, and a new entry starts
 * when bullets end, after a blank line, or at the next dated header.
 */
export function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let current = null as Block | null;
  let lastText = "";
  let lastKind: "none" | "bullet" | "cont" | "header" = "none";
  let pendingBreak = false;

  const open = (): Block => {
    current = { header: [], bullets: [], extra: [] };
    blocks.push(current);
    return current;
  };

  for (const line of lines) {
    if (line === "") {
      pendingBreak = true;
      continue;
    }

    if (isBullet(line)) {
      const block = current ?? open();
      lastText = stripBullet(line);
      block.bullets.push(lastText);
      lastKind = "bullet";
      pendingBreak = false;
      continue;
    }

    if (
      current &&
      (lastKind === "bullet" || lastKind === "cont") &&
      isContinuation(line, lastText)
    ) {
      const block: Block = current;
      const idx = block.bullets.length - 1;
      block.bullets[idx] = `${block.bullets[idx]} ${line}`;
      lastText = line;
      lastKind = "cont";
      pendingBreak = false;
      continue;
    }

    const cur: Block | null = current;
    const startNew =
      !cur ||
      cur.bullets.length > 0 ||
      (pendingBreak && cur.header.length > 0) ||
      (cur.header.some(hasDate) && hasDate(line));

    if (!startNew && cur && cur.header.length >= 2 && line.length > 70) {
      cur.extra.push(line);
    } else {
      const block = startNew ? open() : cur!;
      if (block.header.length >= 4) block.extra.push(line);
      else block.header.push(line);
    }
    lastText = line;
    lastKind = "header";
    pendingBreak = false;
  }

  return blocks.filter((b) => b.header.length > 0 || b.bullets.length > 0);
}
