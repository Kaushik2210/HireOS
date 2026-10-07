import { Skeleton } from "@/components/ui/skeleton";

export default function JobsLoading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" role="status" aria-label="Loading jobs">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-44" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </div>
  );
}
