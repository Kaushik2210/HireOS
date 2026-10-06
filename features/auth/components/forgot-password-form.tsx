"use client";

import Link from "next/link";
import { requestPasswordResetAction } from "@/features/auth/actions";
import { AuthCard } from "@/features/auth/components/auth-card";
import { useActionForm } from "@/hooks/use-action-form";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage, Input } from "@/components/ui/form-field";
import { forgotPasswordSchema } from "@/lib/auth/schemas";

export function ForgotPasswordForm() {
  const { form, onSubmit, pending, formError, success } = useActionForm(
    forgotPasswordSchema,
    requestPasswordResetAction,
    { email: "" },
  );
  const { register, formState } = form;

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we will send a reset link."
      footer={
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {success ? (
        <FormMessage tone="success">{success}</FormMessage>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {formError && <FormMessage tone="error">{formError}</FormMessage>}
          <FormField id="email" label="Email" error={formState.errors.email?.message}>
            {(a11y) => (
              <Input {...a11y} type="email" autoComplete="email" autoFocus {...register("email")} />
            )}
          </FormField>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
