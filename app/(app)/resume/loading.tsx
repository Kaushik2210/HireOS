import { Skeleton } from "@/components/ui/skeleton";

export default function ResumeLoading() {
  return (
    <div
      className="mx-auto flex max-w-4xl flex-col gap-6"
      role="status"
      aria-label="Loading resumes"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-36" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  );
}
