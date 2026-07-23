/**
 * @id PP-MGR-SCR-001 (POO-224, POO-779, POO-990, POO-991) · PP-CORE-LIB-049 (POO-991)
 * @name buildManagerConsole
 * @implements-rules-version v3 · v1 (POO-991: drop the legacy /analytics/wallets manager read)
 *
 * Pure builder for the manager console Overview from real data. POO-779 R4 (v3): the managed-pool LIST
 * is now the already-resolved managerWallet-scoped strategy set (see {@link resolveManagedStrategies}),
 * which drives the rows directly — the old `isPoolManager`-positions ⋈ full-catalog join moved into
 * that resolver (killing the second catalog drain, POO-669). KPIs that have a source are derived (AUM,
 * investors, avg APY from the strategy rows; claimable yield left-joined from the held positions); the
 * rest (30d flows, AUM-over-time series, earnings breakdown, profile) stay mocked and flagged.
 */
import type { ManagerFinancials } from "@/lib/financials/financialsSchema";
import type { ManagerDashboard, ManagerStrategy, Position, Strategy } from "@/lib/schemas";
import { initialsFor } from "@/lib/utils/initials";
import type { SparkResult } from "./lib/buildSpark";

/** A coarse category label derived from the risk band (no API category source). */
export function categoryForRisk(riskLevel: number): string {
  if (riskLevel <= 1) return "Stablecoin yield";
  if (riskLevel <= 3) return "Dynamic yield";
  return "Volatile pairs";
}

/**
 * Map a managed strategy (the pool the wallet manages) to a manager-console row. When `spark` carries a
 * real measured value series (POO-559 R1: the pool's trailing-30d AUM), the row shows it and tags it
 * measured; otherwise it keeps a schema-valid flat 2-point placeholder tagged NOT measured (R2) so the
 * card hides the sparkline rather than presenting a flat line as a real 30d trend.
 */
export function mapManagerStrategy(strategy: Strategy, spark?: SparkResult): ManagerStrategy {
  const measured = spark?.measured === true && spark.points.length >= 2;
  return {
    id: strategy.id,
    name: strategy.name,
    initials: initialsFor(strategy.name),
    // POO-715: the manager-uploaded logo, carried from the joined catalog Strategy (mapStrategyV2).
    // Undefined → the card shows the initials monogram.
    logoUrl: strategy.logoUrl,
    riskLevel: strategy.riskLevel,
    // PP-MOCK: no API category — derived from the risk band.
    category: categoryForRisk(strategy.riskLevel),
    aum: strategy.tvl,
    investors: strategy.investors,
    // PP-MOCK: no 30d-flow / 30d-fee source yet. The pool-detail fee block is cumulative (no date
    // dimension) and movements are unbounded/paginated, so a windowable 30d figure needs POO-369.
    // PP-INTEGRATION-POINT: manager 30d fees/flows ← analytics fee_splits + movements by date (POO-369).
    flows30d: 0,
    apy: strategy.estReturn,
    fees30d: 0,
    // POO-559 R1/R5: the real trailing-30d value series when covered; the flat placeholder otherwise.
    spark: measured ? spark.points : [strategy.tvl, strategy.tvl],
    sparkMeasured: measured,
    // PP-MOCK: real in-range comes with the manage / move-range flow.
    inRange: true,
    status: strategy.status,
  };
}

/** The manager-console Overview view model (dashboard KPIs + managed strategies). */
export interface ManagerConsoleViewModel {
  dashboard: ManagerDashboard;
  strategies: ManagerStrategy[];
}

/**
 * Analytics-derived dashboard extras (POO-366). Each is optional so the console still builds from
 * pp_api data alone when the analytics indexer is unavailable; absent values keep their zero default.
 *
 * PP-CORE-LIB-049 (POO-991): the legacy `/analytics/wallets/:addr` summary fields (`netInflows30d`,
 * `perfEarnedUsd`, `totalInvestorsAllTime`) were removed — those three tiles now source ONLY from the
 * C1 `/financials` payload (`financials`) below.
 */
