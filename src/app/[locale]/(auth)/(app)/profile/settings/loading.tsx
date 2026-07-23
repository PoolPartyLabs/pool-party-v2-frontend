import { SettingsLayoutSkeleton, SkeletonRows } from "@/components/ui/skeletons";

/** Loading skeleton for App settings (PP-PROF-SCR-008). */
export default function Loading() {
  return (
    <SettingsLayoutSkeleton>
      <SkeletonRows count={4} />
    </SettingsLayoutSkeleton>
  );
}
