import { Skeleton } from "@/components/ui";

export default function TutorsLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading tutors">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="tl-card mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-11" />
        ))}
      </div>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="tl-card p-5">
            <div className="flex gap-3">
              <Skeleton className="h-13 w-13 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <Skeleton className="mt-4 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-2/3" />
            <Skeleton className="mt-5 h-9 w-28" />
          </li>
        ))}
      </ul>
    </div>
  );
}
