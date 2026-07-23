import { setRequestLocale } from "next-intl/server";
import { TrackView } from "@/components/analytics/TrackView";
import { PortfolioPagedLoader } from "@/features/portfolio/PortfolioPagedLoader";
import { PortfolioView } from "@/features/portfolio/PortfolioView";
import { buildPortfolioViewModel } from "@/features/portfolio/portfolioViewModel";
import { isMockMode, positionService } from "@/lib/services";
import { listStrategiesForHoldings } from "@/lib/strategies/strategyCatalog";
import { positionCollectedFees } from "@/mocks/data/positions";

/** PP-PORT-SCR-001 — holdings & performance. */
export default async function PortfolioPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Mock mode: SSR with mock positions (the holdings catalog resolves each position's strategy so a
  // closed position is never dropped from the join, POO-455). Real mode (POO-668): a client loader
  // server-pages the connected wallet's active + closed lists with "Load more" and reads the KPIs from
  // the backend grand aggregates; the position→strategy join runs server-side in loadPortfolioPageAction,
  // so the route no longer fetches the catalog for the real path.
  const content = isMockMode ? (
    <PortfolioView
      {...buildPortfolioViewModel(
        await positionService.list(),
        await listStrategiesForHoldings(),
        locale,
        // POO-714 [R5]: args 4-5 keep their defaults; the PP-MOCK lifetime-collected table rides in
        // so the mock "Total earned" models collected + available like real mode.
        undefined,
        undefined,
        positionCollectedFees,
      )}
    />
  ) : (
    <PortfolioPagedLoader locale={locale} />
  );

  return (
    <>
      <TrackView event="portfolio_viewed" />
      {content}
    </>
  );
}
