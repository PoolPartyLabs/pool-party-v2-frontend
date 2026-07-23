/**
 * @id PP-STR (POO-216)
 * @name Portfolio API response schema
 * @implements-rules-version v2
 *
 * Zod for GET /api/v1/portfolio/:wallet/all (cross-network). Only the fields the
 * ACL mapper consumes are required; each position carries far more (LP amounts,
 * ticks, fees, pool metadata) which other views translate later (POO-282).
 *
 * PP-INTEGRATION-POINT: response contract for the pool-party-api portfolio endpoint.
 */

import { z } from "zod";
import { embeddedManagerIdentitySchema } from "@/lib/manager/managerIdentitySchema";
import { RISK_PROFILE_LEVEL, type RiskProfile } from "@/lib/strategies/riskProfile";

/** One portfolio position (the OAMS/LP position the user holds). */
export const apiPositionSchema = z.object({
  /**
   * POO-771/POO-758 (R7): the manager's PUBLIC identity embedded at the position row ROOT (sibling of
   * {@link poolPartyPosition}/{@link feesInfo}), so a CLOSED holding absent from the catalog still
   * renders `@handle`/avatar and the verified badge via {@link synthesizeStrategyFromPosition}, with
   * zero extra requests. The badge is gated on the `managerVerification` enum (`none|pending|valid`,
   * POO-798), the single verified-badge source. `.nullish()` and declared HERE deliberately: `apiPositionSchema` is a plain `z.object`
   * that STRIPS undeclared keys, so without this field the backend-embedded identity would be dropped
   * before the synthesizer ever sees it. `null` for an unknown manager; absent on an older backend
   * (the synthesizer then falls back to wallet-only, never fabricated).
   */
  manager: embeddedManagerIdentitySchema.nullish(),
  /** Pre-computed current balance in USD (the interface's "Total Balance"). */
  totalBalanceUsd: z.number(),
  /**
   * Balance including the pending refund — the interface's canonical displayed/withdrawable value.
   * Preferred over `totalBalanceUsd` when present (POO-318). Absent on leaner reads → falls back.
   */
  totalBalanceWithRefundUsd: z.number().optional(),
  /** The pending refund portion in USD (POO-318). */
  totalRefundInUsd: z.number().optional(),
  /**
   * The wallet's invested COST BASIS in USD for this position (POO-719 rules-v2): pp_api's
   * `GREATEST(0, adds - removes)` over the `strategy_liquidity_events` ledger, fees excluded.
   * `null` when the ledger has no rows for this wallet+position (legacy pre-backfill position, or
   * the enrichment degraded) and absent on an older backend; the mapper then falls back to the
   * current balance (R10v2) — never a fabricated 0.
   * PP-INTEGRATION-POINT: `investedUsd` ← pool-party-api `GET /portfolio/:wallet(/all)` (POO-719).
   */
  investedUsd: z.number().nullish(),
  /**
   * The position's CLAIMABLE fees in USD (post-manager-fee, zeroes on collect). POO-569 renamed the
   * portfolio-position `totalFeesInUsd` to `claimableFeesUsd` ADDITIVELY: pp_api emits both with the
   * SAME value for one release, so this is optional and the mapper reads `claimableFeesUsd ??
   * totalFeesInUsd` — safe whether or not pp_api is redeployed (POO-367 R7). Prefer this once present.
   */
  claimableFeesUsd: z.number().optional(),
  /**
   * Deprecated alias of {@link claimableFeesUsd} on the portfolio-position surface (POO-569). Now
   * OPTIONAL (POO-569): the mapper reads `claimableFeesUsd ?? totalFeesInUsd`, so a pp_api release that
   * drops this alias must not fail the whole positions read and blank the dashboard. Prefer
   * `claimableFeesUsd`; keep this only as the pre-rename fallback.
   */
  totalFeesInUsd: z.number().optional(),
  /** Fee breakdown; `uncollectedFeesUSD` is the true claimable amount (POO-318). */
  feesInfo: z.object({ uncollectedFeesUSD: z.number() }).optional(),
  /** Whether the connected wallet manages this position's pool (drives the manager role). */
  isPoolManager: z.boolean().optional(),
  /**
   * Uncollected fee owed in token0 base units (raw integer string). Powers the "receive as token
   * pair" collect rows (POO-417 R3/R5). Absent on leaner reads → the pair option degrades (R6c).
   *
   * PP-INTEGRATION-POINT (POO-417 follow-up): the exact field names `fees0`/`fees1` and
   * `currency0`/`currency1` are NOT yet verified against the live pool-party-api
   * `GET /portfolio/:wallet/all` response. They are optional and degrade to USDC-only when absent,
   * so real mode is safe today; confirm the real field names before relying on the pair rows in
   * real mode (rename here if the API differs).
   */
  fees0: z.string().optional(),
  /** Uncollected fee owed in token1 base units (raw integer string). See {@link fees0}. */
  fees1: z.string().optional(),
  /** On-chain position metadata. */
  poolPartyPosition: z.object({
    /** The position address — the FE Strategy.id / Position.strategyId. */
    positionId: z.string(),
    /** Whether the position is closed. */
    closed: z.boolean(),
    /** token0 identity — symbol + decimals to convert {@link fees0} to a human amount (POO-417). */
    currency0: z.object({ symbol: z.string(), decimals: z.number().int() }).optional(),
    /** token1 identity — symbol + decimals for {@link fees1}. See {@link currency0}. */
    currency1: z.object({ symbol: z.string(), decimals: z.number().int() }).optional(),
    /**
     * Pool descriptor carried on the position payload (same fields `/pools` returns per pool). A
     * held closed/wound-down pool is ABSENT from `/pools` (the holdings catalog), so these let the FE
     * synthesize a real-data Strategy from the position itself and keep the closed holding on screen
     * instead of dropping it (POO-526 R1/R2 — see {@link synthesizeStrategyFromPosition}). Optional:
     * present on the real `/portfolio/:wallet/all` position; absent on leaner reads → no synth.
     *
     * PP-INTEGRATION-POINT: pool descriptor ← `poolPartyPosition` on the portfolio endpoint.
     */
    name: z.string().optional(),
    poolManager: z.string().optional(),
    feesApr: z.number().optional(),
    poolTvlUsd: z.number().optional(),
    totalInvestors: z.string().optional(),
    network: z.string().optional(),
    /**
     * Current pooled reserves in raw base units (the pool position's token0/token1 balances). The
     * legacy (Arbitrum/Base) move-range sizes its rebalance swap from these plus the new range
     * (POO-437). Present on the real `/portfolio/:wallet/all` position; absent on leaner reads.
     */
    totalSupply0: z.string().optional(),
    totalSupply1: z.string().optional(),
    /** Current pool tick — the legacy move-range derives the current price from it (POO-437). */
    tickCurrent: z.number().int().optional(),
  }),
});
export type ApiPosition = z.infer<typeof apiPositionSchema>;

