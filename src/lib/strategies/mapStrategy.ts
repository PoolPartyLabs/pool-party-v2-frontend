/**
 * @id PP-STR (POO-298) · POO-771 · POO-897
 * @name mapStrategy
 * @implements-rules-version v1 (POO-298) · v1 (POO-771: embedded manager identity) · v1 (POO-798: verified badge gated on managerVerification enum) · v1 (POO-897: ticks-only onchain block)
 *
 * Anti-corruption mapper: pool-party-api LP pool → FE Strategy (D1: pool = strategy).
 * id = positionId. riskLevel is derived from the token pair (the API does not return it).
 * minInvestment is the platform global floor. `description` IS served by the API (the manager sets
 * it at creation, stored with the name) and is mapped through. type / detail have no API source and
 * are omitted on real strategies (all optional on the schema).
 *
 * POO-771/POO-758 (R6 v1 parity): reads the FLAT embedded manager identity (`managerHandle` /
 * `managerDisplayName` / `managerAvatarUrl` / `managerVerified`) into the FE `manager` (`@handle` or
 * truncated wallet), `managerHandle`, `managerAvatarUrl` and `managerVerified` — same semantics as the
 * v2 mapper. Never fabricated: absent fields (older backend) degrade to wallet-only attribution.
 *
 * Real mode must NEVER fabricate prospectus data: when the API omits `detail`, it stays
 * undefined and the Strategy Detail screen hides the gated sections. The rest of the prospectus
 * (composition / mandate / risk limits / fees / manager profile) is served by the backend — see
 * POO-379. Mock data lives only in the mock service, never here.
 *
 * `network` is taken from the row, falling back to `queriedNetwork` — the slug the caller fetched
 * (`pools?network=…`), which is authoritative. The legacy backend omits `network` on list rows; the
 * fallback keeps those pools in the catalog instead of leaving Strategy.network undefined (POO-316).
 */
import { MIN_AMOUNT_FOR_ADD_LIQUIDITY } from "@/lib/config/operationMinimums";
import type { Strategy } from "@/lib/schemas";
import type { ApiPool } from "./poolsSchema";
import { getRiskLevel } from "./riskProfile";
import { deriveAssetTagsForPair } from "./tags/deriveAssetTags";

/** Shorten a 0x address to `0x1234…abcd` for display (matches the wallet-menu format). */
export function truncateAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Parse the API fee-tier label ("0.30%") into basis points (30). Undefined when absent, garbled, or
 * non-positive — real mode never fabricates a tier (unlike the manager mapper's 0.05% default, this
 * feeds fee MATH, so a wrong guess would misstate the POO-516 collect minimum).
 */
function poolFeeBpsFromTier(tier: string | undefined): number | undefined {
  if (!tier) return undefined;
  const pct = Number.parseFloat(tier.replace("%", ""));
  if (!Number.isFinite(pct) || pct <= 0) return undefined;
  return Math.round(pct * 100);
}

/**
 * Map one API pool to the FE Strategy.
 * @param queriedNetwork - the network slug the pool was fetched under; used when the row omits `network`.
 */
export function mapStrategy(pool: ApiPool, queriedNetwork?: string): Strategy {
  // POO-771 R3: the flat embedded manager identity (POO-758 R6 v1 parity); `@handle` when a handle is
  // saved, else the truncated wallet. The display name is NEVER used for the attribution (POO-757 R1).
  const managerHandle = pool.managerHandle || undefined;
  // POO-830 R7: derive the canonical ASSET tags from the pool pair. The legacy v1 `/pools` currencies
  // carry only a SYMBOL (no address), so classification uses the mock-only/legacy symbol fallback —
  // the production-grade address path is used by the v2 mapper. Additive; never fabricated.
  const assetTags = deriveAssetTagsForPair(
    { symbol: pool.currency0.symbol },
    { symbol: pool.currency1.symbol },
  );
  return {
    // D1: the strategy IS the pool; its id is the position address.
    id: pool.positionId,
    name: pool.name,
    // Real description the manager set at creation (stored with the name) — drives the About section.
    description: pool.description ?? undefined,
    // POO-771 R3/R4: `@handle` when saved, else the truncated address (real data, not mock). The FULL
    // address is kept in `managerAddress` (POO-620) so the attribution links to `/m/<address>` even
    // without a handle.
    manager: managerHandle ? `@${managerHandle}` : truncateAddress(pool.poolManager),
    managerHandle,
    managerAddress: pool.poolManager,
    // POO-771 R3/R8: the manager's public avatar (embedded flat on v1 rows); empty/null → undefined.
    managerAvatarUrl: pool.managerAvatarUrl || undefined,
    // POO-798 R1/R2: verified iff the flat `managerVerification` enum is "valid" (retires the
    // `managerVerified` boolean as the gate). Absent/null/none/pending → false → no badge (R4).
    managerVerified: pool.managerVerification === "valid",
    riskLevel: getRiskLevel(pool.currency0.symbol, pool.currency1.symbol),
    // No per-pool minimum in the API — apply the platform floor (POO-184), env-configurable so dev
    // can test with small amounts (NEXT_PUBLIC_MIN_AMOUNT_FOR_ADD_LIQUIDITY).
    minInvestment: MIN_AMOUNT_FOR_ADD_LIQUIDITY,
    tvl: pool.poolTvlUsd,
    // Investor-facing Uniswap pool TVL: the underlying dex pool's reserve_in_usd, live on /pools as
    // `dexPoolTvlUsd`, mapped to its own field; `tvl` above stays the PP-managed value that feeds the
    // manager's AUM (POO-390 R3/R4). Undefined when the API omits it (no silent fallback to the
    // managed value, R5).
    uniswapPoolTvlUsd: pool.dexPoolTvlUsd,
    investors: Math.max(0, Math.trunc(Number(pool.totalInvestors)) || 0),
    estReturn: pool.feesApr,
    rateType: "APR",
    status: pool.closed ? "closed" : "active",
    // Legacy list rows omit `network`; fall back to the slug the caller queried (POO-316).
    network: pool.network ?? queriedNetwork,
    pool: pool.pool,
    // The pool pair (real symbols from the API) — drives the single-pool Composition + Investment-
    // mandate cards on the Strategy Detail. Structural, not fabricated prospectus (#244-safe).
    poolPair: { token0: pool.currency0.symbol, token1: pool.currency1.symbol },
    // The pool's own fee tier in bps — the INTERIM DEX-fee source for the collect minimum math
    // (POO-516 R2) until the backend exposes the swap route's fee tier (POO-521). Undefined when
    // the row omits the label (lean list rows) — never fabricated.
    poolFeeBps: poolFeeBpsFromTier(pool.poolFeeTier),
    // POO-897 R4: the v1 row serves ticks but no reserves: a ticks-only onchain block so the
    // Composition split degrades to range math (the v1 fallback path). Undefined without a current
    // tick (lean list rows): never fabricated.
    onchain:
      pool.tickCurrent != null
        ? {
            tickLower: pool.tickLower,
            tickUpper: pool.tickUpper,
            tickCurrent: pool.tickCurrent,
          }
        : undefined,
    // POO-830 R7: canonical asset tags from the pair (symbol fallback — v1 has no token address).
    assetTags: assetTags.assetTags,
    unverifiedTokens: assetTags.unverified || undefined,
    // type / detail: no API source — omitted (optional on the schema). The backend serves the full
    // prospectus (POO-379); we never fabricate it. managerHandle / avatar / verified now come from the
    // flat embedded fields above (POO-771/POO-758 R6).
  };
}
