import { setRequestLocale } from "next-intl/server";
import { TrackView } from "@/components/analytics/TrackView";
import { HomeDataLoader } from "@/features/home/HomeDataLoader";
import { HomeView } from "@/features/home/HomeView";
import { buildHomeViewModel } from "@/features/home/homeViewModel";
import { loadOwnerDisplayName } from "@/lib/profile/loadInvestorProfile";
import { isMockMode, positionService } from "@/lib/services";
import { listStrategiesForHoldings } from "@/lib/strategies/strategyCatalog";
import { positionCollectedFees } from "@/mocks/data/positions";

/** PP-DASH-SCR-001 — the authenticated landing (investor dashboard). */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Holdings catalog (every status, incl. closed) so a closed owned position resolves to its real
  // strategy and is counted in the summary (POO-455); discovery still excludes closed (view model).
  // POO-704: resolve the greeting's owner displayName in parallel (real mode only; mock leaves it
  // undefined so the greeting keeps its mock profile name). A hard identity outage degrades it to
  // undefined (masked-wallet greeting), never failing the page.
  const [strategies, ownerDisplayName] = await Promise.all([
    listStrategiesForHoldings(),
    isMockMode ? Promise.resolve(undefined) : loadOwnerDisplayName(),
  ]);

  // Mock mode: SSR with mock positions. Real mode: a client loader reads the connected
  // wallet and fetches positions via getPositionsAction, then renders the same view (POO-299).
  const content = isMockMode ? (
    // POO-714 [R1]: the PP-MOCK lifetime-collected table rides in explicitly (args 4-6 keep their
    // defaults) so the mock "Total Yield" KPI models collected + available like real mode.
    <HomeView
      {...buildHomeViewModel(
        await positionService.list(),
        strategies,
        locale,
        undefined,
        undefined,
        undefined,
        positionCollectedFees,
      )}
    />
  ) : (
    <HomeDataLoader strategies={strategies} locale={locale} displayName={ownerDisplayName} />
  );

  return (
    <>
      <TrackView event="home_viewed" />
      {content}
    </>
  );
}
