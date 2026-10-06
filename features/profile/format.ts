const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-08" becomes "Aug 2024". Returns "" for anything that is not a valid month. */
export function formatMonth(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return "";
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** "Aug 2024 to Jun 2026", "Aug 2024 to present", or a single month. */
export function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
  isCurrent: boolean,
): string {
  const from = formatMonth(start);
  const to = isCurrent ? "present" : formatMonth(end);
  if (from && to) return from === to ? from : `${from} to ${to}`;
  return from || to;
}

export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string,
  period: string,
): string {
  if (min === null && max === null) return "";
  const fmt = (n: number) => new Intl.NumberFormat("en-IN").format(n);
  const range = min !== null && max !== null ? `${fmt(min)} to ${fmt(max)}` : fmt((min ?? max)!);
  return `${currency} ${range} per ${period}`;
}

export const LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  full_time: "Full-time",
  internship: "Internship",
  contract: "Contract",
  part_time: "Part-time",
  student: "Student",
  entry: "Entry level",
  junior: "Junior",
  mid: "Mid level",
  senior: "Senior",
  lead: "Lead",
  work: "Work",
  leadership: "Leadership",
  volunteer: "Volunteer",
  award: "Award",
  competition: "Competition",
  publication: "Publication",
  other: "Other",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
};

export const label = (value: string | null | undefined): string =>
  value ? (LABELS[value] ?? value) : "";
