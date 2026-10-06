import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New password" };

export default async function ResetPasswordPage() {
  // Reached through the emailed recovery link, which creates a session in /auth/callback.
  await requireUser();
  return <ResetPasswordForm />;
}
