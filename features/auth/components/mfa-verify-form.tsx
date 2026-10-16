"use client";

import { signOutAction } from "@/features/auth/actions";
import { verifyLoginCodeAction } from "@/features/account/mfa-actions";
import { AuthCard } from "@/features/auth/components/auth-card";
import { useActionForm } from "@/hooks/use-action-form";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage, Input } from "@/components/ui/form-field";
import { verifyCodeSchema } from "@/lib/auth/mfa";

export function MfaVerifyForm({ next }: { next: string }) {
  const { form, onSubmit, pending, formError } = useActionForm(
    verifyCodeSchema,
    (values) => verifyLoginCodeAction(values, next),
    { code: "" },
  );
  const { register, formState } = form;

  return (
    <AuthCard
      title="Enter your code"
      description="Open your authenticator app and type the 6-digit code for HireOS."
      footer={
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-accent underline underline-offset-2 hover:no-underline"
          >
            Sign out and use another account
          </button>
        </form>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        <FormField id="code" label="6-digit code" error={formState.errors.code?.message}>
          {(a11y) => (
            <Input
              {...a11y}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              placeholder="123456"
              {...register("code")}
            />
          )}
        </FormField>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Checking…" : "Continue"}
        </Button>
      </form>
    </AuthCard>
  );
}
