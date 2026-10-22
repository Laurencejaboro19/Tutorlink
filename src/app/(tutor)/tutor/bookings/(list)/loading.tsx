import { Skeleton } from "@/components/ui";

export default function BookingsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading sessions">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 flex gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>
      <ul className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="tl-card p-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-3 h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </li>
        ))}
      </ul>
    </div>
  );
}
