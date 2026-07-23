import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonHeading, SkeletonTable } from "@/components/ui/skeletons";

/** Loading skeleton for Strategies · Explore (PP-STR-SCR-001). */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonHeading />

      {/* Search + risk filter */}
      <div className="flex flex-col gap-4">
        <Skeleton height={42} radius="0.5rem" />
        <div className="flex gap-2">
          <Skeleton width={64} height={32} radius="9999px" />
          <Skeleton width={72} height={32} radius="9999px" />
          <Skeleton width={68} height={32} radius="9999px" />
          <Skeleton width={80} height={32} radius="9999px" />
        </div>
      </div>

      <Skeleton width={120} height={14} />

      {/* Mobile: cards */}
      <div className="flex flex-col gap-3 lg:hidden">
        <Skeleton height={132} radius="0.75rem" />
        <Skeleton height={132} radius="0.75rem" />
        <Skeleton height={132} radius="0.75rem" />
      </div>

      {/* Desktop: sortable table */}
      <SkeletonTable rows={6} />
    </div>
  );
}
