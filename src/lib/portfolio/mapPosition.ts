/**
 * @id PP-STR (POO-216)
 * @name mapPosition
 * @implements-rules-version v2
 *
 * Anti-corruption mapper: pool-party-api LP portfolio position → FE Position.
 * D1 decision: pool = strategy, so id and strategyId are the positionId. POO-719 (rules-v2):
 * `invested` is the ledger cost basis (`investedUsd`) when pp_api serves it, falling back to the
 * displayed balance when the ledger has no rows for this wallet+position (R10v2 — legacy
 * pre-backfill positions keep today's behavior, never a misleading 0). totalYield =
 * totalFeesInUsd ("Total fees"). The canonical displayed/withdrawable value is
 * `totalBalanceWithRefundUsd` (includes the pending refund), falling back to `totalBalanceUsd`
 * when absent (POO-318).
 * `available` and `reinvestment` have no distinct source and are flagged.
 */
import type { ClaimableFeeToken, Position } from "@/lib/schemas";
import type { ApiPosition } from "./positionsSchema";
import { synthesizeStrategyFromPosition } from "./synthesizeStrategyFromPosition";

/**
 * Convert a raw base-units fee string to a human token amount (raw / 10^decimals). Display-only —
 * no monetary arithmetic happens on the result (it is formatted via `formatTokenAmount`), so the
 * double is fine. Mirrors v1's `BigNumber.toNumber(fromBigint(raw, d), d)`.
 */
function rawToAmount(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/**
 * The per-token claimable-fee breakdown (POO-417 R3/R5), or undefined when the source is incomplete
 * (R6c). Both legs render even when one amount is 0 (R6b).
 */
function mapClaimableFeeTokens(row: ApiPosition): ClaimableFeeToken[] | undefined {
  const { currency0, currency1 } = row.poolPartyPosition;
  if (row.fees0 == null || row.fees1 == null || !currency0 || !currency1) return undefined;
  return [
    { symbol: currency0.symbol, amount: rawToAmount(row.fees0, currency0.decimals) },
    { symbol: currency1.symbol, amount: rawToAmount(row.fees1, currency1.decimals) },
  ];
}

/** Map one API portfolio position to the FE Position. */
export function mapPosition(row: ApiPosition): Position {
  const id = row.poolPartyPosition.positionId;
  // The refund-aware balance is what the interface displays + treats as withdrawable (POO-318).
  const balance = row.totalBalanceWithRefundUsd ?? row.totalBalanceUsd;
  return {
    id,
    // Pool = strategy: the position's strategy is the pool it sits in (same id).
    strategyId: id,
    // POO-719 rules-v2: true cost basis from the liquidity-event ledger; null/absent (legacy
    // position pre-backfill, degraded enrichment, older backend) falls back to the current
    // balance per R10v2 — never a fabricated 0.
    // PP-INTEGRATION-POINT: `investedUsd` ← pool-party-api portfolio reads (POO-719).
    invested: row.investedUsd ?? balance,
    currentValue: balance,
    // Claimable fees (post-manager-fee), the "Yield" figure the Collect/Compound/Withdraw modals
    // consume. POO-569 renamed the portfolio-position field additively (`totalFeesInUsd` →
    // `claimableFeesUsd`, both emitted with the same value for one release), so prefer the new name and
    // fall back to the deprecated alias — safe whether or not pp_api is redeployed (POO-367 R7). Both
    // are now optional (POO-569), so default to 0 when neither is present (matches mapPortfolioAggregates).
    totalYield: row.claimableFeesUsd ?? row.totalFeesInUsd ?? 0,
    // PP-MOCK: no distinct "available" figure — the full balance is withdrawable.
    available: balance,
    // The true claimable (uncollected) fees, when the API includes the breakdown (POO-318).
    uncollectedFeesUsd: row.feesInfo?.uncollectedFeesUSD,
    // PP-MOCK: no per-position payout setting — default to manual payout (auto-compound removed).
    reinvestment: "manual-payout",
    status: row.poolPartyPosition.closed ? "closed" : "active",
    isPoolManager: row.isPoolManager ?? false,
    claimableFeeTokens: mapClaimableFeeTokens(row),
    // Raw on-chain state for the legacy (Arbitrum/Base) move-range swap sizing (POO-437): the pool
    // position's current reserves + tick + token decimals. Real mode only (undefined on mock).
    totalSupply0: row.poolPartyPosition.totalSupply0,
    totalSupply1: row.poolPartyPosition.totalSupply1,
    tickCurrent: row.poolPartyPosition.tickCurrent,
    decimals0: row.poolPartyPosition.currency0?.decimals,
    decimals1: row.poolPartyPosition.currency1?.decimals,
    // POO-226 R4: `openedAt` (the wallet's first entry into the strategy) is intentionally left
    // undefined here and NEVER fabricated — the LP portfolio endpoint carries no entry timestamp.
    // PP-INTEGRATION-POINT (POO-641): openedAt ← analytics indexed movements (backfillable).
    // Real-data Strategy synthesized from this position's own pool descriptor, used by the Portfolio
    // join when the holdings catalog can't resolve the pool (closed/wound-down pools are absent from
    // `/pools`) so the closed holding is never dropped (POO-526 R1/R2). Undefined on lean reads.
    fallbackStrategy: synthesizeStrategyFromPosition(row),
  };
}
