import { Skeleton } from "@/components/ui/Skeleton";
import { SettingsLayoutSkeleton, SkeletonRows } from "@/components/ui/skeletons";

/** Loading skeleton for the Help center (PP-PROF-SCR-007). */
export default function Loading() {
  return (
    <SettingsLayoutSkeleton>
      {/* Featured support card + search */}
      <Skeleton height={64} radius="0.75rem" />
      <Skeleton height={42} radius="0.5rem" />
      {/* FAQ list */}
      <SkeletonRows count={4} />
    </SettingsLayoutSkeleton>
  );
}
