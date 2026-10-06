import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-6"
      role="status"
      aria-label="Loading dashboard"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-44 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    </div>
  );
}
