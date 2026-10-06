import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase",
  {
    variants: {
      variant: {
        neutral: "border-border-strong text-muted",
        accent: "border-accent/40 bg-accent-soft text-accent",
        success: "border-success/40 text-success",
        warning: "border-warning/40 text-warning",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Marks a feature that is on the roadmap but not built yet. */
export function PlannedBadge({ phase }: { phase?: number }) {
  return (
    <Badge variant="neutral" title={phase ? `Planned for phase ${phase}` : "Planned"}>
      Planned
    </Badge>
  );
}
