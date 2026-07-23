import { SettingsLayoutSkeleton, SkeletonCard, SkeletonRows } from "@/components/ui/skeletons";

/** Loading skeleton for Security & login (PP-PROF-SCR-004). */
export default function Loading() {
  return (
    <SettingsLayoutSkeleton>
      <SkeletonCard lines={2} />
      <SkeletonRows count={3} />
    </SettingsLayoutSkeleton>
  );
}
