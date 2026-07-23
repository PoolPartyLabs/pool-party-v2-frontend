import { Skeleton } from "@/components/ui/Skeleton";

/** Loading skeleton for the Cards placeholder (PP-CARD-SCR-001). */
export default function Loading() {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <Skeleton width={64} height={64} radius="9999px" />
      <Skeleton width={200} height={22} />
      <Skeleton width={280} height={14} />
      <Skeleton width={240} height={14} />
    </section>
  );
}
