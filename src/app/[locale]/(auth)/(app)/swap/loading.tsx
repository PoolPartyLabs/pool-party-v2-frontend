import { Skeleton } from "@/components/ui/Skeleton";

/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name SwapLoading
 * @implements-rules-version v1
 *
 * Loading skeleton for `/swap`: the destination row, the amount field and the CTA, in the shape the
 * screen resolves into, so the layout does not jump when it lands.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton width={180} height={28} />
        <Skeleton width={320} height={14} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Skeleton height={44} radius="0.75rem" />
        <Skeleton height={44} radius="0.75rem" />
        <Skeleton height={44} radius="0.75rem" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton width={240} height={14} />
        <Skeleton height={52} radius="0.75rem" />
      </div>
      <Skeleton height={48} radius="0.75rem" />
    </div>
  );
}
