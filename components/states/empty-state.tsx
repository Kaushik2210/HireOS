import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="border-border-strong flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
      <Icon className="text-subtle size-6" aria-hidden="true" />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-muted max-w-sm text-sm">{description}</p>
      {action}
    </div>
  );
}
