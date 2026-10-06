"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm, type DefaultValues, type FieldValues, type Path } from "react-hook-form";
import type { z } from "zod";
import type { ActionResult } from "@/lib/auth/schemas";

/**
 * Shared wiring for the auth forms: client-side Zod validation for instant feedback,
 * then a server action that validates again (the client is never trusted).
 */
export function useAuthForm<TIn extends FieldValues, TOut extends FieldValues>(
  schema: z.ZodType<TOut, TIn>,
  submit: (values: TOut) => Promise<ActionResult | void>,
  defaultValues: TIn,
) {
  const form = useForm<TIn, unknown, TOut>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues as DefaultValues<TIn>,
  });
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await submit(values);
      // Successful sign-in/up with a session redirects and never returns.
      if (!result) return;
      if (result.ok) {
        setSuccess(result.message ?? "Done.");
        return;
      }
      setFormError(result.error);
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(field as Path<TIn>, { message: messages[0] });
      }
    });
  });

  return { form, onSubmit, pending, formError, success };
}
