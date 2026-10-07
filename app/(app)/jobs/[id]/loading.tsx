import { Skeleton } from "@/components/ui/skeleton";

export default function JobLoading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" role="status" aria-label="Loading job">
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