export interface ManagerConsoleExtras {
  /** AUM-over-time series for the hero chart (the real manager_aum, mapped). */
  chart?: ManagerDashboard["chart"];
  /** Trailing-30d AUM change, percent (from the manager_aum series). */
  aumChangePct?: number;
  /**
   * Real per-row value sparks keyed by strategy id (POO-559 R1): each is the pool's trailing-30d value
   * series, downsampled. Absent / not-measured entries keep the flat placeholder (R2).
   */
  sparksById?: Record<string, SparkResult>;
  /**
   * PP-CORE-LIB-048: the C1 /manager/:addr/financials payload, read unconditionally in real mode. When
   * present it is the PREFERRED source for the dashboard money tiles + the chart series (each field from
   * the SAME table as its KPI, [R4]): AUM (10), the server-computed 30d change % (16), Net inflows 30d
   * (11), Yield generated (12), all-time Performance fees (15, `performanceFees` — the earnings card is
   * "All-time", NOT the 30d `performanceFees30d`), Active/Total investors (13/14), and the AUM chart series.
   *
   * PP-CORE-LIB-049 (POO-991): with the legacy `/analytics/wallets/:addr` read removed, a served NULL —
   * or an absent payload (mock / unavailable) — degrades PER TILE: the tiles with a genuine on-chain Σ
   * (AUM / active investors / yield / total-investors) fall to that Σ; netInflows30d + earnings have NO
   * Σ, so they resolve to `null` (the view renders `common.unavailable`), never a fabricated $0.
   */
  financials?: ManagerFinancials | null;
  /**
   * POO-936 [R4]: whether the plotted hero chart (`chart`) is the SERVED /financials AUM series. The
   * action resolves the chart source once (served when the /financials AUM series holds >= 2 non-null
   * points; else the legacy manager_aum series) and passes the decision here so the AUM headline +
   * 30d change % follow the SAME source as the trend line — a served AUM is never shown over a legacy
   * chart. Only meaningful when `financials` is present; ignored otherwise. Defaults to false (legacy).
   */
  aumChartFromFinancials?: boolean;
}

/**
 * Build the manager-console Overview. POO-779 R4 (v3): `strategies` is the already-resolved MANAGED
 * list (the managerWallet-scoped v2 read ∪ any vanished-but-held managed pool, deduped by id — see
 * {@link resolveManagedStrategies}), so it drives the rows directly. The ownership filter that used to
 * live here (`positions.filter(isPoolManager)` ⋈ full catalog + `fallbackStrategy`) has moved into
 * that resolver, killing the console's second full-catalog drain (POO-669). `positions` is retained
 * for the KPI that needs LIVE amounts: the per-strategy claimable-yield sum feeding `yieldGenerated`
 * is left-joined by strategy id, so a managed row with no matching held position contributes 0 yield
 * rather than dropping (Q3). `address` is the manager's authenticated wallet (POO-659): it fills
 * `dashboard.address`, the invite/greeting identity fallback when no `handle` is set. Empty → omitted.
 * `extras` carries the analytics-derived dashboard fields (POO-366).
 */
