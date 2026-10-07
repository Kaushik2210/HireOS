export interface Salary {
  min: number | null;
  max: number | null;
  currency: string;
  period: "year" | "month";
}

const CURRENCY_MARKERS: [RegExp, string][] = [
  [/₹|\binr\b|\brs\.?(?=\s*\d)/i, "INR"],
  [/\$|\busd\b/i, "USD"],
  [/€|\beur\b/i, "EUR"],
  [/£|\bgbp\b/i, "GBP"],
];

const UNIT = "(?:k|l|lpa|lakhs?|lacs?|cr|crores?|m|mn|million)?";
const NUM = "\\d[\\d,]*(?:\\.\\d+)?";
const CUR = "(?:₹|\\$|€|£|inr|usd|eur|gbp|rs\\.?)?";

// 1 currency, 2 number, 3 unit, 4 currency, 5 number, 6 unit
const RANGE = new RegExp(
  `${CUR}\\s*(${NUM})\\s*(${UNIT})\\s*(?:-|–|—|to)\\s*${CUR}\\s*(${NUM})\\s*(${UNIT})`,
  "gi",
);
const SINGLE = new RegExp(
  `(?:up to|upto|from|starting at)?\\s*${CUR}\\s*(${NUM})\\s*(${UNIT})`,
  "gi",
);

function multiplier(unit: string): number {
  const u = unit.toLowerCase();
  if (u === "k") return 1_000;
  if (u === "l" || u === "lpa" || u.startsWith("lakh") || u.startsWith("lac")) return 100_000;
  if (u === "cr" || u.startsWith("crore")) return 10_000_000;
  if (u === "m" || u === "mn" || u === "million") return 1_000_000;
  return 1;
}

const toNumber = (raw: string) => Number(raw.replace(/,/g, ""));

function detectCurrency(text: string): string | null {
  for (const [pattern, code] of CURRENCY_MARKERS) if (pattern.test(text)) return code;
  if (/\blpa\b|\blakhs?\b/i.test(text)) return "INR";
  return null;
}

/**
 * Reads a pay range from free text: "₹12,00,000 - ₹18,00,000", "12-18 LPA", "$90k - $120k",
 * "USD 90,000 to 120,000 per year", "₹40,000 per month". A currency marker (or LPA) is
 * required, so ranges of years ("3-5 years") are never mistaken for pay. Returns null when
 * nothing credible is found.
 */
export function parseSalary(text: string): Salary | null {
  const window = text.slice(0, 6000);
  const period: Salary["period"] = /per month|\/\s*month|monthly|a month|\bpm\b/i.test(window)
    ? "month"
    : "year";

  // Try every candidate in order: an early "0-1 years" must not hide a real pay line later on.
  for (const range of window.matchAll(RANGE)) {
    const context = window.slice(Math.max(0, range.index - 20), range.index + range[0].length + 20);
    const currency = detectCurrency(context);
    if (!currency) continue;
    const unitA = range[2] || range[4] || "";
    const unitB = range[4] || range[2] || "";
    const a = toNumber(range[1]!) * multiplier(unitA);
    const b = toNumber(range[3]!) * multiplier(unitB);
    const [min, max] = a <= b ? [a, b] : [b, a];
    if (plausible(min, period) && plausible(max, period)) {
      return { min: Math.round(min), max: Math.round(max), currency, period };
    }
  }

  for (const single of window.matchAll(SINGLE)) {
    const context = window.slice(
      Math.max(0, single.index - 10),
      single.index + single[0].length + 15,
    );
    const currency = detectCurrency(context);
    if (!currency) continue;
    if (!(single[2] || /[₹$€£]|\b(?:inr|usd|eur|gbp)\b/i.test(context))) continue;
    const value = Math.round(toNumber(single[1]!) * multiplier(single[2] ?? ""));
    if (plausible(value, period)) {
      const upTo = /up to|upto/i.test(single[0]);
      return { min: upTo ? null : value, max: value, currency, period };
    }
  }
  return null;
}

/** Guards against stray numbers: pay figures sit in a believable band. */
function plausible(value: number, period: Salary["period"]): boolean {
  return period === "year"
    ? value >= 10_000 && value <= 500_000_000
    : value >= 1_000 && value <= 50_000_000;
}
