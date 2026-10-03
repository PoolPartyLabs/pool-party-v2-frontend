import { setRequestLocale } from "next-intl/server";
import { BuilderRouteSwitch } from "@/features/manager/fund/BuilderRouteSwitch";
import { StrategyBuilderDataLoader } from "@/features/manager/StrategyBuilderDataLoader";
import { StrategyBuilderScreen } from "@/features/manager/StrategyBuilderScreen";
import { isMockMode, managerService, poolService } from "@/lib/services";

/** PP-MGR-SCR-002 — Strategy builder (Mandate → Review). Ships in v1 (not feature-flagged, murilo 2026-06-11).
 *  POO-701: real mode wraps the presentational screen in a client loader that injects the signed-write
 *  logo upload (the crop-apply stages a real https URL); mock mode renders the screen directly (the crop
 *  stays a session-local preview).
 *  POO-2120 [R6]: the V1 element above is now handed to {@link BuilderRouteSwitch}, which renders it or
 *  the fund-contracts (V2) builder according to the `fundContracts` flag and the manager's chosen
 *  contract family. The server reads and the mock-vs-real decision are UNCHANGED, and with the flag off
 *  the switch renders the V1 element with nothing added around it: this route is never feature-gated. */
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
      <BuilderRouteSwitch
        v1={
          isMockMode ? (
            <StrategyBuilderScreen pools={pools} feePolicy={feePolicy} />
          ) : (
            <StrategyBuilderDataLoader pools={pools} feePolicy={feePolicy} />
          )
        }
      />
    </div>
  );
}