export function buildManagerConsole(
  positions: Position[],
  strategies: Strategy[],
  managerName: string,
  handle: string,
  address?: string,
  extras: ManagerConsoleExtras = {},
): ManagerConsoleViewModel {
  // POO-779 R4 (Q3): `yieldGenerated` is position-sourced (live claimable amounts), so left-join the
  // held positions to the managed strategies by id. Summed per strategy id so a wallet holding the same
  // strategy across multiple positions still totals correctly; a managed strategy with no matching
  // position (e.g. a manager who fully exited) contributes 0 yield instead of dropping the row.
  const yieldByStrategy = new Map<string, number>();
  for (const position of positions) {
    yieldByStrategy.set(
      position.strategyId,
      (yieldByStrategy.get(position.strategyId) ?? 0) + Math.max(0, position.totalYield),
    );
  }

  // POO-779 R4: the rows ARE the resolved managed strategies — ownership + vanished-pool recovery are
  // already applied upstream (resolveManagedStrategies), so no catalog join / isPoolManager filter here.
  const rows = strategies;

  const managerStrategies = rows.map((strategy) =>
    mapManagerStrategy(strategy, extras.sparksById?.[strategy.id]),
  );

  // PP-CORE-LIB-048 (POO-990): the C1 manager /financials payload (`extras.financials`) is read
  // UNCONDITIONALLY — the `financialsV2` flag + the `fin !== null ? … : legacy` dual-path ternaries are
  // gone. The money tiles + investor counts PREFER the C1 served value (`fin?.X`).
  //
  // PP-CORE-LIB-049 (POO-991): the last v2 legacy `/analytics/wallets/:addr` read (`fetchManagerSummary`)
  // was removed. The three tiles it fed now source per their [R3] degrade posture:
  //   - AUM / active investors / yield generated KEEP a genuine on-chain Σ degrade (`?? legacy…`) — a
  //     served NULL or a null payload falls to the pp_api on-chain strategy rows, so the tile never blanks.
  //   - netInflows30d + earnings (total/performance) have NO on-chain Σ, so a served NULL or a null
  //     payload resolves to `null` — the honest `common.unavailable` affordance (mirroring the investor
  //     Home/Portfolio posture), NEVER a fabricated $0 and never the removed legacy read. The schema
  //     fields were made nullable (`managerDashboardSchema.netInflows30d`, `earnings.totalUsd`,
  //     `earnings.performanceUsd`) and `ManagerDashboardView` renders those nulls as unavailable.
  const fin = extras.financials ?? null;
  const legacyAum = rows.reduce((sum, strategy) => sum + strategy.tvl, 0);
  // POO-936 [R4]: the AUM headline + 30d change % must read the SAME source as the plotted hero chart.
  // The action decided which series it plotted (`aumChartFromFinancials`: served when the /financials
  // AUM series had >= 2 non-null points, else the legacy manager_aum series). Follow that decision: use
  // the served AUM + server-computed change % ONLY when the served series is what we plotted; otherwise
  // fall BOTH the headline and the change % back to legacy so a served AUM never sits over a legacy
  // trend line. `extras.aumChangePct` is already the legacy `changePctOverDays(aumSeries, 30)`.
  const aumFromFinancials = fin !== null && extras.aumChartFromFinancials === true;
  const aum = aumFromFinancials ? (fin.aum ?? legacyAum) : legacyAum;
  // The current/active investor count: the sum of the on-chain OPEN-position counts across the
  // manager's strategies. It decrements on a full withdrawal and double-counts a wallet held in two
  // strategies — correct for the "Active investors" tile, wrong for the all-time one (POO-743).
  // POO-936: the served active-investor count (13) when the cutover is on, else the on-chain sum.
  const legacyTotalInvestors = rows.reduce((sum, strategy) => sum + strategy.investors, 0);
  const totalInvestors = fin?.activeInvestors ?? legacyTotalInvestors;
  // The all-time distinct-investor count feeds the "Total investors" tile. It does NOT decrement on a
  // full withdrawal (fixing the POO-743 7 → 6 regression) and dedups a wallet across the manager's
  // strategies. [R3] Degrades to the on-chain current Σ (`legacyTotalInvestors` = Σ strategy.investors,
  // a genuine on-chain source) when the payload / field is null, so the tile never blanks to 0/null.
  // PP-CORE-LIB-049 (POO-991): the middle `?? extras.totalInvestorsAllTime` term (the removed legacy
  // `/analytics/wallets/:addr` summary count) is gone — the source is the C1 `/financials` count only.
  //
  // PP-NOTE [R4]: the C1 `fin.totalInvestors` (field 14) is manager-EXCLUDED and monotonic, whereas the
  // removed legacy `n_investors` counted the manager's own wallet. This is a deliberate correctness
  // improvement (the tile no longer over-counts by the manager), NOT a like-for-like swap.
  const totalInvestorsAllTime = fin?.totalInvestors ?? legacyTotalInvestors;
  const legacyYieldGenerated = rows.reduce(
    (sum, strategy) => sum + (yieldByStrategy.get(strategy.id) ?? 0),
    0,
  );
  // POO-936: field 12 (Yield generated) served from the ledger (incl. closed-unsettled), else legacy.
  const yieldGenerated = fin?.yieldGenerated ?? legacyYieldGenerated;
  // The TVL-weighted average APY stays computed over the rows (legacy AUM denominator), independent
  // of whether the AUM tile shows the served value — it is a weighting, not a served field.
  const avgApy =
    legacyAum > 0
      ? rows.reduce((sum, strategy) => sum + strategy.estReturn * strategy.tvl, 0) / legacyAum
      : 0;

  const dashboard: ManagerDashboard = {
    name: managerName,
    aum,
    yieldGenerated,
    // Current/active investors (on-chain open positions) → the "Active investors" tile.
    totalInvestors,
    // POO-743 (rules-v2): all-time distinct investors (monotonic) → the "Total investors" tile.
    totalInvestorsAllTime,
    avgApy,
    handle,
    // POO-659: the manager's authenticated wallet, the invite/greeting identity fallback when no
    // `handle` is set. Empty → omitted so the schema's `.optional()` and the view's connected-wallet
    // last resort still hold (never a broken `/m/`).
    address: address || undefined,
    // Analytics-derived when available (POO-366); zero defaults otherwise. The AUM series is the real
    // manager_aum (empty hides the hero chart rather than fabricating a trend); the 30d change, net
    // inflows and performance earnings come from the C1 /financials payload (POO-991: no longer the
    // legacy manager summary). V1 locks entry/exit fees at 0, so total earnings == performance earnings.
    // POO-936 [R4]: the chart series + the 30d change % + the AUM headline all read the SAME source.
    // `extras.chart` is whatever series the action plotted (served /financials when it had >= 2 non-null
    // points, else the legacy manager_aum). The change % follows: the server-computed `aumChange30dPct`
    // ONLY when we plotted the served series (`aumFromFinancials`), else the legacy `extras.aumChangePct`
    // — so a served change % never sits over a legacy trend line. A served-NULL change % falls to 0.
    chart: extras.chart ?? [],
    aumChangePct: aumFromFinancials ? (fin.aumChange30dPct ?? 0) : (extras.aumChangePct ?? 0),
    // Field 11: net inflows 30d — the C1 ledger value (A3 override). [R3] no on-chain Σ, so a null
    // payload OR a served-null field → null (the view renders `common.unavailable`), never a $0.
    netInflows30d: fin?.netInflows30d ?? null,
    earnings: {
      // Field 15 (ALL-TIME): performance fees — the C1 ledger value (`performanceFees`, Σ measured
      // manager_receipt legs). [R1] this is the all-time figure the removed v2 read fed, matching the
      // card's "All-time" label — NOT the 30d `performanceFees30d`. [R3] no on-chain Σ → null when the
      // payload / field is null (never $0). V1 locks entry/exit fees at 0, so total == performance.
      totalUsd: fin?.performanceFees ?? null,
      performanceUsd: fin?.performanceFees ?? null,
      entryUsd: 0,
      exitUsd: 0,
    },
    // No weekly-active-investors source exists in real mode, so `null` (never a fabricated 0 that would
    // render a positive "▲ +0% vs last week" delta — POO-560 R1). The tile omits the delta entirely.
    // PP-INTEGRATION-POINT: when the analytics indexer serves active_7d + active_wow_pct (POO-561),
    // set this to the real sign-aware percentage and the tile re-labels to a true active-today count.
    activeWoWPct: null,
    // PP-MOCK: no referral source yet.
    referrals: 0,
  };

  return { dashboard, strategies: managerStrategies };
}
