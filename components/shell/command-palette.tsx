"use client";

import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PlannedBadge } from "@/components/ui/badge";
import { NAV_ITEMS, PALETTE_ACTIONS } from "@/lib/nav";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground data-[selected=true]:bg-surface-hover data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-subtle";

const groupClass =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-subtle";

export function CommandPaletteTrigger() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        className="border-border bg-surface text-muted hover:bg-surface-hover hover:text-foreground flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Search or run a command</span>
        <kbd className="border-border-strong ml-2 hidden rounded border px-1.5 font-mono text-[10px] sm:inline">
          Ctrl K
        </kbd>
      </button>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Command palette"
        overlayClassName="fixed inset-0 z-50 bg-black/60"
        contentClassName="glass fixed left-1/2 top-[15vh] z-50 w-[min(92vw,34rem)] -translate-x-1/2 overflow-hidden rounded-lg shadow-2xl"
      >
        <Command.Input
          placeholder="Type a command or search…"
          className="border-border placeholder:text-subtle w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="text-muted px-3 py-6 text-center text-sm">
            No matching commands.
          </Command.Empty>

          <Command.Group heading="Go to" className={groupClass}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const live = item.status === "live";
              return (
                <Command.Item
                  key={item.id}
                  value={`go ${item.label}`}
                  disabled={!live}
                  onSelect={() => live && go(item.href)}
                  className={itemClass}
                >
                  <Icon className="text-muted size-4" aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                  {!live && <PlannedBadge phase={item.phase} />}
                </Command.Item>
              );
            })}
          </Command.Group>

          <Command.Group heading="Actions" className={groupClass}>
            {PALETTE_ACTIONS.map((action) => {
              const href = action.status === "live" ? action.href : undefined;
              return (
                <Command.Item
                  key={action.id}
                  value={`${action.label} ${action.keywords.join(" ")}`}
                  disabled={!href}
                  onSelect={() => href && go(href)}
                  className={itemClass}
                >
                  <span className="flex-1 pl-7">{action.label}</span>
                  {!href && <PlannedBadge phase={action.phase} />}
                </Command.Item>
              );
            })}
          </Command.Group>
        </Command.List>
      </Command.Dialog>
    </>
  );
}
