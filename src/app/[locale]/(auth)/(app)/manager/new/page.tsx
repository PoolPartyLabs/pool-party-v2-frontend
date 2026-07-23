import { setRequestLocale } from "next-intl/server";
import { StrategyBuilderDataLoader } from "@/features/manager/StrategyBuilderDataLoader";
import { StrategyBuilderScreen } from "@/features/manager/StrategyBuilderScreen";
import { isMockMode, managerService, poolService } from "@/lib/services";

/** PP-MGR-SCR-002 — Strategy builder (Mandate → Review). Ships in v1 (not feature-flagged, murilo 2026-06-11).
 *  POO-701: real mode wraps the presentational screen in a client loader that injects the signed-write
 *  logo upload (the crop-apply stages a real https URL); mock mode renders the screen directly (the crop
 *  stays a session-local preview). */
export default async function StrategyBuilderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [pools, feePolicy] = await Promise.all([poolService.list(), managerService.getFeePolicy()]);
  return (
    <div className="flex flex-col gap-6">
      {isMockMode ? (
        <StrategyBuilderScreen pools={pools} feePolicy={feePolicy} />
      ) : (
        <StrategyBuilderDataLoader pools={pools} feePolicy={feePolicy} />
      )}
    </div>
  );
}
