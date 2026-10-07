import { Skeleton } from "@/components/ui/skeleton";

export default function MatchesLoading() {
  return (
    <div
      className="mx-auto flex max-w-5xl flex-col gap-6"
      role="status"
      aria-label="Loading matches"
    >
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-10" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </div>
  );
}
