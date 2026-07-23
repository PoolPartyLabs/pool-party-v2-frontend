/**
 * @id PP-PORT-LIB-003 (POO-668, POO-990)
 * @name mapAggregatesToKpis
 * @implements-rules-version v3 (POO-898 rules v1)
 *
 * Map the backend GRAND {@link PortfolioAggregates} (pp_api `/portfolio/:wallet/all`) + the C1
 * `/financials` payload + the client-computed APY/allocation onto the Portfolio summary KPI scalar
 * props (POO-668 R3). REAL-MODE ONLY: the mock Portfolio page builds its view model separately
 * (`buildPortfolioViewModel`), so `financials` here is the SOLE source for the analytics money fields.
 * The balance / fees / claimable / apy aggregates are page-independent grand totals, never recomputed
 * over the paged / loaded set, so they stay correct when only page 0 is loaded.
 *
 * PP-CORE-LIB-048 (POO-990, legacy excision): the legacy analytics `/metrics` leg is gone. `invested`
 * and `totalYield` come from C1 `/financials` EXCLUSIVELY (nullable → the KPI renders "not available
 * yet", never $0, never a legacy number). The dropped bits: the `totalInvestedUsd ?? balance` invested
 * fallback and the `collectedById` cross-backend Total-Yield join (both were the legacy `/metrics`
 * path). The pp_api aggregates (`totalBalanceUsd`, `claimableFeesUsd`, `avgApr`, `allocation`) are NOT
 * legacy — they stay as the non-null-typed hero/pill/apy source (with the C1 value preferred).
 *
 * Field mapping:
 * - `totalBalanceUsd` (pp_api) → `totalValue` (hero) + `currentValue` (KPI). SOURCE-OF-TRUTH SPLIT:
 *   Current Value is the pp_api on-chain sum of positions (the real value held now), NOT the C1
 *   `financials.portfolioValue`. Analytics is the historical ledger (Invested); pp_api is the live
 *   contract sum (Current Value). They measure different things, so each KPI reads its own source.
 * - `financials.invested` → `invested` (KPI), DIRECTLY (nullable → "not available yet", [R5]).
 * - `financials.claimableGross ?? (claimableFeesUsd ?? totalFeesInUsd)` → `totalEarned` (hero
 *   "unclaimed fees" pill): the CLAIMABLE aggregate ONLY (POO-898 R1). pp_api claimable is the non-null
 *   fallback. POO-569 renamed the field additively; prefer the new name, fall back to the alias.
 * - `financials.totalYield` → `totalYield` (KPI), DIRECTLY (nullable → "not available yet", [R5]) — the
 *   SAME field Home reads (identical values, POO-936 [R1]).
 * - `avgApr` + `allocation`: read from the pp_api GRAND aggregates when present (POO-696), else FALL
 *   BACK to the client-computed values passed in ({@link ApyAndAllocation}, over the LOADED active
 *   rows). Never hardcoded to 0 / [] (which showed "0% APR" + a flat allocation for a funded wallet).
 *   A backend 0 / [] is a real value and does NOT trigger the fallback (nullish check). The backend
 *   field is `avgApr` (fee APR), feeding the KPI prop named `avgApy` (the UI label is already "Avg.
 *   APR"); `allocation` is mapped to the internal `{ level, value }` shape by `mapPortfolioAggregates`.
 *
 * POO-898 (rules v1): the hero "unclaimed fees" pill (`totalEarned`) is the CLAIMABLE aggregate ONLY
 * (available to collect now), so [R3] a collect DECREASES the pill while "Total yield" stays stable,
 * and [R6] the pill agrees with the per-position Yield column (same claimable data family). [R5]
 * zeroed/absent aggregates degrade to $0 (never NaN).
 */

import type { WalletFinancials } from "@/lib/financials/financialsSchema";
import type { PortfolioAggregates } from "@/lib/portfolio/positionsSchema";
import type { AllocationSegment } from "./components/AllocationByRisk";
import type { ApyAndAllocation } from "./computeApyAndAllocation";

