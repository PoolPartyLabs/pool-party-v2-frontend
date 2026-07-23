/**
 * @id PP-PORT-SCR-001 (POO-299)
 * @name Portfolio skeleton
 * @implements-rules-version v1
 *
 * Loading placeholder for the Portfolio screen. Shared by the route-level loading.tsx
 * (server Suspense fallback) and the real-mode client data loader so both show the
 * same shape.
 */
import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonTable, SkeletonTiles } from "@/components/ui/skeletons";

/** The Portfolio loading skeleton. */
export function PortfolioSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Summary: hero + aside */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Skeleton height={180} radius="0.75rem" className="lg:col-span-2" />
        <Skeleton height={180} radius="0.75rem" className="hidden lg:block" />
      </section>

      {/* KPI tiles */}
      <SkeletonTiles count={4} />

      {/* Positions */}
      <section className="flex flex-col gap-3">
        <Skeleton width={150} height={20} />
        <div className="flex flex-col gap-3 lg:hidden">
          <Skeleton height={96} radius="0.75rem" />
          <Skeleton height={96} radius="0.75rem" />
        </div>
        <SkeletonTable rows={4} />
      </section>
    </div>
  );
}
