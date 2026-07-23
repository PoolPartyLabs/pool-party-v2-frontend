import { SettingsLayoutSkeleton, SkeletonCard } from "@/components/ui/skeletons";

/** Loading skeleton for Personal info (PP-PROF-SCR-003). */
export default function Loading() {
  return (
    <SettingsLayoutSkeleton>
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
    </SettingsLayoutSkeleton>
  );
}
