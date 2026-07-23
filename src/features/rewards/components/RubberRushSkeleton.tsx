/**
 * @id PP-REW-SCR-001 (POO-209)
 * @name Rubber Rush skeleton
 * @implements-rules-version v1
 *
 * Loading placeholder for the Rubber Rush dashboard. Shared by the route-level
 * loading.tsx (server Suspense fallback) and the client data loader (real-mode
 * fetch) so both show the same shape.
 */
import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonHeading, SkeletonTiles } from "@/components/ui/skeletons";

/** The Rubber Rush loading skeleton. */
export function RubberRushSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonHeading back />

      {/* Hero: balance + actions */}
      <Skeleton height={200} radius="0.75rem" />

      {/* Tier progression */}
      <Skeleton height={120} radius="0.75rem" />

      {/* Headline stats */}
      <SkeletonTiles count={4} />

      {/* Streak / referral cards */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Skeleton height={180} radius="0.75rem" />
        <Skeleton height={180} radius="0.75rem" />
        <Skeleton height={180} radius="0.75rem" />
      </section>
    </div>
  );
}
