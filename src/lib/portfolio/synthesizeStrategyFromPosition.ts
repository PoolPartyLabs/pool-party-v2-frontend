/**
 * @id PP-PORT (POO-526) · POO-771
 * @name synthesizeStrategyFromPosition
 * @implements-rules-version v1 (POO-526) · v1 (POO-771: embedded manager identity) · v1 (POO-798: verified badge gated on managerVerification enum)
 *
 * Anti-corruption fallback: build the FE Strategy from a held position's OWN pool descriptor.
 *
 * The Portfolio join resolves each holding against the discovery catalog (`/pools`), which the
 * backend serves WITHOUT closed/wound-down pools. A closed-with-balance position (pending Withdraw)
 * is therefore returned by the portfolio feed but has NO match in the catalog, and the join used to
 * drop it — so the closed strategy vanished from the investor Portfolio (POO-526, epic POO-454/R2).
 *
 * The `/portfolio/:wallet/all` position payload already carries the same descriptor fields `/pools`
 * returns per pool (name, manager, token pair, feesApr, tvl, investors, network), so we synthesize a
 * complete, REAL-DATA Strategy from the position itself — structural only, never a fabricated
 * prospectus (`detail`/`managerHandle`/`uniswapPoolTvlUsd` stay undefined; no-mock-in-real). When the
 * essentials (name + both token symbols + manager) are missing, we return undefined and the caller
 * drops the position rather than render fabricated data.
 */
import { MIN_AMOUNT_FOR_ADD_LIQUIDITY } from "@/lib/config/operationMinimums";
import type { Strategy } from "@/lib/schemas";
import { truncateAddress } from "@/lib/strategies/mapStrategy";
import { getRiskLevel } from "@/lib/strategies/riskProfile";
import type { ApiPosition } from "./positionsSchema";

/**
 * Synthesize a minimal, real-data Strategy from a held position's pool descriptor, or undefined when
 * the payload lacks the essentials to render a meaningful, non-fabricated row.
 */
export function synthesizeStrategyFromPosition(row: ApiPosition): Strategy | undefined {
  const pp = row.poolPartyPosition;
  // Need the structural essentials to render a real row (name + both token symbols + manager).
  if (!pp.name || !pp.currency0 || !pp.currency1 || !pp.poolManager) return undefined;
  // POO-771 R3: pass through the position-embedded manager identity (POO-758 R7) when present, so a
  // CLOSED holding absent from the catalog still renders @handle/avatar/verified — with zero extra
  // requests. Absent (older backend) → wallet-only, never fabricated.
  const managerIdentity = row.manager ?? null;
  const managerHandle = managerIdentity?.handle || undefined;
  return {
    // D1: the strategy IS the pool; its id is the position address (matches Position.strategyId).
    id: pp.positionId,
    name: pp.name,
    // POO-771 R3/R4: `@handle` when saved, else the truncated address (real data, not mock). The full
    // address is kept in `managerAddress` (POO-620) for the public-profile link (`/m/<address>`).
    manager: managerHandle ? `@${managerHandle}` : truncateAddress(pp.poolManager),
    managerHandle,
    managerAddress: pp.poolManager,
    // POO-771 R3/R8: the manager's public avatar (embedded on the position row); empty/null → undefined.
    managerAvatarUrl: managerIdentity?.avatarUrl || undefined,
    // POO-798 R1/R2: verified iff the embedded `managerVerification` enum is "valid" (retires the
    // derived `verified` boolean as the gate). Absent/null/none/pending → false → no badge (R4).
    managerVerified: managerIdentity?.managerVerification === "valid",
    riskLevel: getRiskLevel(pp.currency0.symbol, pp.currency1.symbol),
    // No per-pool minimum in the API — apply the platform floor (POO-184), same as mapStrategy.
    minInvestment: MIN_AMOUNT_FOR_ADD_LIQUIDITY,
    // Enrichment figures from the payload; default to 0 when a lean read omits them (schema-safe).
    tvl: Math.max(0, pp.poolTvlUsd ?? 0),
    investors: Math.max(0, Math.trunc(Number(pp.totalInvestors)) || 0),
    estReturn: pp.feesApr ?? 0,
    rateType: "APR",
    status: pp.closed ? "closed" : "active",
    network: pp.network,
    // The pool pair (real symbols) — structural, not a fabricated prospectus.
    poolPair: { token0: pp.currency0.symbol, token1: pp.currency1.symbol },
    // description / type / detail / uniswapPoolTvlUsd: no source on the position payload — omitted
    // (all optional). Real mode never fabricates them (no-mock-in-real). managerHandle / avatar /
    // verified now come from the position-embedded `manager` object above (POO-771/POO-758 R7).
  };
}
