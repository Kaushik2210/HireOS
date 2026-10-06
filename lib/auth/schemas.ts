import { z } from "zod";

export const PASSWORD_MIN = 10;
// bcrypt, which Supabase uses, ignores bytes beyond 72.
export const PASSWORD_MAX = 72;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email")
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), "Include at least one letter and one number");

export const signInSchema = z.object({
  email,
  // No strength rules here: never lock out existing accounts, only require input.
  password: z.string().min(1, "Enter your password").max(PASSWORD_MAX),
});

export const signUpSchema = z
  .object({
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Result shape returned by every auth server action. Redirects never return. */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
