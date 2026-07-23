/**
 * @id PP-STR-LIB-008 (POO-579, POO-750, POO-771, POO-819, POO-897, POO-902, POO-905)
 * @name mapStrategyV2
 * @implements-rules-version v2 (POO-750) · v1 (POO-771: embedded manager identity) · v1 (POO-798: verified badge gated on managerVerification enum) · v1 (POO-819: top-level lockupDays) · v1 (POO-897: onchain reserve/tick block) · v1 (POO-902: managerFee bps → top-level performanceFeePct) · v1 (POO-905: protocolFeePct)
 *
 * Anti-corruption mapper: pool-party-api v2 strategy row -> FE Strategy. The v2 twin of
 * {@link mapStrategy} (the v1 `/pools` mapper), for the v2 catalog swap.
 *
 * POO-771/POO-758: reads the backend-embedded `manager` identity object (handle / displayName /
 * avatarUrl / derived verified) into the FE `manager` (`@handle` or truncated wallet), `managerHandle`,
 * `managerAvatarUrl` and `managerVerified` fields — so every attribution site renders the handle,
 * avatar and verified badge with ZERO extra requests (retires the PR #512 registry fan-out). Never
 * fabricated: a null `manager` object (no registry profile) stays wallet-only.
 *
 * Key differences from the v1 mapper, driven by the v2 contract (`StrategiesV2ResponseDto`):
 *  - `Strategy.id` is the on-chain `positionId` for a CHAIN-BOUND row, falling back to the owned UUID
 *    only for a not-yet-bound (pending) row that has no positionId. Keying live rows by positionId keeps
 *    `Strategy.id` in the SAME id space the rest of the app joins on — the portfolio positions
 *    (`position.strategyId`=positionId), the analytics timeseries (keyed by the position contract), and
 *    the invest build (`positionId`) all resolve, and `pool` (below) makes the strategy investable. A
 *    pending row keeps its UUID id so it still routes to the v2 per-id read. Per-id routing (POO-776):
 *    a chain-bound positionId resolves via the case-insensitive
 *    `GET /api/v2/strategies/by-position/:positionId`, a pending UUID via the UUID-only
 *    `GET /api/v2/strategies/:id` — both v2. This converges the two id spaces the deployed v2 contract
 *    already bridges (it exposes `positionId` + `poolAddress` on every chain-bound row).
 *  - `riskLevel` is manager-DECLARED (`steady|dynamic|wild`), mapped to the FE 1/3/5 band via
 *    {@link RISK_PROFILE_LEVEL} — no token-pair inference (the v1 mapper derives it). A surprise/absent
 *    value falls back to the pair classifier, then to the conservative `wild` band.
 *  - TVL / APY / investors / in-range all live under the DERIVED `onchain` block (null while pending),
 *    so they default rather than being fabricated.
 *  - `status` collapses the computed `lifecycleState` to the FE tri-state: only `live` is investable
 *    (`active`); `pending` / `missing` / `closed` are all non-allocatable (`closed`) so the Explore
 *    discovery filter (`status !== "closed"`) drops not-yet-live and vanished strategies.
 *
 * Never fabricates prospectus data (detail / type / managerHandle have no v2 source → omitted), the
 * same no-mock-in-real discipline as the v1 mapper.
 */
import { MIN_AMOUNT_FOR_ADD_LIQUIDITY } from "@/lib/config/operationMinimums";
import type { Strategy } from "@/lib/schemas";
import { truncateAddress } from "../mapStrategy";
import { getRiskLevel, RISK_PROFILE_LEVEL } from "../riskProfile";
import { deriveAssetTagsForPair } from "../tags/deriveAssetTags";
import type { StrategyV2 } from "./strategiesV2Schema";

/** Map the manager-declared risk profile to the FE 1/3/5 band, with a pair-classifier fallback. */
function resolveRiskLevel(
  declared: StrategyV2["riskLevel"],
  symbol0: string | undefined,
  symbol1: string | undefined,
): 1 | 3 | 5 {
  if (declared) return RISK_PROFILE_LEVEL[declared];
  // No declared profile (lean/legacy row): infer from the pair, else the conservative `wild` band.
  if (symbol0 && symbol1) return getRiskLevel(symbol0, symbol1);
  return RISK_PROFILE_LEVEL.wild;
}

/**
 * Collapse the computed `lifecycleState` (falling back to the owned `status`) to the FE tri-state.
 * Only a `live` strategy is allocatable; everything else is `closed` so Explore discovery drops it.
 */