/** The KPI scalar props derived from the pp_api grand aggregates + C1 financials + computed APY. */
export interface PortfolioKpis {
  totalValue: number;
  totalEarned: number;
  /**
   * `invested` / `totalYield`: `null` = the C1 `/financials` payload served this field honest-absent
   * (the ledger has not populated it yet) OR financials are unavailable (outage / not-signed-in); the
   * KPI renders the "not available yet" affordance, NEVER $0, NEVER a legacy number (PP-CORE-LIB-048).
   */
  invested: number | null;
  currentValue: number;
  totalYield: number | null;
  avgApy: number;
  allocation: AllocationSegment[];
}

/**
 * Map the pp_api grand aggregates + the C1 financials + the client-computed APY/allocation onto the
 * Portfolio KPI props. REAL-MODE ONLY (the mock page uses `buildPortfolioViewModel`).
 *
 * @param aggregates - The pp_api grand aggregates (balance / claimable / apy, page-independent).
 * @param computed - The value-weighted APY + allocation-by-risk over the LOADED active rows
 *   ({@link computeApyAndAllocation}); the FALLBACK when the POO-696 grand aggregates are absent.
 * @param financials - PP-CORE-LIB-048: the C1 `/financials` payload — the SOLE source for `invested`
 *   and `totalYield` (nullable → "not available yet") and the PREFERRED source for the hero total +
 *   claimable pill. `null` = financials unavailable → `invested`/`totalYield` render unavailable
 *   (never a legacy number), while the non-nullable hero/pill fall to the pp_api aggregate.
 */
export function mapAggregatesToKpis(
  aggregates: PortfolioAggregates,
  computed: ApyAndAllocation,
  financials: WalletFinancials | null,
): PortfolioKpis {
  const balance = aggregates.totalBalanceUsd;
  // Prefer the renamed claimable-fees aggregate; fall back to the deprecated alias (POO-569).
  const claimableFees = aggregates.claimableFeesUsd || aggregates.totalFeesInUsd;
  // PP-PORT-LIB-003 (source-of-truth split): CURRENT VALUE is the pp_api on-chain sum of positions
  // (`totalBalanceUsd`) — the real value the wallet holds RIGHT NOW, read straight from the contracts.
  // We deliberately do NOT prefer the C1 `financials.portfolioValue` here: analytics is the reliable
  // HISTORICAL ledger (what went IN = Invested cost basis), while pp_api is the live sum of what's in
  // the contracts NOW. The two measure different things (analytics' portfolioValue also folds in
  // closed-but-unsettled value per D16), so Current Value tracks pp_api and Invested tracks analytics.
  const servedBalance = balance;
  // The claimable pill is a fee figure (not "current value"): keep the C1 served claimable preferred,
  // with the pp_api claimable aggregate as the non-null fallback.
  const servedClaimable = financials?.claimableGross ?? claimableFees;
  return {
    totalValue: servedBalance,
    currentValue: servedBalance,
    // PP-CORE-LIB-048: `financials.invested` DIRECTLY (nullable → unavailable). A null payload
    // (financials unavailable) → null → the tile renders "not available yet", never a legacy figure.
    invested: financials?.invested ?? null,
    // POO-898 [R1]: the "unclaimed fees" pill is the CLAIMABLE aggregate only ([R3] decreases on a
    // collect). Prefer the C1 served claimable; a null claimableGross falls to the pp_api aggregate.
    totalEarned: servedClaimable,
    // PP-CORE-LIB-048: `financials.totalYield` DIRECTLY (the SAME field Home reads), no cross-backend
    // collected join. A null payload → null → "not available yet", never a legacy figure.
    totalYield: financials?.totalYield ?? null,
    // POO-696: prefer the backend grand aggregate; fall back to the client-side computation over the
    // LOADED active rows when the backend omits/degrades it. Nullish check so a real backend 0 / [] wins.
    // The `avgApy` KPI prop is fed the backend `avgApr` (fee APR); the UI label is already "Avg. APR".
    avgApy: aggregates.avgApr ?? computed.avgApy,
    allocation: aggregates.allocation ?? computed.allocation,
  };
}
