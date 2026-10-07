"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlannedBadge } from "@/components/ui/badge";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

const itemClass = "flex h-9 items-center gap-3 rounded-md px-3 text-sm";

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          if (item.status === "planned") {
            return (
              <li key={item.id}>
                <span
                  aria-disabled="true"
                  className={cn(itemClass, "text-subtle cursor-not-allowed")}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1 truncate">{item.label}</span>
                  <PlannedBadge phase={item.phase} />
                </span>
              </li>
            );
          }
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                // Every page carries this sidebar; prefetching all of it floods the server.
                prefetch={false}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  itemClass,
                  "transition-colors",
                  active
                    ? "bg-accent-soft text-foreground"
                    : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("size-4 shrink-0", active && "text-accent")}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
