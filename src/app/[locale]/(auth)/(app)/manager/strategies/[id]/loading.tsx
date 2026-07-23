import { SkeletonCard, SkeletonHeading } from "@/components/ui/skeletons";

/** Loading skeleton for the manager live position (PP-MGR-SCR-005). */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonHeading back subtitle />
      <SkeletonCard lines={6} />
    </div>
  );
}