/** The `{ positions }` payload (after apiFetch unwraps the `{ data }` envelope). */
export const apiPortfolioSchema = z.object({
  positions: z.array(apiPositionSchema),
  /**
   * The backend's grand total of positions for this wallet (POO-646). Used only as a secondary
   * "reached everything" short-circuit for the page-drain — NOT as the stop condition, because the
   * live `/portfolio/:wallet/all` computes `totalPositions` BEFORE the `closed` query filter narrows
   * the returned set, so it over-counts a filtered read. Optional so a leaner/mock response parses.
   *
   * POO-668: for the same reason it is a PHANTOM total for a server-paged per-list "Load more" — the
   * active (`closed=none`) and closed (`closed=exited`) lists derive `hasMore` from SHORT-PAGE
   * termination, never from this count.
   *
   * PP-INTEGRATION-POINT: `totalPositions` ← pool-party-api `GET /portfolio/:wallet/all` (pre-filter
   * grand total; `page`/`limit` default 100, positions filtered then paginated).
   */
  totalPositions: z.number().optional(),
  /**
   * The wallet's GRAND balance across ALL positions in USD (the sum the backend already computes over
   * the full portfolio, not just the returned page). Drives the Portfolio "Portfolio value" hero + the
   * "Current value" KPI. Optional so a lean/mock envelope parses; absent → 0 (POO-668 R3).
   *
   * PP-INTEGRATION-POINT: `totalBalanceUsd` ← pool-party-api `GET /portfolio/:wallet/all` (grand
   * aggregate, page-independent).
   */
  totalBalanceUsd: z.number().optional(),
  /**
   * The wallet's GRAND claimable fees across all positions in USD (post-manager-fee). Drives the hero
   * "unclaimed fees" pill. Optional; absent → 0. POO-569 renamed the field additively, so a redeployed
   * pp_api emits both this and {@link ApiPortfolio.totalFeesInUsd} with the same value — prefer this.
   *
   * PP-INTEGRATION-POINT: `claimableFeesUsd` ← pool-party-api `GET /portfolio/:wallet/all` (grand aggregate).
   */
  claimableFeesUsd: z.number().optional(),
  /**
   * The wallet's GRAND total fees across all positions in USD (the deprecated alias of
   * {@link ApiPortfolio.claimableFeesUsd} on the aggregate surface, POO-569). Drives the "Total yield"
   * KPI as a fallback when `claimableFeesUsd` is absent. Optional; absent → 0.
   *
   * PP-INTEGRATION-POINT: `totalFeesInUsd` ← pool-party-api `GET /portfolio/:wallet/all` (grand aggregate).
   */
  totalFeesInUsd: z.number().optional(),
  /**
   * The wallet's GRAND performance fees across all positions in USD. Carried through for future KPI use
   * (no current KPI field maps to it, POO-668 R3). Optional; absent → 0.
   *
   * PP-INTEGRATION-POINT: `totalPerformanceFeesInUsd` ← pool-party-api `GET /portfolio/:wallet/all`.
   */
  totalPerformanceFeesInUsd: z.number().optional(),
  /**
   * The wallet's GRAND invested COST BASIS across ALL holdings in USD, page-independent (POO-832 R1).
   * Drives the "Invested" KPI DISTINCTLY from "Current value" (`totalBalanceUsd`). Summed backend-side
   * over the SAME filtered set as `totalBalanceUsd` with the per-row POO-719 fallback
   * (`investedUsd ?? totalBalanceWithRefundUsd`), so the grand total equals the visible Invested column.
   * OPTIONAL and additive: absent on a not-yet-redeployed backend — the KPI mapper then FALLS BACK to
   * `totalBalanceUsd` (today's mirror behavior, never NaN); present once the backend serves it. A real 0
   * means "$0 invested" (nothing at cost), NOT absent.
   *
   * PP-INTEGRATION-POINT (POO-832): `totalInvestedUsd` ← pool-party-api `GET /portfolio/:wallet/all`
   * grand aggregate (Σ `investedUsd ?? balance` over the POO-719 `strategy_liquidity_events` ledger).
   */
  totalInvestedUsd: z.number().optional(),
  /**
   * The wallet's GRAND value-weighted average fee APR across ALL holdings (%), page-independent. Drives
   * the "Avg APR" KPI. OPTIONAL and additive (POO-696): absent on an older backend, so the KPI mapper
   * falls back to the client-side computation over the active holdings ({@link computeApyAndAllocation});
   * present once POO-696 ships, read straight. A real 0 means "0% APR" (a funded wallet at break-even),
   * NOT absent.
   *
   * PP-INTEGRATION-POINT (POO-696): `avgApr` ← pool-party-api `GET /portfolio/:wallet/all` grand
   * aggregate (`Σ feeApr×value / Σ value`, over ALL holdings, page-independent). Note APR, NOT APY.
   */
  avgApr: z.number().optional(),
  /**
   * The wallet's GRAND allocation-by-risk split, page-independent. Drives the "Allocation by risk" bar.
   * OPTIONAL and additive (POO-696): absent on an older backend → the KPI mapper falls back to the
   * client-side computation; present once POO-696 ships. Backend shape is the 3-band
   * `{ risk: "steady"|"dynamic"|"wild", pct }` (per-band % share, all three bands, summing to ~100);
   * {@link mapPortfolioAggregates} maps it onto the FE bar's 5-band `{ level, value }` model
   * (steady→1, dynamic→3, wild→5) via {@link RISK_PROFILE_LEVEL}, the same shape the client-side
   * computation produces so the KPI mapper's `?? computed` fallback stays shape-uniform.
   *
   * TOLERANT (`.catch(undefined)`, PP-DEBT(SEV:MED) POO-698): a field the KPI mapper FALLS BACK from must
   * never fail the ENTIRE positions parse and blank the Home/Manager/Portfolio dashboards, the exact
   * 2026-07-07 networkCounts outage class. Any shape drift (a legacy `{ level, value }` payload, a
   * renamed band, a wrong type) degrades to `undefined` (→ client-compute), it NEVER throws.
   *
   * PP-INTEGRATION-POINT (POO-696): `allocation` ← pool-party-api `GET /portfolio/:wallet/all` grand
   * aggregate (per-risk-band % share across ALL holdings).
   *
   * The `as z.ZodType<...>` cast keeps `.catch()`'s widened `unknown` INPUT type off `ApiPortfolio` so it
   * cannot leak through `apiFetch`'s `ZodType<T>` generic (the same Zod-v3 quirk `builtTxSchema` casts
   * around); the OUTPUT type stays the parsed band array.
   */
  allocation: z
    .array(z.object({ risk: z.enum(["steady", "dynamic", "wild"]), pct: z.number() }))
    .optional()
    .catch(undefined) as z.ZodType<{ risk: RiskProfile; pct: number }[] | undefined>,
  /**
   * Per-network position counts. NOT consumed by any KPI (POO-668 R3) — pure passthrough. pp_api
   * changed this field's SHAPE from an object (`{ base: 3, arbitrum: 1 }`) to an array
   * (`[{ network: "arbitrum", count: 12 }, ...]`); the old strict `z.record` rejected the array, which
   * made this UNUSED field fail the ENTIRE portfolio parse and blank the Home/Manager dashboard
   * (2026-07-07 outage). Validated as `z.unknown()` so a shape change on a field nothing reads can
   * never break the positions read again. The systemic graceful-degrade (don't let one bad field kill
   * the dashboard, don't cache parse failures) is tracked in POO-698.
   *
   * PP-INTEGRATION-POINT: `networkCounts` ← pool-party-api `GET /portfolio/:wallet/all` (array of
   * `{ network, count }` as of the 2026-07-07 pp_api release; unused, so its shape is not enforced).
   */
  networkCounts: z.unknown().optional(),
});
export type ApiPortfolio = z.infer<typeof apiPortfolioSchema>;

