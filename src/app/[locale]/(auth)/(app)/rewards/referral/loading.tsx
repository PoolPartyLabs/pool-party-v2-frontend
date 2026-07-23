import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonHeading } from "@/components/ui/skeletons";

/** Loading skeleton for the Referral screen (PP-REW-SCR-003). */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonHeading back />

      <section className="grid gap-4 lg:grid-cols-3">
        {/* Left: give-get hero + how it works */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Skeleton height={220} radius="0.75rem" />
          <Skeleton height={160} radius="0.75rem" />
        </div>

        {/* Right: stats + invites */}
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Skeleton height={84} radius="0.75rem" />
            <Skeleton height={84} radius="0.75rem" />
          </div>
          <Skeleton height={240} radius="0.75rem" />
        </div>
      </section>
    </div>
  );
}
