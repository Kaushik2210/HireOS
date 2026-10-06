const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_WORD =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

// One token is a date or a "present" marker. Alternatives, in order of specificity:
//   1 Mon YYYY   2 MM/YYYY (or - .)   3 YYYY-MM (or /)   4 YYYY   5 present
const TOKEN = new RegExp(
  [
    `(?:(${MONTH_WORD})\\.?[ ,']*(\\d{4}))`,
    `(?:(\\d{1,2})[/.\\-](\\d{4}))`,
    `(?:(\\d{4})[/\\-](\\d{1,2})(?!\\d))`,
    `(?:\\b(\\d{4})\\b)`,
    `\\b(present|current|currently|now|ongoing|till date|to date)\\b`,
  ].join("|"),
  "gi",
);

const CONNECTOR = /^\s*(?:-|–|—|to|until|till|through)\s*$/i;

export interface MonthValue {
  /** YYYY-MM */
  month: string;
  /** True when the source only gave a year, so the month is a placeholder. */
  yearOnly: boolean;
}

export interface DateSpan {
  start: MonthValue | null;
  end: MonthValue | null;
  isCurrent: boolean;
  /** Character range of the matched date text, so callers can remove it. */
  from: number;
  to: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const validYear = (y: number) => y >= 1970 && y <= new Date().getFullYear() + 10;

interface Token {
  value: MonthValue | "present";
  from: number;
  to: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    let value: Token["value"] | null = null;
    if (m[1] && m[2]) {
      const month = MONTH_NAMES[m[1].toLowerCase()];
      const year = Number(m[2]);
      if (month && validYear(year)) value = { month: `${year}-${pad(month)}`, yearOnly: false };
    } else if (m[3] && m[4]) {
      const month = Number(m[3]);
      const year = Number(m[4]);
      if (month >= 1 && month <= 12 && validYear(year)) {
        value = { month: `${year}-${pad(month)}`, yearOnly: false };
      }
    } else if (m[5] && m[6]) {
      const year = Number(m[5]);
      const month = Number(m[6]);
      if (month >= 1 && month <= 12 && validYear(year)) {
        value = { month: `${year}-${pad(month)}`, yearOnly: false };
      }
    } else if (m[7]) {
      const year = Number(m[7]);
      if (validYear(year)) value = { month: `${year}-01`, yearOnly: true };
    } else if (m[8]) {
      value = "present";
    }
    if (value) tokens.push({ value, from: m.index, to: m.index + m[0].length });
  }
  return tokens;
}

/**
 * Finds the first date range ("Jan 2024 - Present", "2021 - 2024", "05/2025 to 07/2025")
 * or, failing that, the first single date in the text.
 * A year with no month ends in December when it closes a range, so "2021 - 2024" reads as
 * Jan 2021 to Dec 2024. These are placeholders and are flagged with `yearOnly`.
 */
export function findDateSpan(text: string): DateSpan | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1]!;
    if (a.value === "present") continue;
    if (!CONNECTOR.test(text.slice(a.to, b.from))) continue;

    if (b.value === "present") {
      return { start: a.value, end: null, isCurrent: true, from: a.from, to: b.to };
    }
    const end = b.value.yearOnly
      ? { month: `${b.value.month.slice(0, 4)}-12`, yearOnly: true }
      : b.value;
    return { start: a.value, end, isCurrent: false, from: a.from, to: b.to };
  }

  const first = tokens.find((t) => t.value !== "present");
  if (!first || first.value === "present") return null;
  return { start: first.value, end: null, isCurrent: false, from: first.from, to: first.to };
}

/** Removes the matched date text and tidy leftover separators from a header line. */
export function stripSpan(text: string, span: DateSpan): string {
  return `${text.slice(0, span.from)} ${text.slice(span.to)}`
    .replace(/[()[\]]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s|,\-–—·•:]+|[\s|,\-–—·•:]+$/g, "")
    .trim();
}
