import { setRequestLocale } from "next-intl/server";
// POO-1067 (hackathon POO-1057). Self-gating: renders null unless the `activeReserve` flag is on
// AND a live vault answers on Arbitrum. Removing the entry is this import plus the two JSX uses.
import { ActiveReserveEntryCard } from "@/features/aqua/ActiveReserveEntryCard";
import { ExplorePagedLoader } from "@/features/strategies/ExplorePagedLoader";
import { StrategiesExploreScreen } from "@/features/strategies/StrategiesExploreScreen";
import { isMockMode, positionService } from "@/lib/services";
import { listStrategies } from "@/lib/strategies/strategyCatalog";

/** PP-STR-SCR-001 — the managed-strategies discovery list. */
export default async function StrategiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Real mode (POO-667): the list is server-PAGED with a visible "Load more" (v1-interface parity).
  // The v2 catalog is read one page at a time with `lifecycle=live`, so the backend excludes closed
  // from BOTH the rows and the total — the page is dense and the count honest (no phantom "Load more",
  // no empty page 0). The client loader marks the connected wallet's Owned/Invested badges (POO-299).
  if (!isMockMode) {
    return (
      <div className="flex flex-col gap-6">
        <ActiveReserveEntryCard />
        <ExplorePagedLoader />
      </div>
    );
  }

  // Mock mode is unchanged: the full mock catalog is SSR'd and filtered/sorted client-side, including
  // the type filter (no backend `type` support exists to server-page against).
  const strategies = await listStrategies();
  const positions = await positionService.list();
  const ownedIds = positions.filter((p) => p.isPoolManager).map((p) => p.strategyId);
  const investedIds = positions.filter((p) => !p.isPoolManager).map((p) => p.strategyId);
  return (
    <div className="flex flex-col gap-6">
      <ActiveReserveEntryCard />
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={ownedIds}
        investedIds={investedIds}
      />
    </div>
  );
}
