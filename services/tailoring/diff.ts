export interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

/** Longest inputs compared; beyond this the diff degrades to "all removed, all added". */
const MAX_LINES = 600;

/** A line-by-line comparison using the longest common subsequence. */
export function lineDiff(before: string[], after: string[]): DiffLine[] {
  if (before.length > MAX_LINES || after.length > MAX_LINES) {
    return [
      ...before.map((text) => ({ type: "removed" as const, text })),
      ...after.map((text) => ({ type: "added" as const, text })),
    ];
  }
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ type: "same", text: before[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ type: "removed", text: before[i++]! });
    } else {
      out.push({ type: "added", text: after[j++]! });
    }
  }
  while (i < n) out.push({ type: "removed", text: before[i++]! });
  while (j < m) out.push({ type: "added", text: after[j++]! });
  return out;
}

export const diffCounts = (lines: DiffLine[]) => ({
  added: lines.filter((l) => l.type === "added").length,
  removed: lines.filter((l) => l.type === "removed").length,
});
