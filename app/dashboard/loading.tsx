import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading skeleton for the dashboard.
 * Shows a header placeholder + card grid while the page loads.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* PageHeader skeleton */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton width="80px" height="12px" />
          <Skeleton width="240px" height="24px" />
          <Skeleton width="320px" height="16px" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton width="36px" height="36px" radius="var(--radius-md)" />
          <Skeleton width="100px" height="36px" radius="var(--radius-md)" />
        </div>
      </div>

      {/* Stat tiles skeleton */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5"
          >
            <Skeleton width="100px" height="14px" />
            <Skeleton width="80px" height="28px" />
            <Skeleton width="140px" height="12px" />
          </div>
        ))}
      </div>

      {/* Content cards skeleton */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="col-span-2 flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
          <Skeleton width="180px" height="18px" />
          <Skeleton width="100%" height="200px" radius="var(--radius-md)" />
        </div>
        <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
          <Skeleton width="140px" height="18px" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton width="32px" height="32px" radius="var(--radius-full)" />
                <div className="flex flex-1 flex-col gap-1">
                  <Skeleton width="120px" height="14px" />
                  <Skeleton width="80px" height="12px" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}