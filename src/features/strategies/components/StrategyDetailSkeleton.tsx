/**
 * @id PP-STR-SCR-002 (POO-300)
 * @name Strategy detail skeleton
 * @implements-rules-version v1
 *
 * Loading placeholder for the Strategy detail screen. Shared by the route-level
 * loading.tsx (server Suspense fallback) and the real-mode client data loader so
 * both show the same shape.
 */
import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonCard, SkeletonHeading } from "@/components/ui/skeletons";

/** The Strategy detail loading skeleton. */
export function StrategyDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonHeading back subtitle={false} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Skeleton height={160} radius="0.75rem" />
          <SkeletonCard lines={3} />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton height={84} radius="0.75rem" />
            <Skeleton height={84} radius="0.75rem" />
            <Skeleton height={84} radius="0.75rem" />
            <Skeleton height={84} radius="0.75rem" />
          </div>
          <SkeletonCard lines={4} />
        </div>

        {/* Desktop sticky rail */}
        <Skeleton height={320} radius="0.75rem" className="hidden lg:block" />
      </div>
    </div>
  );
}
