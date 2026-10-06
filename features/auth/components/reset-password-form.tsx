"use client";

import { updatePasswordAction } from "@/features/auth/actions";
import { AuthCard } from "@/features/auth/components/auth-card";
import { useActionForm } from "@/hooks/use-action-form";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage, Input } from "@/components/ui/form-field";
import { PASSWORD_MIN, resetPasswordSchema } from "@/lib/auth/schemas";

export function ResetPasswordForm() {
  const { form, onSubmit, pending, formError } = useActionForm(
    resetPasswordSchema,
    updatePasswordAction,
    { password: "", confirmPassword: "" },
  );
  const { register, formState } = form;

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        <FormField
          id="password"
          label="New password"
          hint={`At least ${PASSWORD_MIN} characters, with a letter and a number.`}
          error={formState.errors.password?.message}
        >
          {(a11y) => (
            <Input
              {...a11y}
              type="password"
              autoComplete="new-password"
              autoFocus
              {...register("password")}
            />
          )}
        </FormField>
        <FormField
          id="confirmPassword"
          label="Confirm new password"
          error={formState.errors.confirmPassword?.message}
        >
          {(a11y) => (
            <Input
              {...a11y}
              type="password"
              autoComplete="new-password"
              {...register("confirmPassword")}
            />
          )}
        </FormField>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Update password"}
        </Button>
      </form>
    </AuthCard>
  );
}