function resolveStatus(
  lifecycleState: StrategyV2["lifecycleState"],
  status: StrategyV2["status"],
): Strategy["status"] {
  if (lifecycleState) return lifecycleState === "live" ? "active" : "closed";
  // Defensive fallback if the contract ever omits the computed state.
  return status === "live" ? "active" : "closed";
}

/** Coerce the (string) investor count to a non-negative integer, mirroring the v1 mapper. */
function toInvestorCount(total: string | number | null | undefined): number {
  return Math.max(0, Math.trunc(Number(total)) || 0);
}

/**
 * Convert the raw Uniswap fee tier (hundredths of a bip, e.g. 3000 = 0.30%) to basis points (30).
 * Undefined when absent or non-positive — real mode never fabricates a tier (it feeds fee math).
 */
function feeBpsFromTier(tier: number | null | undefined): number | undefined {
  if (tier == null || tier <= 0) return undefined;
  return Math.round(tier / 100);
}

/**
 * POO-897 [R2]/[R4]: the raw onchain reserve + tick block for the Composition per-token split,
 * joined with the currency decimals the value split needs. Undefined without a current tick (BOTH
 * split paths need it: the reserve split prices at `tickCurrent`, the range-math fallback
 * interpolates around it): never fabricated.
 */
function toOnchainBlock(
  onchain: StrategyV2["onchain"],
  decimals0: number | null | undefined,
  decimals1: number | null | undefined,
): Strategy["onchain"] {
  if (onchain?.tickCurrent == null) return undefined;
  return {
    totalSupply0: onchain.totalSupply0 ?? undefined,
    totalSupply1: onchain.totalSupply1 ?? undefined,
    tickLower: onchain.tickLower ?? undefined,
    tickUpper: onchain.tickUpper ?? undefined,
    tickCurrent: onchain.tickCurrent,
    decimals0: decimals0 ?? undefined,
    decimals1: decimals1 ?? undefined,
  };
}

