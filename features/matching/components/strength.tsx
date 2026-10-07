import { Badge } from "@/components/ui/badge";
import { MATCH_LABEL_TEXT, type MatchLabel } from "@/lib/matching/types";
import { cn } from "@/lib/utils";

export const LABEL_VARIANT: Record<MatchLabel, "success" | "accent" | "warning" | "neutral"> = {
  strong: "success",
  good: "accent",
  stretch: "warning",
  low: "neutral",
};

const BAR_COLOR: Record<MatchLabel, string> = {
  strong: "bg-success",
  good: "bg-accent",
  stretch: "bg-warning",
  low: "bg-subtle",
};

/** Compact chip for lists: the number and its band, with the meaning spelled out for readers. */
export function StrengthChip({ strength, label }: { strength: number; label: MatchLabel }) {
  return (
    <Badge
      variant={LABEL_VARIANT[label]}
      title="Application Strength: how well your verified profile lines up with this job on paper"
    >
      <span className="sr-only">Application Strength </span>
      {strength} · {MATCH_LABEL_TEXT[label]}
    </Badge>
  );
}

/** A horizontal bar for a 0-100 value. Text alternatives carry the number. */
export function ScoreBar({
  value,
  label,
  name,
  className,
}: {
  value: number;
  label: MatchLabel;
  name: string;
  className?: string;
}) {
  return (
    <div
      role="meter"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn("bg-border h-1.5 w-full overflow-hidden rounded-full", className)}
    >
      <div className={cn("h-full rounded-full", BAR_COLOR[label])} style={{ width: `${value}%` }} />
    </div>
  );
}
