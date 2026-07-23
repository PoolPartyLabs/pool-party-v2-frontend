/**
 * @id PP-DASH-SCR-001 (POO-299, POO-556, POO-990)
 * @name buildHomeViewModel
 * @implements-rules-version v1
 *
 * Pure builder for the Home dashboard props: joins the investor's positions to their
 * strategies, computes the portfolio summary, and selects discovery strategies. Shared
 * by the mock-SSR page path and the real-mode client data loader so the computation
 * lives in one place (R3).
 *
 * POO-556 (rules v1): [R1] the hero value series is fabricated ONLY in mock mode (design harness);
 * real mode renders an honest-empty series (the same graceful-empty posture the chart uses for a
 * <2-point series) when no real per-investor series exists.
 *
 * POO-367 (rules v1): [R1] real mode now plots the real per-investor value series (POO-368) when the
 * caller passes it; [R3] an empty/insufficient series still degrades to honest-empty; [R4] the daily
 * grain leaves the hourly 1D period empty (see {@link buildInvestorPortfolioSeries}).
 *
 * POO-671 (rules v1): the Home sections are fixed PREVIEWS (a "See all" links to the full paginated
 * pages, so Home is never paged): [R1] discovery is capped at 3 (non-closed, non-owned); [R2] "Your
 * positions" is capped at 3 with CLOSED positions first (stable within group) — the FULL position set
 * still drives every KPI, only the returned list is sliced; [R3] fewer than 3 shows what exists.
 *
 * POO-716 (rules v1): [R1] real mode passes `totalValue` into {@link buildInvestorPortfolioSeries} so
 * each plottable period ends at a synthetic "now" tip equal to the hero big number (the snapshot-only
 * daily series otherwise lags the live total). Display-only; mock mode is unchanged (already ends at
 * `totalValue`).
 *
 * POO-430 (rules v3): [R1'] "Earned today" (24h) / "Last 30 days" (30d) sum the per-position ACCRUED
 * value delta (POO-731), whose windows can be null. `earningsById` is now typed with nullable windows
 * and the sum coalesces a null (or missing) window to 0 (honest-empty), never a fabricated number
 * (R3'). Mock mode keeps the all-number mock table as the default.
 *
 * POO-714 (rules v1): [R1] "Total Yield" = Σ(all-time COLLECTED fees, investor-net) + Σ(currently
 * AVAILABLE/claimable fees) — a LIFETIME figure. The collected leg (`collectedById`, the analytics
 * metrics map's `collectedFees.all`) sums over ALL its keys, so fully-exited positions still count.
 * [R2] a collect only moves value between the two legs, so the KPI is stable across it. [R4] an
 * absent/empty collected map degrades to the claimable-only figure (never NaN, never blank).
 *
 * POO-896 (rules v1): "Earned today" / "Last 30 days" are FEES earned and can never render negative.
 * [R3] real mode threads `feesEarned` (collected-in-window + share-split uncollected delta, POO-731
 * endpoint) instead of the accrued VALUE delta; [R4] the displayed sums are `max(0, computed)` HERE
 * (the pure builder shared by the mock and real paths), because analytics serves the raw value (a
 * snapshot-pricing dip can push a window slightly negative with zero collects); [R5] price movement /
 * IL on principal never enters these KPIs; [R6] the mock default is the non-negative
 * {@link positionFeesEarned} table (fees semantics), no longer the share-card net-earnings table.
 *
 * POO-907 (rules v1): [R3] "Earned today" / "Last 30 days" PREFER the wallet-level
 * `totals.feesEarned` aggregate the analytics now serves (summed over ALL the wallet's positions,
 * fully-exited included) — the per-position sum below undercounts because the portfolio read drops
 * fully-exited positions. [R4] with totals present these KPIs stop depending on the portfolio position
 * set entirely; a null/absent totals falls back to the per-position sum.
 *
 * PP-CORE-LIB-048 (POO-990, legacy excision): the DUAL C1/legacy path is GONE. In REAL mode the money
 * KPIs read the C1 `/financials` payload EXCLUSIVELY — no legacy `/metrics` leg, no cross-backend
 * Total-Yield join, no FE `Math.max` re-clamp (the serving layer outer-clamps `earnedToday`/
 * `feesEarned` ≥ 0 by construction, financialsSchema D1/D5). A financials read that is unavailable
 * (outage / not-signed-in / parse-fail) threads `null` through so every money field renders the honest
 * "not available yet" affordance — NEVER a fabricated 0, NEVER a legacy number. The `earningsById` /
 * `collectedById` inputs now feed ONLY the MOCK design-harness path (`mock === true`); real-mode money
 * math lives entirely in `financials`. The C1-vs-mock decision keys off the `mock` seam (which the
 * shared mock-SSR page leaves at its `isMockMode` default), so the mock harness is unchanged.
 */
import type { WalletFinancials } from "@/lib/financials/financialsSchema";
import type { NullableEarningsWindows, Position, Strategy } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { buildInvestorPortfolioSeries } from "@/lib/timeseries/investorSeries";
import type { TimeseriesPoint } from "@/lib/timeseries/timeseriesSchema";
import { buildPortfolioSeries, type PortfolioSeries } from "@/mocks/data/portfolioSeries";
import { positionFeesEarned } from "@/mocks/data/positions";
import type { HomeViewPosition, HomeViewProps } from "./HomeView";