/** Map one v2 strategy row to the FE Strategy. */
export function mapStrategyV2(strategy: StrategyV2): Strategy {
  const onchain = strategy.onchain ?? null;
  const symbol0 = strategy.currency0?.symbol ?? undefined;
  const symbol1 = strategy.currency1?.symbol ?? undefined;
  const managerWallet = strategy.managerWallet ?? "";

  // POO-771 R3: pass through the backend-embedded manager identity (POO-758); never fabricate. `null`
  // (no registry profile) → wallet-only. A saved handle drives the `@handle` attribution; the full
  // wallet is still kept in `managerAddress` so the /m/<handle> link and address fallback both work.
  const managerIdentity = strategy.manager ?? null;
  const managerHandle = managerIdentity?.handle || undefined;

  // POO-830 R7: derive the canonical ASSET tags from the pool pair, PREFERRING the token ADDRESS
  // (the production-trusted source) over the spoofable symbol (`resolveTokenClass`). Only when both
  // currencies are present (absent on a pending row) — never fabricated.
  const hasPair = strategy.currency0 != null && strategy.currency1 != null;
  const assetTags = hasPair
    ? deriveAssetTagsForPair(
        { chainId: strategy.chainId, address: strategy.currency0?.address, symbol: symbol0 },
        { chainId: strategy.chainId, address: strategy.currency1?.address, symbol: symbol1 },
      )
    : undefined;

  return {
    // Chain-bound rows key by the on-chain positionId (the id space positions/analytics/invest join
    // on); a pending row with no positionId falls back to the owned UUID. Per-id read routing (POO-776):
    // the positionId resolves via v2 by-position/:positionId (case-insensitive), the UUID via v2 /:id.
    id: strategy.positionId ?? strategy.id,
    name: strategy.name ?? "",
    // Real manager description; empty/null → undefined so the About section hides (no fabrication).
    description: strategy.description || undefined,
    // Manager-uploaded logo (POO-713/POO-715). Empty/null → undefined so the avatar falls back to the
    // initials monogram rather than rendering a broken image.
    logoUrl: strategy.logoUrl || undefined,
    // POO-771 R3/R4: `@handle` when the manager has a saved handle, else the truncated wallet. The
    // display name is NEVER used for this text (POO-757 R1).
    manager: managerHandle ? `@${managerHandle}` : truncateAddress(managerWallet),
    managerHandle,
    managerAddress: managerWallet || undefined,
    // POO-771 R3/R8: the manager's public avatar (embedded); empty/null → undefined so the detail
    // ManagerCard falls back to the initials monogram (POO-702 leaves many null until the save fix).
    managerAvatarUrl: managerIdentity?.avatarUrl || undefined,
    // POO-798 R1/R2: verified iff the embedded `managerVerification` enum is "valid" (retires the
    // derived `verified` boolean as the gate). Absent/null/none/pending → false → no badge (R4). The
    // single badge source across investor surfaces.
    managerVerified: managerIdentity?.managerVerification === "valid",
    riskLevel: resolveRiskLevel(strategy.riskLevel, symbol0, symbol1),
    // No per-strategy minimum in the API — apply the platform floor (env-configurable), like v1.
    minInvestment: MIN_AMOUNT_FOR_ADD_LIQUIDITY,
    // PP-managed position value that feeds the manager's AUM; 0 while pending (no onchain block yet).
    tvl: onchain?.poolTvlUsd ?? 0,
    // Investor-facing underlying Uniswap pool TVL; undefined when absent (no silent fallback to `tvl`).
    uniswapPoolTvlUsd: onchain?.dexPoolTvlUsd ?? undefined,
    investors: toInvestorCount(onchain?.totalInvestors),
    estReturn: onchain?.feesApr ?? 0,
    rateType: "APR",
    status: resolveStatus(strategy.lifecycleState, strategy.status),
    network: strategy.network ?? undefined,
    // The Uniswap v3 position NFT token id (POO-750), for the manager "View on Uniswap" deep link.
    // Numeric string; null/absent → undefined. Changes when the range is moved (a new NFT is minted).
    nftPositionId: strategy.tokenId ?? undefined,
    // The pool pair (real symbols) — drives the single-pool Composition + mandate cards. Absent when
    // the pending row carries no currencies yet.
    poolPair: symbol0 && symbol1 ? { token0: symbol0, token1: symbol1 } : undefined,
    // Interim DEX-fee source for the collect-minimum math; undefined when the tier is absent.
    poolFeeBps: feeBpsFromTier(strategy.feeTier),
    // POO-897 R2/R4: the raw reserve + tick block (with the currency decimals) for the Composition
    // per-token split on the not-invested detail. Undefined without a current tick: never fabricated.
    onchain: toOnchainBlock(onchain, strategy.currency0?.decimals, strategy.currency1?.decimals),
    // The PP-managed position address (the invest `poolPartyPositionAddress`), same source as the v1
    // `/pools` `pool`. Present on a chain-bound row; undefined while pending (invest guards on it).
    pool: strategy.poolAddress ?? undefined,
    // POO-819 R3: the real lock-up (in days) the backend already exposes top-level — carried onto the
    // FE `Strategy.lockupDays` (NOT a fabricated `detail`) so the Invest Review + Strategy Detail
    // render the real term instead of always "None". Null/absent → undefined (0 stays 0). The v1
    // `/pools` mapper has no lock-up source, so it leaves this undefined (honest).
    lockupDays: strategy.lockupDays ?? undefined,
    // POO-902 R2/R3: the manager's performance fee, served as `managerFee` BASIS POINTS on the v2
    // DTO, carried top-level in PERCENT (bps / 100: 1000 → 10; 0 stays 0, a real "0%" fee). A
    // null/absent/invalid value → undefined so the detail tile is omitted — never fabricated.
    performanceFeePct:
      strategy.managerFee != null && strategy.managerFee >= 0
        ? strategy.managerFee / 100
        : undefined,
    // POO-905 R2: the API-served protocol fee RATE (percent) — the Invest Review's pre-build
    // estimate source (amount × pct / 100). Null/absent (older backend) → undefined: the Review
    // shows no line (R4), never a client-side constant fallback (POO-799). The v1 `/pools` mapper
    // has no rate source, so it leaves this undefined (honest).
    protocolFeePct: strategy.protocolFeePct ?? undefined,
    // POO-830 R7: canonical asset tags from the pair (address-preferred). Undefined on a pending row
    // with no currencies (`hasPair` false).
    assetTags: assetTags?.assetTags,
    unverifiedTokens: assetTags?.unverified || undefined,
    // POO-830 R3/R7: the OBJECTIVE is NOT pair-derivable (it depends on the manager's mint composition
    // at creation), so it can only come from persistence. The manager builder already persists it via
    // the signed metadata POST (`buildStrategyMetadata.objectiveTags`); left undefined here until the
    // backend serves it on the v2 strategy read.
    // PP-INTEGRATION-POINT (POO-830 R7): map `strategy.objectiveTags` from the v2 DTO once the backend
    // persists + serves the manager-declared objective (add it to `strategiesV2Schema` and read it here)
    // (POO-836).
    // type / detail: no v2 catalog source — omitted (never fabricated). managerHandle / avatar /
    // verified now come from the embedded `manager` object above (POO-771/POO-758).
  };
}
