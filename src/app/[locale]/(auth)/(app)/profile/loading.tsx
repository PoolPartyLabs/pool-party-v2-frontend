import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonRows } from "@/components/ui/skeletons";

/** Loading skeleton for the Profile hub (PP-PROF-SCR-001). */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header: avatar + name */}
      <div className="flex items-center gap-3">
        <Skeleton width={56} height={56} radius="9999px" className="shrink-0" />
        <div className="flex flex-col gap-2">
          <Skeleton width={160} height={20} />
          <Skeleton width={200} height={13} />
        </div>
      </div>

      {/* Featured referral card */}
      <Skeleton height={120} radius="0.75rem" />

      {/* Menu groups */}
      <SkeletonRows count={3} />
      <SkeletonRows count={3} />
    </div>
  );
}