/**
 * Build the Home view props from the connected wallet's positions and the strategy catalog.
 * A position resolves to its catalog strategy, or to the real-data Strategy synthesized from its own
 * pool descriptor when the catalog omits it — closed/wound-down pools are absent from `/pools`, so a
 * closed holding would otherwise drop (and undercount the Home summary). Dropped only when neither
 * resolves (POO-526 R1; never fabricated — no-mock-in-real).
 */
export function buildHomeViewModel(
  rawPositions: Position[],
  strategies: Strategy[],
  locale: string,
  /**
   * MOCK-ONLY per-position earnings windows summed into "Earned today" (24h) / "Last 30 days" (30d).
   * Defaults to the non-negative mock feesEarned table (POO-896 R6). Read ONLY on the mock harness
   * path (`mock === true`); real mode reads `financials.earnedToday` / `financials.feesEarned["30d"]`
   * (PP-CORE-LIB-048). A null/missing window contributes 0 (honest-empty), never fabricated.
   */
  earningsById: Record<string, NullableEarningsWindows> = positionFeesEarned,
  /**
   * Whether this is the MOCK design harness. Defaults to the `isMockMode` seam: `true` in mock mode,
   * `false` in real mode. Gates BOTH the fabricated hero series (POO-556 R1) AND the money-KPI source:
   * `true` → the position/mock-table computation below; `false` → the C1 `financials` payload
   * exclusively (PP-CORE-LIB-048).
   */
  mock: boolean = isMockMode,
  /**
   * The real per-investor daily value series (`investor_portfolio.series`, POO-368), read wallet-scoped
   * by the data loader. Ignored in mock mode (the harness wins, R5); in real mode it drives every
   * period via {@link buildInvestorPortfolioSeries}, falling back to honest-empty when it holds <2
   * points (POO-367 R1/R3). Empty by default so a call that omits it stays honest-empty.
   */
  investorSeries: TimeseriesPoint[] = [],
  /**
   * MOCK-ONLY lifetime collected fees (investor-net USD) keyed by position id — the static PP-MOCK
   * table the mock page passes so the mock "Total Yield" KPI models collected + available. Read ONLY
   * on the mock harness path (`mock === true`); real mode's Total Yield is `financials.totalYield`
   * (PP-CORE-LIB-048). Summed over ALL keys (a fully-exited position still counts). Defaults to empty.
   */
  collectedById: Record<string, number> = {},
  /**
   * POO-936 / PP-CORE-LIB-048: the analytics C1 `/financials` payload. In REAL mode it is the SOLE
   * source of truth for the money KPIs — "Total Yield" (`totalYield`, the SAME field Portfolio reads,
   * [R1]), "Invested" (`invested`), "Earned today" (`earnedToday`), "Last 30 days" (`feesEarned["30d"]`)
   * and the hero total (`portfolioValue`). A served NULL field threads through as null so the tile
   * renders "not available yet", never $0 ([R5]); the serving layer floors these ≥ 0 by construction,
   * so there is NO FE `Math.max` re-clamp. A NULL payload (financials unavailable: outage /
   * not-signed-in / parse-fail) makes the money KPIs render unavailable — NEVER a legacy number, NEVER
   * a silent 0. Ignored on the mock harness path (`mock === true`), which uses the mock tables above.
   */
  financials: WalletFinancials | null = null,
): HomeViewProps {
  const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy]));

  const positions: HomeViewPosition[] = rawPositions
    .map((position) => {
      const strategy = strategyById.get(position.strategyId) ?? position.fallbackStrategy;
      return strategy ? { position, strategy } : null;
    })
    .filter((entry): entry is HomeViewPosition => entry !== null);

  const totalValue = positions.reduce((sum, entry) => sum + entry.position.currentValue, 0);
  // MOCK-ONLY money aggregates (read on the `mock` path). Real mode reads `financials` instead.
  const mockInvested = positions.reduce((sum, entry) => sum + entry.position.invested, 0);
  // POO-714 [R1]: mock Total Yield = lifetime COLLECTED (over ALL collected-map keys, incl. exited
  // positions) + currently AVAILABLE (claimable). [R2] a collect moves value from the available leg
  // into the collected leg, leaving this sum unchanged.
  const availableYield = positions.reduce((sum, entry) => sum + entry.position.totalYield, 0);
  const collectedYield = Object.values(collectedById).reduce((sum, value) => sum + value, 0);
  const mockTotalYield = availableYield + collectedYield;
  const avgApy =
    totalValue > 0
      ? positions.reduce(
          (sum, entry) => sum + entry.strategy.estReturn * entry.position.currentValue,
          0,
        ) / totalValue
      : 0;

  const ownedStrategyIds = new Set(positions.map((entry) => entry.strategy.id));
  // POO-671: the Home discovery + "Your positions" sections are fixed PREVIEWS capped at 3 (a
  // "See all" links to the full paginated Explore / Portfolio pages, so Home itself is never paged).
  const HOME_PREVIEW_COUNT = 3;
  // Discovery never surfaces closed strategies (POO-455): the holdings catalog passed in includes
  // closed so owned closed positions resolve, but a closed strategy is not investable (nor an
  // already-owned one). Capped at HOME_PREVIEW_COUNT for the preview.
  const discover = strategies
    .filter((strategy) => strategy.status !== "closed" && !ownedStrategyIds.has(strategy.id))
    .slice(0, HOME_PREVIEW_COUNT);

  // [R2] "Your positions" preview: at most HOME_PREVIEW_COUNT, CLOSED positions first (they need the
  // user's attention — withdraw) then the rest in their existing order (stable sort preserves it).
  // The full `positions` set above still drives every KPI (value/invested/yield/APY/earnings); only
  // this list slice is capped. "See all" links to the full paginated Portfolio page.
  const previewPositions = [...positions]
    .sort((a, b) => {
      const closedRank = (entry: HomeViewPosition) => (entry.position.status === "closed" ? 0 : 1);
      return closedRank(a) - closedRank(b);
    })
    .slice(0, HOME_PREVIEW_COUNT);

  // MOCK-ONLY "Earned today" (24h) / "Last 30 days" (30d): sum each owned position's FEES EARNED
  // window from the non-negative mock table (POO-896 R6); `?? 0` coalesces a missing position AND a
  // null window to 0 (honest-empty). No `Math.max` clamp — the mock table is non-negative by
  // construction (PP-CORE-LIB-048; the legacy clamp guarded raw analytics, which real mode no longer
  // reads — the C1 serving layer floors `earnedToday`/`feesEarned` ≥ 0 upstream).
  const mockEarnedToday = positions.reduce(
    (sum, entry) => sum + (earningsById[entry.position.id]?.["24h"] ?? 0),
    0,
  );
  const mockThisMonth = positions.reduce(
    (sum, entry) => sum + (earningsById[entry.position.id]?.["30d"] ?? 0),
    0,
  );
  // The hero value series: mock mode fabricates the design harness (R5); real mode plots the REAL
  // per-investor daily value series (POO-368), date-windowed per period (R1/R4). A real series with
  // <2 plottable points degrades to honest-empty — every period an empty list → the tabs + chart are
  // hidden (POO-556 R3 / POO-367 R3), never a fake curve. `buildInvestorPortfolioSeries` already
  // returns `emptyPortfolioSeries()` shape for an empty/single-point source.
  // POO-716: pass `totalValue` so each plottable period ends at a synthetic "now" tip equal to the
  // hero big number (the snapshot-only daily series otherwise lags the live total). Mock mode already
  // ends at `totalValue` via `buildPortfolioSeries` (`trend()` forces the last value), so it is
  // consistent without change; the append is scoped to the real-mode branch.
  // PP-INTEGRATION-POINT: per-investor portfolio value series ← analytics investor_portfolio.series (POO-368),
  // read wallet-scoped by HomeDataLoader via getInvestorPortfolioSeriesAction.
  const seriesByPeriod: PortfolioSeries = mock
    ? buildPortfolioSeries(locale, totalValue)
    : buildInvestorPortfolioSeries(investorSeries, locale, totalValue);

  // PP-CORE-LIB-048: the money KPIs source off the `mock` seam. MOCK harness → the position/mock-table
  // aggregates above. REAL mode → the C1 `/financials` payload EXCLUSIVELY: each field threads through
  // DIRECTLY, a served NULL (or a NULL payload = financials unavailable) stays null so the tile renders
  // "not available yet" — NEVER a fabricated $0, NEVER a legacy number. The serving layer floors these
  // ≥ 0 by construction (financialsSchema D1/D5), so there is no FE `Math.max` re-clamp. Home's
  // `totalYield` is `financials.totalYield` — the SAME field Portfolio reads (identical values, [R1]).
  //
  // CURRENT VALUE / hero (source-of-truth split): the hero total is the pp_api on-chain SUM OF POSITIONS
  // (`totalValue` = Σ each drained position's currentValue) in BOTH mock and real mode — the real value
  // the wallet holds right now, read straight from the contracts. We deliberately do NOT prefer the C1
  // `financials.portfolioValue`: analytics is the reliable HISTORICAL ledger (Invested = what went in),
  // pp_api is the live contract sum (Current Value = what's held now); they measure different things.
  // `usePositions` drains ALL positions, so this sum is complete (not a partial page). This also makes
  // the hero big number consistent with the hero series tip, which already ends at `totalValue` (POO-716).
  return {
    totalValue,
    earnedToday: mock ? mockEarnedToday : (financials?.earnedToday ?? null),
    invested: mock ? mockInvested : (financials?.invested ?? null),
    totalYield: mock ? mockTotalYield : (financials?.totalYield ?? null),
    thisMonth: mock ? mockThisMonth : (financials?.feesEarned["30d"] ?? null),
    avgApy,
    seriesByPeriod,
    // [R1][R2] The 3-cap previews (closed-first for positions); KPIs above use the full set.
    positions: previewPositions,
    discover,
  };
}
