import { SettingsLayoutSkeleton, SkeletonCard, SkeletonRows } from "@/components/ui/skeletons";

/** Loading skeleton for Linked social accounts (PP-PROF-SCR-006). */
export default function Loading() {
  return (
    <SettingsLayoutSkeleton>
      <SkeletonCard lines={2} />
      <SkeletonRows count={4} />
    </SettingsLayoutSkeleton>
  );
}
