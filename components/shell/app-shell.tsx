import { Brand } from "@/components/shell/brand";
import { CommandPaletteTrigger } from "@/components/shell/command-palette";
import { MobileNav } from "@/components/shell/mobile-nav";
import { NavList } from "@/components/shell/nav-list";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[17.5rem_1fr]">
      <a
        href="#main"
        className="focus:bg-accent focus:text-accent-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="border-border bg-surface sticky top-0 hidden h-dvh flex-col gap-6 border-r p-4 md:flex">
        <Brand />
        <NavList />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="border-border bg-background/85 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur md:px-6">
          <MobileNav />
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="ml-auto">
            <CommandPaletteTrigger />
          </div>
        </header>
        <main id="main" className="flex-1 px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
