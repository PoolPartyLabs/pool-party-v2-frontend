/**
 * @id PP-MGR-SCR-004 (POO-304, POO-750, POO-820)
 * @name mapManagerStrategyDetail
 * @implements-rules-version v3
 *
 * Maps one managed pool's full detail (GET /pools/:poolAddress) to the manage-detail payload.
 * Real-sourced: token pair, fee tier, lifetime fees, TVL, investors, the real in/out-of-range, and
 * the range PRICES (tick→price from the position ticks + token decimals, POO-282; falls back to
 * in-range-consistent placeholders when the API omits ticks/decimals).
 *
 * Real mode must NEVER fabricate data: activity / comments have no API source, so they are left
 * empty/undefined here (the cards hide or show their empty state) — the backend serves them (POO-380).
 * Pre-existing placeholders (the flat gas estimate) predate this and are tracked separately.
 *
 * POO-563 (rules v1): the `allocation` card is now REAL in V1, derived client-side from the position's
 * raw reserves (a strategy IS one Uniswap v3 position today) — no backend needed. See
 * {@link buildManagerAllocation}: `tokens` = the position's percent-of-value split, `protocols` = a
 * single 100% Uniswap v3 row (R1); single-sided renders 100/0 (R2); missing reserves → undefined so
 * the card hides, never a placeholder (R5). POO-380 is re-scoped to the future MULTI-protocol /
 * indexer-balance version (multiple protocol rows), not this single-position V1.
 *
 * POO-502 (POO-483 rules v2 @implements-rules-version v2): threads the position's raw reserve block
 * (`totalSupply0/1` + `tickCurrent`) into the detail so the manager Remove/Close modal can split the
 * liquidity leg per token client-side (`positionTokenSplit`, PP-CORE-LIB-022). Omitted (undefined)
 * when the position lacks it — never fabricated, so the modal degrades to the honest USD figure (R4).
 */
import { tickToPrice } from "@/lib/manager/tickPrice";
import type { ManagerStrategyDetail, Position } from "@/lib/schemas";
import type { ApiPool } from "@/lib/strategies/poolsSchema";
import { getRiskLevel } from "@/lib/strategies/riskProfile";
import { initialsFor } from "@/lib/utils/initials";
import { buildManagerAllocation } from "./lib/buildManagerAllocation";
import { categoryForRisk } from "./managerConsoleViewModel";

/** The position's range as real prices (token1 per token0), or null when the pool lacks ticks/decimals. */
function realRange(
  pool: ApiPool,
): { minPrice: number; maxPrice: number; currentPrice: number } | null {
  const { tickLower, tickUpper, tickCurrent } = pool;
  const d0 = pool.currency0.decimals;
  const d1 = pool.currency1.decimals;
  if (tickLower == null || tickUpper == null || tickCurrent == null || d0 == null || d1 == null) {
    return null;
  }
  return {
    minPrice: tickToPrice(tickLower, d0, d1),
    maxPrice: tickToPrice(tickUpper, d0, d1),
    currentPrice: tickToPrice(tickCurrent, d0, d1),
  };
}

/** Display label per API network slug. */
const NETWORK_LABEL: Record<string, string> = {
  arbitrum: "Arbitrum",
  base: "Base",
  polygon: "Polygon",
};

/** Convert a fee-tier label ("0.05%") to basis points (5). Defaults to 5 bps. */
function feeBpsFromTier(tier: string | undefined): number {
  const pct = tier ? Number.parseFloat(tier.replace("%", "")) : 0.05;
  const bps = Math.round((Number.isFinite(pct) ? pct : 0.05) * 100);
  return Math.max(1, bps);
}

/** Analytics-derived manage-detail fields (POO-366): the real per-period AUM series + its 30d change. */
export interface ManageDetailAnalytics {
  performance?: ManagerStrategyDetail["performance"];
  aumChangePct?: number;
}

/**
 * Build the manage-detail for one managed pool. `position` (if any) supplies the claimable proxy;
 * `analytics` (if any) supplies the real performance series + its trailing-30d AUM change. POO-558
 * R1/R2: WITHOUT analytics the real path leaves `performance` and `aumChangePct` UNDEFINED (no flat
 * 2-point mock at current AUM, no coerced +0.0%) so the view renders the explicit no-history state.
 */