/**
 * One allocation-by-risk band in the FE bar's INTERNAL shape, mapped from the backend's 3-band
 * `{ risk, pct }` aggregate (steady→1, dynamic→3, wild→5; `value` = the band's % share). Structurally
 * identical to the FE `AllocationSegment` ({@link AllocationByRisk}), kept independent here so this
 * `lib` schema never imports a `features` type (layering). POO-696.
 */
export interface PortfolioAllocationSegment {
  /** Risk band 1–5 (POO-123). */
  level: number;
  /** The band's share. `value` is proportional (the bar renders `value / Σ value`), fed the backend %. */
  value: number;
}

/**
 * The backend's GRAND portfolio KPI aggregates (page-independent), extracted from the envelope. These
 * feed the Portfolio summary KPIs directly (POO-668 R3): a KPI is NEVER recomputed over the paged /
 * loaded set. The balance/fee fields fall back to 0 when the envelope omits them, so a lean read never
 * yields NaN.
 */
export interface PortfolioAggregates {
  /** Grand balance across all positions (USD). Drives "Portfolio value" + "Current value". */
  totalBalanceUsd: number;
  /** Grand claimable fees across all positions (USD). Drives the hero "unclaimed fees" pill. */
  claimableFeesUsd: number;
  /** Grand total fees across all positions (USD). Fallback for "Total yield". */
  totalFeesInUsd: number;
  /** Grand performance fees across all positions (USD). Carried for future KPI use. */
  totalPerformanceFeesInUsd: number;
  /**
   * Grand invested cost basis across all holdings (USD), page-independent (POO-832 R1). Drives the
   * "Invested" KPI distinctly from "Current value". `undefined` when the backend omits it (not-yet
   * redeployed) → the KPI mapper falls back to `totalBalanceUsd` (mirror). A real 0 is a value, distinct
   * from `undefined`.
   */
  totalInvestedUsd?: number;
  /**
   * Grand value-weighted average fee APR across all holdings (%), page-independent (POO-696). `undefined`
   * when the backend omits it (older backend) → the KPI mapper falls back to the client-side computation
   * over the active holdings. A real 0 is a value, distinct from `undefined`. Note APR, NOT APY.
   */
  avgApr?: number;
  /**
   * Grand allocation-by-risk across all holdings, page-independent (POO-696), already mapped to the FE
   * bar's `{ level, value }` shape from the backend's `{ risk, pct }`. `undefined` when the backend omits
   * it (older backend) OR when a shape drift degraded it (tolerant schema) → the KPI mapper falls back
   * to the client-side computation.
   */
  allocation?: PortfolioAllocationSegment[];
}

