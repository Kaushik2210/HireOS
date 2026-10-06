"use client";

import Link from "next/link";
import { signInAction } from "@/features/auth/actions";
import { AuthCard } from "@/features/auth/components/auth-card";
import { useActionForm } from "@/hooks/use-action-form";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage, Input } from "@/components/ui/form-field";
import { signInSchema } from "@/lib/auth/schemas";

const NOTICES: Record<string, string> = {
  expired: "Your session expired. Sign in again to continue.",
  callback: "That link is invalid or has expired. Request a new one and try again.",
};

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const { form, onSubmit, pending, formError } = useActionForm(
    signInSchema,
    (values) => signInAction(values, next),
    { email: "", password: "" },
  );
  const { register, formState } = form;

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back to HireOS."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {notice && NOTICES[notice] && <FormMessage tone="info">{NOTICES[notice]}</FormMessage>}
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        <FormField id="email" label="Email" error={formState.errors.email?.message}>
          {(a11y) => (
            <Input {...a11y} type="email" autoComplete="email" autoFocus {...register("email")} />
          )}
        </FormField>
        <FormField id="password" label="Password" error={formState.errors.password?.message}>
          {(a11y) => (
            <Input
              {...a11y}
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
          )}
        </FormField>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-muted hover:text-foreground text-xs">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
