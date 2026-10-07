/**
 * Normalised keys used to recognise the same posting listed more than once. Deliberately
 * conservative: two postings merge only when company, title and location all agree after
 * cleaning, so different roles or different offices are never collapsed.
 */

const COMPANY_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "llc",
  "llp",
  "pvt",
  "private",
  "corp",
  "corporation",
  "co",
  "gmbh",
  "plc",
  "pty",
  "sa",
  "ag",
  "bv",
]);

const clean = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function companyKey(name: string): string {
  const words = clean(name).split(" ");
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

/** URL-safe slug for a company, e.g. "Helix Ledger Pvt. Ltd." becomes "helix-ledger". */
export function companySlug(name: string): string {
  return companyKey(name).replace(/ /g, "-");
}

const TITLE_NOISE = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on",
  "site",
  "fulltime",
  "full",
  "time",
]);
const TITLE_ABBREVIATIONS: Record<string, string> = {
  sr: "senior",
  jr: "junior",
  dev: "developer",
  swe: "software engineer",
};

export function titleKey(title: string): string {
  const withoutBrackets = title.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  // "Backend Engineer - Pune" and "Backend Engineer, Remote": drop the trailing location part.
  const head = withoutBrackets.split(/\s+[-–—|]\s+/)[0] ?? withoutBrackets;
  return clean(head)
    .split(" ")
    .map((w) => TITLE_ABBREVIATIONS[w] ?? w)
    .join(" ")
    .split(" ")
    .filter((w) => !TITLE_NOISE.has(w))
    .join(" ")
    .trim();
}

const CITY_ALIASES: Record<string, string> = {
  bangalore: "bengaluru",
  bombay: "mumbai",
  gurgaon: "gurugram",
  "new delhi": "delhi",
  madras: "chennai",
  calcutta: "kolkata",
  poona: "pune",
};

export function locationKey(location: string | null | undefined): string {
  if (!location) return "";
  const lower = location.toLowerCase();
  if (/\b(remote|anywhere|work from home|wfh)\b/.test(lower)) return "remote";
  const city = clean(location.split(",")[0] ?? "").trim();
  return CITY_ALIASES[city] ?? city;
}

/**
 * A stable, valid (version 5 style) UUID derived from a posting's fingerprint. Shared demo
 * jobs use it so the SQL seed and the in-memory demo store agree on ids and re-running the
 * seed is a no-op. The version and variant bits are set so the id passes strict UUID
 * validation wherever the app checks route parameters.
 */
export function idFromFingerprint(fingerprint: string): string {
  const h = fingerprint.padEnd(32, "0").slice(0, 32);
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
