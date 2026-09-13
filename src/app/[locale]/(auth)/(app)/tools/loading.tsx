import { Skeleton } from "@/components/ui/Skeleton";

/** Loading skeleton for the Tools page (PP-TOOLS-SCR-001): heading, the form card, the report slot. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton width={140} height={28} />
      {/* The form card at the top of the single column. */}
      <Skeleton height={200} radius="0.75rem" />
      {/* The full-width report slot beneath it. */}
      <Skeleton height={320} radius="0.75rem" />
    </div>
  );
}
