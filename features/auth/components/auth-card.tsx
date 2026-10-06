import { Brand } from "@/components/shell/brand";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <Brand />
      <div className="border-border bg-surface flex flex-col gap-5 rounded-lg border p-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-muted mt-1 text-sm">{description}</p>}
        </div>
        {children}
      </div>
      {footer && <p className="text-muted text-center text-sm">{footer}</p>}
    </div>
  );
}
