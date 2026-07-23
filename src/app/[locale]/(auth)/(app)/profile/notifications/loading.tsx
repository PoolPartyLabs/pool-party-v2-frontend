import { SettingsLayoutSkeleton, SkeletonRows } from "@/components/ui/skeletons";

/** Loading skeleton for Alerts & notifications (PP-PROF-SCR-005). */
export default function Loading() {
  return (
    <SettingsLayoutSkeleton>
      <SkeletonRows count={3} />
      <SkeletonRows count={3} />
    </SettingsLayoutSkeleton>
  );
}