export function mapManagerStrategyDetail(
  pool: ApiPool,
  position?: Position | null,
  analytics?: ManageDetailAnalytics,
  logoUrl?: string,
  nftPositionId?: string,
  feesApr?: number,
): ManagerStrategyDetail {
  const riskLevel = getRiskLevel(pool.currency0.symbol, pool.currency1.symbol);
  const investors = Math.max(0, Math.trunc(Number(pool.totalInvestors)) || 0);
  const aum = pool.poolTvlUsd;
  const lifetimeFees = pool.totalFeesInUsd ?? 0;
  const inRange = pool.inRange ?? true;
  // Real range prices from the position ticks (POO-282). Falls back to placeholders consistent with
  // the real in/out-of-range flag when the API omits ticks/decimals.
  const range = realRange(pool) ?? {
    minPrice: 1,
    maxPrice: 2,
    currentPrice: inRange ? 1.5 : 3,
  };

  return {
    // --- ManagerStrategy base ---
    id: pool.positionId,
    // POO-649: the public share deep-link id. In real mode the manager pool id AND the investor
    // catalog id are BOTH `pool.positionId` (see mapStrategy.ts:50), so they are identical and the
    // `/strategies/<publicStrategyId>` link resolves. The mock deliberately diverges the two id spaces
    // for realism, so it maps them explicitly (src/mocks/data/manager.ts).
    publicStrategyId: pool.positionId,
    name: pool.name,
    // Real description set by the manager at creation (stored with the name).
    description: pool.description ?? undefined,
    initials: initialsFor(pool.name),
    // POO-715: the manager-uploaded logo. The v1 pool-detail read has no logo column, so it is threaded
    // in from the joined catalog Strategy (mapStrategyV2) by the caller; undefined on the synth-from-
    // position (closed/wound-down) path → the header falls back to the initials monogram.
    logoUrl,
    riskLevel,
    category: categoryForRisk(riskLevel),
    aum,
    investors,
    flows30d: 0, // PP-MOCK: no 30d-flow source.
    // POO-820: prefer the v2 catalog strategy's Revert-coalesced feesApr (threaded by the caller,
    // like logoUrl) so "Net APR" matches the strategies-list "Est. return". The v1 pool-detail read
    // (pool.feesApr) is on-chain-only (v1 has no Revert coalesce), so it is the fallback for the
    // closed/synth-from-position path where there is no catalog strategy.
    apy: feesApr ?? pool.feesApr,
    fees30d: 0, // PP-MOCK
    // The manager strategy-card fee sparkline is still MOCKED (a flat two-point line, so the card
    // reads as visibly pending rather than plotting a fabricated fee curve). It is blocked on the
    // per-position fees-over-time endpoint and is out of scope for POO-367 (the value-chart wiring).
    // PP-INTEGRATION-POINT: manager fee sparkline ← analytics /pools/:address/fees-timeseries (POO-369).
    spark: [aum, aum], // PP-MOCK: no per-position fees-over-time source yet (POO-369).
    inRange,
    status: pool.closed ? "closed" : "active",
    // --- Manage detail ---
    pool: {
      token0: pool.currency0.symbol,
      token1: pool.currency1.symbol,
      feeBps: feeBpsFromTier(pool.poolFeeTier),
      // `network` is optional on the schema (legacy list rows omit it; POO-316). The single-pool
      // detail normally includes it — guard the index and keep a string fallback.
      networkName: NETWORK_LABEL[pool.network ?? ""] ?? pool.network ?? "",
      // Real on-chain identifiers for move-range (POO-310): network slug + token decimals.
      network: pool.network,
      decimals0: pool.currency0.decimals,
      decimals1: pool.currency1.decimals,
      // The underlying Uniswap DEX pool address. Consumed by the Operations card's invest handoff
      // (toInvestStrategy); NOT `pool.pool` (the PP position / Permit2 spender). The "View on Uniswap"
      // link now uses the position NFT id (`nftPositionId` below), not this address (POO-750).
      // PP-INTEGRATION-POINT: dexPoolAddress comes from GET /pools/:poolAddress (absent on mock).
      address: pool.dexPoolAddress,
      // The Uniswap v3 position NFT token id (POO-750), threaded from the v2 catalog (same channel as
      // logoUrl). Absent on the v1 pool-detail + synth/closed path → the "View on Uniswap" link hides.
      nftPositionId,
    },
    range: { full: false, ...range },
    // POO-558 R2: the trailing-30d AUM change from the real series when available (POO-366), else
    // UNDEFINED (never a coerced 0) so the view renders no pill. The view recomputes the pill per
    // selected period (R3) when a series is present; this is the summary/fallback figure.
    aumChangePct: analytics?.aumChangePct,
    yieldGenerated: lifetimeFees,
    feesAllTime: lifetimeFees,
    // Claimable = the position's accrued fees (`totalYield` = `totalFeesInUsd`), the SAME figure the
    // investor detail (StrategyDetailScreen `claimableFees`) and the Home "Yield" column show, so the
    // manager "Available to collect" never diverges from what the fee is elsewhere (POO-549, murilo
    // 2026-07-04). This supersedes the POO-318 preference for `uncollectedFeesUsd`: in practice the
    // backend returns `feesInfo.uncollectedFeesUSD: 0` for positions that DO have accrued fees, which
    // zeroed the figure and disabled Collect even though the fee exists.
    // PP-DEBT(SEV:MED) POO-549: when the backend's per-position uncollected accounting is reliable,
    // BOTH surfaces should adopt it together (a shared claimable helper), not just this one.
    claimableFeesUsd: Math.max(0, position?.totalYield ?? 0),
    // Per-token claimable for the manager's "receive as token pair" collect (POO-417 R3/R5); comes
    // straight from the position, absent → manager Collect stays USDC-only (R6c).
    claimableFeeTokens: position?.claimableFeeTokens,
    // Raw reserve block for the client-side value split of the manager Remove/Close liquidity leg
    // (POO-483 v2 R2 / POO-502), threaded straight from the position (the POO-437 fields). Decimals
    // are already on `pool.decimals0/1` above. Undefined on mock/lean reads → the modal degrades to
    // the honest USD figure (never fabricated). Also consumed by POO-501 Move Range.
    totalSupply0: position?.totalSupply0,
    totalSupply1: position?.totalSupply1,
    tickCurrent: position?.tickCurrent,
    gasEstimateUsd: 0.5, // PP-MOCK: flat estimate.
    // The manager's own stake (their position value) — drives the remove-liquidity preview (POO-312).
    managerStakeUsd: Math.max(0, position?.currentValue ?? 0),
    showInExplore: !pool.closed,
    // POO-558 R1: the real per-period AUM series from analytics when available (POO-366), else
    // UNDEFINED — the real path no longer fabricates a flat 2-point series at the current AUM (which
    // was indistinguishable from a genuine flat market). The view renders the explicit no-history
    // state instead. Mock mode never reaches here (the fixtures build `performance` directly).
    performance: analytics?.performance,
    // No real source yet — never fabricated in real mode. The Recent activity card shows a "coming
    // soon" state (POO-737 R2 — the view flags `comingSoon` in real mode); the Comments card is
    // hidden (undefined). Served by the backend (POO-380).
    activity: [],
    // POO-563 R1/R2/R5: the Allocation card is REAL in V1 — the strategy's single Uniswap v3 position
    // split client-side into per-token value shares + a single 100% Uniswap v3 protocol row. Undefined
    // when the raw reserve block is absent (lean read) so the card hides honestly (R5), never a
    // placeholder. Decimals + symbols come from the pool's currencies (same source as the reserves).
    allocation: buildManagerAllocation({
      token0: pool.currency0.symbol,
      token1: pool.currency1.symbol,
      totalSupply0: position?.totalSupply0,
      totalSupply1: position?.totalSupply1,
      tickCurrent: position?.tickCurrent,
      decimals0: pool.currency0.decimals,
      decimals1: pool.currency1.decimals,
    }),
    investorStats: { total: investors, active: investors },
  };
}
