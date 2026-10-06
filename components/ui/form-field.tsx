import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "border-border-strong bg-background placeholder:text-subtle h-9 w-full rounded-md border px-3 text-sm transition-colors",
      "focus-visible:border-accent aria-[invalid=true]:border-danger disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => React.ReactNode;
}

/** Label + control + hint/error wired together with proper ARIA. */
export function FormField({ id, label, error, hint, children }: FormFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormMessage({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "error" && "border-danger/40 text-danger",
        tone === "success" && "border-success/40 text-success",
        tone === "info" && "border-border-strong text-muted",
      )}
    >
      {children}
    </p>
  );
}
