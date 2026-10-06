import { AppShell } from "@/components/shell/app-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { requireUser } from "@/lib/auth/session";

// Every page in the app group is gated here, in addition to the proxy.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell userMenu={<UserMenu user={user} />}>{children}</AppShell>;
}
