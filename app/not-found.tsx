import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-subtle font-mono text-xs">404</p>
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-muted text-sm">That page does not exist, or has not been built yet.</p>
        <Button asChild variant="primary">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
