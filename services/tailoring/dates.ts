const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every word the date formatter can produce. The verifier accepts exactly these. */
export const DATE_WORDS = [...MONTHS, "Present", "Issued"];

export function monthText(value: string | null | undefined): string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])/.test(value)) return "";
  return `${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
}

/** "Jun 2025 – Present", "Jun 2024 – Aug 2024", "Jun 2025", or "" when no dates exist. */
export function formatDateLine(
  start: string | null,
  end: string | null,
  current: boolean,
  prefix = "",
): string {
  const from = monthText(start);
  const to = current ? "Present" : monthText(end);
  if (from && to) return `${prefix}${from} – ${to}`;
  return `${prefix}${from || to}`.trim();
}
