import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonRows } from "@/components/ui/skeletons";

/** Loading skeleton for the Deposit on-ramp (PP-DEP-SCR-001). */
export default function Loading() {
  return (
    <div className="lg:grid lg:grid-cols-[1fr_19rem] lg:items-start lg:gap-8">
      <div className="flex flex-col gap-6">
        <Skeleton width={140} height={28} />
        {/* Amount display */}
        <Skeleton height={120} radius="0.75rem" />
        {/* Funding methods */}
        <SkeletonRows count={3} />
      </div>
      {/* Desktop aside */}
      <Skeleton height={260} radius="0.75rem" className="mt-6 hidden lg:mt-0 lg:block" />
    </div>
  );
}
