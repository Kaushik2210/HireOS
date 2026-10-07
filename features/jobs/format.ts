import type { Job } from "@/lib/jobs/schemas";

/** "INR 14,00,000 to 20,00,000 per year", "Up to USD 150,000 per year", or "" when unknown. */
export function formatJobPay(
  job: Pick<Job, "salary_min" | "salary_max" | "salary_currency" | "salary_period">,
): string {
  const {
    salary_min: min,
    salary_max: max,
    salary_currency: currency,
    salary_period: period,
  } = job;
  if ((min === null && max === null) || !currency) return "";
  // Indian digit grouping for rupees, standard grouping otherwise.
  const fmt = (n: number) =>
    new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US").format(n);
  const unit = `per ${period ?? "year"}`;
  if (min !== null && max !== null) {
    return min === max
      ? `${currency} ${fmt(min)} ${unit}`
      : `${currency} ${fmt(min)} to ${fmt(max)} ${unit}`;
  }
  if (max !== null) return `Up to ${currency} ${fmt(max)} ${unit}`;
  return `From ${currency} ${fmt(min!)} ${unit}`;
}

/** "5 Oct 2026" from a YYYY-MM-DD or ISO timestamp, or "" when missing or invalid. */
export function formatPostedDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export const SOURCE_LABELS: Record<string, string> = {
  demo: "Demo Careers Board",
  "demo-aggregator": "Demo Job Aggregator",
  manual: "Added by you",
};

export const sourceLabel = (key: string) => SOURCE_LABELS[key] ?? key;
