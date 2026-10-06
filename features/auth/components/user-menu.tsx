import { LogOut } from "lucide-react";
import { signOutAction } from "@/features/auth/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/lib/auth/session";

export function UserMenu({ user }: { user: AuthUser }) {
  if (user.isDemo) {
    return (
      <Badge
        variant="accent"
        title="No auth backend is configured, so everything runs on demo data"
      >
        Demo mode
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {user.email && (
        <span className="text-muted hidden max-w-48 truncate text-sm lg:inline" title={user.email}>
          {user.email}
        </span>
      )}
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}
