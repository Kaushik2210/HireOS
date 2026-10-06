import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { Button } from "@/components/ui/button";
import { getCapabilities } from "@/lib/env";

// Depends on runtime environment variables.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { demoMode } = getCapabilities();

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      {demoMode ? (
        <AuthCard
          title="Demo mode"
          description="No authentication backend is configured, so there is nothing to sign in to. Add Supabase keys to enable accounts."
        >
          <Button asChild variant="primary">
            <Link href="/dashboard">Continue to the demo</Link>
          </Button>
        </AuthCard>
      ) : (
        children
      )}
    </main>
  );
}
