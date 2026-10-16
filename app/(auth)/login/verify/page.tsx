import type { Metadata } from "next";
import { MfaVerifyForm } from "@/features/auth/components/mfa-verify-form";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { requireSecondStepUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Enter your code" };
export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Only someone who has passed the password step sees this; everyone else is sent on.
  await requireSecondStepUser();
  const { next } = await searchParams;
  return <MfaVerifyForm next={safeRedirectPath(next)} />;
}
