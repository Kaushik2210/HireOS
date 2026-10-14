"use client";

import Link from "next/link";
import { signUpAction } from "@/features/auth/actions";
import { AuthCard } from "@/features/auth/components/auth-card";
import { useActionForm } from "@/hooks/use-action-form";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage, Input } from "@/components/ui/form-field";
import { PASSWORD_MIN, signUpSchema } from "@/lib/auth/schemas";

export function SignUpForm() {
  const { form, onSubmit, pending, formError, success } = useActionForm(
    signUpSchema,
    signUpAction,
    {
      email: "",
      password: "",
      confirmPassword: "",
    },
  );
  const { register, formState } = form;

  return (
    <AuthCard
      title="Create your account"
      description="Your resume and profile stay private to you."
      footer={
        <>
          Already registered?{" "}
          <Link
            href="/login"
            className="text-accent underline underline-offset-2 hover:no-underline"
          >
            Sign in
          </Link>
        </>
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
          <FormField
            id="password"
            label="Password"
            hint={`At least ${PASSWORD_MIN} characters, with a letter and a number.`}
            error={formState.errors.password?.message}
          >
            {(a11y) => (
              <Input
                {...a11y}
                type="password"
                autoComplete="new-password"
                {...register("password")}
              />
            )}
          </FormField>
          <FormField
            id="confirmPassword"
            label="Confirm password"
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
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
