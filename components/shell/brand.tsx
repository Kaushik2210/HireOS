import Link from "next/link";

export function Brand() {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-2 rounded-md px-1 text-sm font-semibold tracking-tight"
    >
      <span
        aria-hidden="true"
        className="bg-accent text-accent-foreground grid size-6 place-items-center rounded font-mono text-xs font-bold"
      >
        H
      </span>
      HireOS
    </Link>
  );
}
