import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-6"
      role="status"
      aria-label="Loading profile"
    >
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
