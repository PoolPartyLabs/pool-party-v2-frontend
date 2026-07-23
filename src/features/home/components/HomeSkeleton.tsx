/**
 * @id PP-DASH-SCR-001 (POO-299)
 * @name Home skeleton
 * @implements-rules-version v1
 *
 * Loading placeholder for the Home dashboard. Shared by the route-level loading.tsx
 * (server Suspense fallback) and the real-mode client data loader so both show the
 * same shape.
 */
import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonTable, SkeletonTiles } from "@/components/ui/skeletons";

/** The Home dashboard loading skeleton. */
export function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {/* Hero + aside */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
        <Skeleton height={188} radius="0.75rem" />
        <Skeleton height={188} radius="0.75rem" className="hidden lg:block" />
      </section>

      {/* KPI tiles */}
      <SkeletonTiles count={4} />

      {/* Your positions */}
      <section className="flex flex-col gap-3">
        <Skeleton width={160} height={20} />
        <div className="flex flex-col gap-3 lg:hidden">
          <Skeleton height={96} radius="0.75rem" />
          <Skeleton height={96} radius="0.75rem" />
        </div>
        <SkeletonTable rows={3} />
      </section>

      {/* Discover */}
      <section className="flex flex-col gap-3">
        <Skeleton width={200} height={20} />
        <SkeletonTable rows={3} />
      </section>
    </div>
  );
}
