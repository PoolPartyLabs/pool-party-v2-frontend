/**
 * @id PP-PORT-SCR-001 (POO-299, POO-556, POO-668)
 * @name buildPortfolioViewModel
 * @implements-rules-version v3 (POO-898 rules v1)
 *
 * Pure builder for the Portfolio screen props: joins positions to strategies, computes the summary
 * and the allocation-by-risk breakdown. This is the MOCK-SSR path; real mode server-pages via
 * PortfolioPagedLoader (POO-668). The value-weighted APY + allocation math is now the shared
 * {@link computeApyAndAllocation} helper, so both paths compute those two figures identically (v2).
 *
 * POO-556 (rules v1): [R1] the hero value series is fabricated ONLY in mock mode (design harness);
 * real mode rendered an honest-empty series while the per-investor portfolio timeseries did not exist.
 *
 * POO-367 (rules v1): [R1] real mode now plots the real per-investor value series (POO-368) when the
 * caller passes it; [R3] a series with <2 points still degrades to honest-empty (the Portfolio hero
 * has one flat chart with no period tabs, so it plots the full series — the `all` window).
 *
 * POO-714 (rules v1): "Total yield" mirrors Home's corrected LIFETIME formula: [R1] Σ(all-time
 * COLLECTED fees, investor-net, over ALL `collectedById` keys, incl. fully-exited positions) +
 * Σ(currently AVAILABLE/claimable fees). [R2] stable across a collect. [R4] an absent/empty
 * collected map degrades to the claimable-only figure (never NaN). Its [R5] ("Total earned"
 * mirrors the same lifetime figure) is partially superseded by POO-898.
 *
 * POO-898 (rules v1, partially supersedes POO-714 R5): the hero "unclaimed fees" pill
 * (`totalEarned`) de-mirrors `totalYield`. [R1] it is the CLAIMABLE-ONLY sum (Σ per-position
 * `totalYield`), no lifetime-collected leg, so [R3] a collect DECREASES the pill by the collected
 * amount while "Total yield" stays stable, and [R6] the pill agrees with the per-position Yield
 * column (same data family). [R5] empty inputs degrade to $0 (never NaN).
 */
import type { Position, Strategy } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { buildInvestorPortfolioSeries } from "@/lib/timeseries/investorSeries";
import type { TimeseriesPoint } from "@/lib/timeseries/timeseriesSchema";
import { toDailyChartPoints } from "@/mocks/data/portfolioSeries";
import { computeApyAndAllocation } from "./computeApyAndAllocation";
import { joinPositionsToStrategies } from "./joinPositionsToStrategies";
import type { PortfolioViewPosition, PortfolioViewProps } from "./PortfolioView";

/** Build the Portfolio view props from positions and the strategy catalog. */
export function buildPortfolioViewModel(
  rawPositions: Position[],
  strategies: Strategy[],
  locale: string,
  /**
   * Whether to fabricate the hero value series (design harness only). Defaults to the `isMockMode`
   * seam: `true` in mock mode, `false` in real mode. See the series comment below (POO-556 R1).
   */
  mock: boolean = isMockMode,
  /**
   * The real per-investor daily value series (`investor_portfolio.series`, POO-368), read wallet-scoped
   * by the data loader. Ignored in mock mode (the harness wins, R5); in real mode it drives the flat
   * hero chart, falling back to honest-empty when it holds <2 points (POO-367 R1/R3). Empty by default.
   */
  investorSeries: TimeseriesPoint[] = [],
  /**
   * POO-714 [R1]: LIFETIME collected fees (investor-net USD) keyed by position id; the mock page
   * passes the static PP-MOCK table (the analytics metrics map's shape in real mode). Summed over
   * ALL keys so fully-exited positions still count. Defaults to empty ([R4] degrade). Feeds ONLY
   * `totalYield`; the pill is claimable-only (POO-898 R1).
   */
  collectedById: Record<string, number> = {},
): PortfolioViewProps {
  // Resolve each position to its strategy: prefer the holdings catalog (richest data), then fall back
  // to the real-data Strategy synthesized from the position's own pool descriptor (POO-526 R1). The
  // catalog reads `/pools`, which the backend serves WITHOUT closed/wound-down pools, so a closed
  // holding (pending Withdraw) has no catalog match — the fallback keeps it on screen instead of
  // dropping it. A position with neither a catalog match nor a fallback is dropped, never shown with
  // fabricated data (no-mock-in-real): missing real data hides, it is not faked. Shared join (POO-668).
  const positions: PortfolioViewPosition[] = joinPositionsToStrategies(rawPositions, strategies);

  // Closed positions (pending Withdraw) surface at the TOP of the list (POO-457 R6); everything else
  // keeps its incoming order. This mirrors the backend's closed-with-balance-first order for the
  // default feed (here the FE pins every closed entry, not only those still holding a balance).
  // V8's sort is stable, so equal-key entries retain their relative order.
  positions.sort(
    (a, b) => Number(b.position.status === "closed") - Number(a.position.status === "closed"),
  );

  const invested = positions.reduce((sum, entry) => sum + entry.position.invested, 0);
  const currentValue = positions.reduce((sum, entry) => sum + entry.position.currentValue, 0);
  // POO-714 [R1]: lifetime figure = all-time COLLECTED (over ALL collected-map keys, incl.
  // exited positions) + currently AVAILABLE (claimable; `position.totalYield` keeps its per-position
  // claimable semantics). [R2] a collect moves value between the legs, leaving the sum unchanged.
  const availableYield = positions.reduce((sum, entry) => sum + entry.position.totalYield, 0);
  const collectedYield = Object.values(collectedById).reduce((sum, value) => sum + value, 0);
  const totalYield = availableYield + collectedYield;
  const totalValue = currentValue;
  // POO-898 [R1] (partially supersedes POO-714 R5): the "unclaimed fees" pill is CLAIMABLE-ONLY,
  // the sum of the rows' claimable yields ([R6]), so [R3] a collect decreases it by the collected
  // amount while `totalYield` above keeps the stable lifetime figure.
  const totalEarned = availableYield;

  // Value-weighted average APY + allocation-by-risk. Shared with the real active-drain path (POO-668)
  // via one pure helper so both compute them identically — the backend has no grand aggregate for these
  // two figures yet (POO-696), so they are derived over the holdings client-side.
  const { avgApy, allocation } = computeApyAndAllocation(positions);

  // The hero value series: mock mode fabricates the design harness (8 seed points + the live total).
  // Real mode plots the REAL per-investor daily value series (POO-368). The Portfolio hero is a single
  // flat chart (no period tabs), so it plots the full series — the `all` window, which is already
  // <2-point-gated and locale-mapped by buildInvestorPortfolioSeries. A series with <2 points yields
  // `[]` → PerformanceChart renders nothing (honest-empty, POO-556 R1 / POO-367 R3), never a fake curve.
  // PP-INTEGRATION-POINT: per-investor portfolio value series ← analytics investor_portfolio.series (POO-368),
  // read wallet-scoped by the Portfolio data loader via getInvestorPortfolioSeriesAction.
  const chartData = mock
    ? toDailyChartPoints([3920, 3990, 4060, 4010, 4180, 4320, 4290, 4460, totalValue], locale)
    : buildInvestorPortfolioSeries(investorSeries, locale).all;

  return {
    totalValue,
    totalEarned,
    invested,
    currentValue,
    totalYield,
    avgApy,
    chartData,
    allocation,
    positions,
  };
}