/**
 * Extract the {@link PortfolioAggregates} from a parsed portfolio envelope, defaulting the balance/fee
 * fields to 0. Kept beside the schema so both the paged read and any future aggregate-only read map the
 * grand totals identically. `avgApr` passes through as-is; the backend's 3-band `{ risk, pct }`
 * `allocation` is mapped onto the FE bar's `{ level, value }` shape here (POO-696). Both are `undefined`
 * when absent/degraded: the KPI mapper decides the client-compute fallback, not this extractor.
 */
export function mapPortfolioAggregates(
  portfolio:
    | Pick<
        ApiPortfolio,
        | "totalBalanceUsd"
        | "claimableFeesUsd"
        | "totalFeesInUsd"
        | "totalPerformanceFeesInUsd"
        | "totalInvestedUsd"
        | "avgApr"
        | "allocation"
      >
    | null
    | undefined,
): PortfolioAggregates {
  return {
    totalBalanceUsd: portfolio?.totalBalanceUsd ?? 0,
    claimableFeesUsd: portfolio?.claimableFeesUsd ?? 0,
    totalFeesInUsd: portfolio?.totalFeesInUsd ?? 0,
    totalPerformanceFeesInUsd: portfolio?.totalPerformanceFeesInUsd ?? 0,
    // POO-832 R5: undefined when the backend omits it (today); the KPI mapper falls back to
    // `totalBalanceUsd` (mirror). A real 0 is preserved (a genuine value, not 'absent').
    totalInvestedUsd: portfolio?.totalInvestedUsd,
    // POO-696: undefined when the backend omits/degrades them → the KPI mapper falls back to the
    // client-side computation. A real 0 / [] is preserved (a genuine value, not 'absent').
    avgApr: portfolio?.avgApr,
    allocation: mapAllocationBands(portfolio?.allocation),
  };
}

/**
 * Map the backend's 3-band `{ risk, pct }` allocation onto the FE bar's 5-band `{ level, value }` shape
 * (steady→1, dynamic→3, wild→5; `value` = the band's % share), the same shape the client-side
 * {@link computeApyAndAllocation} produces so the KPI mapper's `?? computed` fallback stays uniform.
 * `undefined` in → `undefined` out (absent or drift-degraded → client-compute fallback). POO-696.
 */
function mapAllocationBands(
  bands: ApiPortfolio["allocation"],
): PortfolioAllocationSegment[] | undefined {
  return bands?.map((band) => ({ level: RISK_PROFILE_LEVEL[band.risk], value: band.pct }));
}
