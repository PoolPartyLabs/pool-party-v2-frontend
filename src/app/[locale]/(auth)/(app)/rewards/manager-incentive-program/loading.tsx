import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonHeading, SkeletonHero, SkeletonTiles } from "@/components/ui/skeletons";

/** Loading skeleton for the ManagerIncentiveProgram dashboard (PP-REW-SCR-002). */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonHeading back />

      {/* Hero: revenue this month */}
      <SkeletonHero />

      {/* Headline stats */}
      <SkeletonTiles count={4} />

      {/* Token-distribution callout */}
      <Skeleton height={88} radius="0.75rem" />

      {/* Tier ladder | revenue + goals */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Skeleton height={300} radius="0.75rem" className="lg:col-span-2" />
        <div className="flex flex-col gap-4">
          <Skeleton height={142} radius="0.75rem" />
          <Skeleton height={142} radius="0.75rem" />
        </div>
      </section>
    </div>
  );
}
