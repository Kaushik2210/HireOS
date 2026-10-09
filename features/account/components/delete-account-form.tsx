"use client";

import { deleteAccountAction } from "@/features/account/actions";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage, Input } from "@/components/ui/form-field";
import { useActionForm } from "@/hooks/use-action-form";
import { DELETE_PHRASE, deleteAccountSchema } from "@/lib/account/schemas";

export function DeleteAccountForm() {
  const { form, onSubmit, pending, formError } = useActionForm(
    deleteAccountSchema,
    (values) => deleteAccountAction(values),
    { confirm: "" },
  );
  const { register, formState } = form;

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-4">
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <FormField
        id="delete-confirm"
        label={`Type "${DELETE_PHRASE}" to confirm`}
        error={formState.errors.confirm?.message}
      >
        {(a11y) => (
          <Input {...a11y} autoComplete="off" spellCheck={false} {...register("confirm")} />
        )}
      </FormField>
      <div>
        <Button
          type="submit"
          disabled={pending}
          className="bg-danger hover:bg-danger/90 text-white"
        >
          {pending ? "Deleting…" : "Delete my account permanently"}
        </Button>
      </div>
    </form>
  );
}
