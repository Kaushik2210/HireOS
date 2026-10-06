import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/login-form";
import { safeRedirectPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string; error?: string }>;
}) {
  const { next, reason, error } = await searchParams;
  return <LoginForm next={safeRedirectPath(next)} notice={reason ?? error} />;
}
