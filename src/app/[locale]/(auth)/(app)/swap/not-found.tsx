/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name SwapNotFound
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * What a `/swap` deep link renders while the `swapScreen` flag is off ([R1]).
 *
 * The first `not-found.tsx` in the tree, and it earns its place: `requireFeature` calls `notFound()`,
 * and without a boundary here that lands on Next's own unstyled 404, outside the app chrome and in
 * English regardless of locale. A user who followed a shared link deserves to be told, in their own
 * language, that the area is not open yet rather than that the app is broken.
 */
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui/EmptyState";

export default function SwapNotFound() {
  const t = useTranslations("swap");

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState title={t("notFound.title")} description={t("notFound.body")} />
    </div>
  );
}
