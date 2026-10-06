import { Skeleton } from "@/components/ui/skeleton";

export default function ResumeDetailLoading() {
  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-6"
      role="status"
      aria-label="Loading analysis"
    >
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-96" />
        </div>
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
