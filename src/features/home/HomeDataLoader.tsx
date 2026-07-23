/**
 * @id PP-DASH-SCR-001 (POO-299, POO-453)
 * @name Home data loader
 * @implements-rules-version v3
 *
 * Real-mode client boundary for the Home dashboard. Fetches the connected wallet's
 * positions (usePositions), joins them to the server-provided strategy catalog via
 * buildHomeViewModel, and renders HomeView. Shows the skeleton until positions resolve;
 * a real failure bubbles to the route error boundary (R5/R6). Used only when
 * isMockMode is false; in mock mode the route SSRs HomeView directly.
 *
 * v2 (POO-453): [R6] while a transient read failure (throttle) is retried in the background, show
 * the skeleton plus a subtle "still loading" note instead of hard-failing to the error boundary.
 * Only a non-retryable failure or exhausted retries surfaces `error`.
 * v3 (POO-453): [R7] once positions are already on screen, a background refresh that is being retried
 * (isRetrying) shows a compact, non-alarming "updating" line above the view — never a blocking
 * overlay, never shown when not retrying.
 *
 * POO-367 (rules v1): [R1] the hero value series is now the REAL per-investor value series (POO-368),
 * read wallet-scoped via useInvestorPortfolioSeries and passed into buildHomeViewModel. An empty /
 * <2-point series still degrades to the honest-empty hero (R3), so it never blocks the positions view.
 *
 * POO-430 (rules v3): [R7] the "This month" KPI is relabelled "Last 30 days" (the analytics window is
 * rolling-30d, not calendar-month).
 *
 * PP-CORE-LIB-048 (POO-990, legacy excision): the legacy `/metrics` read (useWalletMetrics) is gone.
 * Home's money KPIs — "Earned today" (24h), "Last 30 days" (30d), Invested, Total Yield, hero total —
 * read the C1 `/financials` payload (`useWalletFinancials`) EXCLUSIVELY, threaded into buildHomeViewModel
 * as `financials`. There is no per-position earnings feed, no `collectedById` cross-backend join, and
 * no wallet-level `totals` fallback: a financials read that is unavailable (not-signed-in / outage /
 * parse-fail) renders those KPIs as "not available yet", never a fabricated number and never a legacy
 * figure. The serving layer floors `earnedToday`/`feesEarned` ≥ 0 upstream, so there is no FE clamp.
 */
"use client";

import { StillLoadingNote } from "@/components/feedback/StillLoadingNote";
import { useWalletFinancials } from "@/lib/financials/useWalletFinancials";
import { useInvestorPortfolioSeries } from "@/lib/portfolio/useInvestorPortfolioSeries";
import { usePositions } from "@/lib/positions/usePositions";
import type { Strategy } from "@/lib/schemas";
import { HomeSkeleton } from "./components/HomeSkeleton";
import { HomeView } from "./HomeView";
import { buildHomeViewModel } from "./homeViewModel";

/** Public props for {@link HomeDataLoader}. */
export interface HomeDataLoaderProps {
  /** The strategy catalog, fetched server-side (wallet-independent). */
  strategies: Strategy[];
  /** Active locale (label formatting). In real mode the hero value series is honest-empty until the
   * per-investor portfolio timeseries lands (POO-556 R1 / POO-368). */
  locale: string;
  /** POO-704: the owner's PUBLIC `displayName` (`/users/me`), resolved server-side by the page and
   * forwarded to the greeting; blank/absent falls back to the masked wallet. */
  displayName?: string;
}

/** Fetches the connected wallet's positions and renders the Home dashboard. */
export function HomeDataLoader({ strategies, locale, displayName }: HomeDataLoaderProps) {
  const { positions, error, isRetrying } = usePositions();
  // [R1] The real per-investor value series (POO-368). `[]` while loading / not signed in / on a
  // failed read → the hero degrades to honest-empty (R3), so this never gates the positions render.
  const investorSeries = useInvestorPortfolioSeries();
  // PP-CORE-LIB-048: the C1 `/financials` payload — the SOLE money source for Home. Null while in mock
  // mode, not signed in, or on an unavailable read → buildHomeViewModel renders the money KPIs as "not
  // available yet" (never a fabricated number, never a legacy figure). It never gates the positions
  // render (a null financials still shows the positions list + hero series).
  const financials = useWalletFinancials();

  if (error) throw error;
  // [R6] First load still pending (or a transient failure being retried): skeleton, plus a subtle
  // note once a retry is in flight so a throttle reads as "still loading", not a broken page.
  if (!positions)
    return (
      <div className="flex flex-col gap-4">
        <HomeSkeleton />
        {isRetrying && <StillLoadingNote />}
      </div>
    );

  // PP-CORE-LIB-048: real mode (mock arg defaults to isMockMode=false). The mock-only earnings/collected
  // tables (args 4 and 7) keep their defaults (ignored in real mode); the C1 `financials` payload is
  // the sole source for the money KPIs. `investorSeries` (POO-367) drives the hero chart series.
  return (
    <div className="flex flex-col gap-3">
      {/* [R7] Positions already rendered + a background refresh being retried: a compact, polite
          "updating" line. Unobtrusive and only present while retrying (never a blocking overlay). */}
      {isRetrying && positions.length > 0 && (
        <StillLoadingNote variant="inline" messageKey="updating" />
      )}
      <HomeView
        {...buildHomeViewModel(
          positions,
          strategies,
          locale,
          undefined,
          // This IS the real-mode boundary (rendered only when !isMockMode), so `mock` is pinned false
          // explicitly — the money KPIs read the C1 `financials` payload, never the mock tables.
          false,
          investorSeries,
          undefined,
          financials,
        )}
        displayName={displayName}
      />
    </div>
  );
}
