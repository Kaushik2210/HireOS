import { z } from "zod";

export const DELETE_PHRASE = "delete my account";

/** Shared by the form (instant feedback) and the server action (the check that counts). */
export const deleteAccountSchema = z.object({
  confirm: z
    .string()
    .trim()
    .refine((v) => v.toLowerCase() === DELETE_PHRASE, `Type "${DELETE_PHRASE}" to confirm.`),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
