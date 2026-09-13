/**
 * @id PP-CORE-LIB-053 (POO-1031, POO-1157)
 * @name funding inventory
 * @implements-rules-version v3 (POO-1157 / POO-1129 rules v3) · v1 (POO-1031 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * What can this wallet actually PAY WITH, across every ACTIVE chain (`activeChainMetas`, so a
 * flag-gated chain is neither read nor offered as a bridge destination while its flag is off)?
 *
 * Layer 2 of the funding rail (`docs/_hackathon/00_IMPLEMENTATION_PLAN.md` §5): the intersection of
 * what the wallet holds and what Uniswap can route. Holdings come from the shipped, server-only
 * multi-chain reader ({@link fetchWalletHoldings}) — this file adds no second balance source — and
 * routability from `GET /swappable_tokens`, scoped per held token.
 *
 * The intersection is the point for CROSS-CHAIN reach ([R1]): a balance no bridge can move to the
 * operation's chain is offered nowhere but its own. A SAME-CHAIN spend needs no route at all, so a
 * token Uniswap advertises no bridge destination for is still money the user can spend here (POO-1157),
 * kept rather than dropped; the consumer decides reach, short-circuiting same-chain first.
 *
 * Degradation is layered rather than all-or-nothing, because a funded wallet that renders as empty is
 * the worst outcome in this feature: one chain failing is skipped ([R3], the shipped behavior of
 * `fetchWalletHoldings`), every chain failing falls back to the USDC-only on-chain read ([R4]), and
 * one token's routability lookup failing keeps that token as SAME-CHAIN-ONLY rather than dropping it
 * (POO-1157), so a transient upstream blip degrades a row's cross-chain reach instead of removing a
 * funded holding, and the degrade is recorded.
 *
 * Money convention (pinned by `src/lib/provisioning/types.ts`): token-native amounts are decimal
 * STRINGS, USD figures are display-grade numbers. {@link FundingSource.amount} is base units (wei) as
 * a decimal string, which is exactly what `POST /quote` takes, and it is derived from the backend's
 * exact decimal balance rather than from the float beside it ([R2]).
 *
 * Server-only: it calls the Uniswap server-action layer, whose transport reads `UNISWAP_API_KEY`
 * (ADR 0003). A client surface reaches this through {@link getFundingInventoryAction}.
 */
import "server-only";

import { parseUnits } from "viem";
import { activeChainMetas } from "@/lib/chains/config";
import { isFeatureEnabled } from "@/lib/features";
// PP-INTEGRATION-POINT: routable-token allowlist ← Uniswap `GET /swappable_tokens`, through the
// server-action layer (PP-CORE-LIB-052). This is the only upstream call the inventory makes.
import { listSwappableTokens } from "@/lib/uniswap/actions";
import { fetchWalletHoldings } from "./fetchWalletHoldings";
import { getRealTokenBalances } from "./getRealTokenBalances";
import { MIN_DISPLAY_USD } from "./groupWalletBalances";
import type { TokenBalance } from "./types";

/** One thing the wallet can pay with: a held, routable token on one chain. */
export interface FundingSource {
  /** Token contract address on {@link chainId} (`0x000…000` for the chain's native coin). */
  address: string;
  chainId: number;
  symbol: string;
  /** Token decimals, so a caller can render {@link amount} without re-reading the token. */
  decimals: number;
  /**
   * Balance in the token's BASE units (wei), as a decimal string — the shape `POST /quote` takes.
   * Never a float, and never rounded up: see {@link toBaseUnits}.
   */
  amount: string;
  /** USD value of the holding at read time, display-grade ([R2], [R6]). */
  usd: number;
  /**
   * The supported chains this token can be BRIDGED to, ascending. These are Uniswap bridge
   * DESTINATIONS and EXCLUDE the token's own chain (POO-1155). MAY be empty (POO-1157): an empty set
   * means the token is spendable ONLY on its own chain, because Uniswap advertises no bridge
   * destination for it or the routability lookup degraded. Same-chain spendability needs no bridge and
   * is judged by the consumer, which short-circuits `source.chainId === targetChainId` before reading
   * this set ({@link reachesChain}, `computePlanAction`); an empty set is therefore offered same-chain
   * and refused cross-chain, never dropped.
   */
  reachableChainIds: number[];
  /** Whether this is the chain's native coin (ETH / POL), which needs no ERC-20 approval. */
  isNative: boolean;
  logoUrl: string;
}

/**
 * Upper bound on routability lookups per inventory read.
 *
 * The fan-out is one upstream call per spendable holding, against a rate-limited, key-authenticated
 * API. Left unbounded, a wallet holding fifty tokens is exactly how we trip that limit and end up
 * offering NO funding sources — the failure this rule set exists to prevent. Holdings are sorted by
 * USD descending first, so the bound can only ever defer the least valuable rows, and 25 sits far
 * above any wallet a funding selector can usefully render.
 */
export const MAX_ROUTABILITY_LOOKUPS = 25;

/**
 * The chain ids this app operates on AND currently participates in. A route to anywhere else cannot
 * fund an operation here, and a route to a flag-gated chain is not an offer this environment makes
 * (POO-1776 [R1]): `reachableChainIds` is what the funding route's destination chains are drawn
 * from, so the ONE `featureFlag` has to decide it as well, or a flag-off environment could offer a
 * bridge onto a chain whose catalog and holdings it is deliberately not reading.
 *
 * A function read at CALL time, mirroring `fetchStrategies.activeNetworks`, not a module-level
 * const: a const would freeze the flag at import and make the gate untestable without a module
 * reset. `isFeatureEnabled` rather than a passed-in reader, because this module is `server-only`
 * and the Dev menu's client-side QA overrides cannot reach it anyway.
 */
function activeChainIds(): number[] {
  return activeChainMetas(isFeatureEnabled).map((meta) => meta.chain.id);
}

/**
 * Holdings for `address`, with the shipped degradation ([R3], [R4]).
 *
 * `fetchWalletHoldings` already tolerates a per-chain failure and throws only when EVERY chain
 * failed, which is the signal to fall back to the USDC-only on-chain read — the same contract
 * `walletHoldingsActions` uses. `getRealTokenBalances` never throws (it skips failing RPCs), so a
 * total outage on both paths surfaces as an empty inventory rather than an exception.
 */
async function readHoldings(address: `0x${string}`): Promise<TokenBalance[]> {
  try {
    return await fetchWalletHoldings(address);
  } catch {
    return getRealTokenBalances(address);
  }
}

// `toBaseUnits` moved to `./toBaseUnits` (POO-1137): it is pure, and this module is `server-only`,
// so the client-side standalone on-ramp plan could not import it without breaking the bundle.
// Re-exported here so every existing caller is unchanged and there stays ONE truncation rule.
import { toBaseUnits } from "./toBaseUnits";

export { toBaseUnits };

/**
 * The supported chains this token can be BRIDGED to ([R1]), or `null` when the lookup DEGRADED
 * (POO-1157). A genuinely empty array (`[]`) and a degraded read (`null`) were conflated before, and
 * they are different facts: `listSwappableTokens` returns where the token can be moved TO and EXCLUDES
 * the source chain (POO-1155, verified on dev: `USDC on 42161 -> [137, 8453]`, `ETH on 8453 ->
 * [42161]`), so an empty result means "no BRIDGE destination", which for a same-chain spend is not a
 * problem at all. Returning `null` on `!result.ok` lets {@link toFundingSource} tell a transient
 * upstream failure apart from a real answer, so the degrade can be recorded rather than vanishing into
 * an indistinguishable empty set.
 *
 * Both `null` and `[]` map to the same conservative outcome downstream (offered same-chain, refused
 * cross-chain), so failing closed on cross-chain is still the side we err on: an unproven route is not
 * a route. Same-chain spendability needs no bridge and is judged by the consumer ({@link reachesChain}
 * and `computePlanAction` short-circuit on `chainId`), never from this list.
 */
async function reachableChainIds(
  tokenIn: string,
  tokenInChainId: number,
): Promise<number[] | null> {
  const result = await listSwappableTokens({ tokenIn, tokenInChainId });
  if (!result.ok) return null;

  const reachable = new Set(result.tokens.map((token) => token.chainId));
  return activeChainIds()
    .filter((chainId) => reachable.has(chainId))
    .sort((a, b) => a - b);
}

/**
 * Record, once per holding, that its routability lookup degraded (POO-1157).
 *
 * A degraded read and a genuinely empty destination list now behave IDENTICALLY (both keep the
 * holding as same-chain-only), which is the safe default but also makes a transient upstream failure
 * invisible: it silently shrinks the CROSS-CHAIN reach of someone's usable balance. This is the one
 * place the two are still told apart, so that shrink is observable. Never throws and carries no wallet
 * address: a diagnostic must not turn a degraded lookup fatal, and this is not a place to write
 * identities to server logs. Mirrors `observeGateContextFailure` (`gateContext.ts`), the same rail's
 * other degraded-read observer.
 *
 * PP-INTEGRATION-POINT: swap console.warn for the platform structured logger once one exists.
 */
function observeDegradedReach(holding: TokenBalance): void {
  console.warn("[funding] routability lookup degraded; holding kept as same-chain-only", {
    chainId: holding.chainId,
    symbol: holding.symbol,
  });
}

/** A holding as a funding source, or `null` when it cannot fund anything. */
async function toFundingSource(holding: TokenBalance): Promise<FundingSource | null> {
  // No contract address means nothing can be quoted, approved or bridged against it.
  if (!holding.address) return null;

  const amount = toBaseUnits(holding);
  if (amount === null) return null;

  // POO-1157: an empty or degraded reach is NO LONGER a drop. A token Uniswap advertises no bridge
  // destination for is spendable on its OWN chain, and a degraded lookup is an unknown, not proof of
  // non-spendability. Dropping either is exactly how a funded wallet renders as empty. Both keep the
  // holding with `reachableChainIds: []`, which the consumers read as "same-chain only"; the degrade
  // is additionally recorded so a silently shrinking usable balance is observable.
  const reach = await reachableChainIds(holding.address, holding.chainId);
  if (reach === null) observeDegradedReach(holding);

  return {
    address: holding.address,
    chainId: holding.chainId,
    symbol: holding.symbol,
    decimals: holding.decimals,
    amount,
    // [R6] Already priced by the holdings feed. Quoting each row to USDC just to label it would be
    // one upstream call per token on a surface that lists many.
    usd: holding.usd,
    // `null` (degraded) and `[]` (no bridge destination) both mean "same-chain only" to the consumers.
    reachableChainIds: reach ?? [],
    isNative: holding.isNative ?? false,
    logoUrl: holding.logoUrl,
  };
}

/**
 * Everything `address` can pay with, most valuable first.
 *
 * Dust is filtered BEFORE the fan-out ([R5]): it can never be spent — bridging it costs more than it
 * moves — so it must not cost an upstream call either. The threshold is the shipped
 * {@link MIN_DISPLAY_USD}, so the funding selector and the wallet modal hide the same rows.
 *
 * `holdings` lets a caller that has ALREADY read them pass them in (POO-1042: the provisioning gate
 * context needs the raw, unfiltered rows for its per-chain balances, and reading the same wallet
 * twice in one action would double the load for nothing). Omitted, this reads them itself, exactly
 * as before.
 */
export async function getFundingInventory(
  address: `0x${string}`,
  holdings?: readonly TokenBalance[],
): Promise<FundingSource[]> {
  if (!address) return [];

  const spendable = (holdings ?? (await readHoldings(address)))
    .filter((holding) => holding.usd >= MIN_DISPLAY_USD)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, MAX_ROUTABILITY_LOOKUPS);

  const sources = await Promise.all(spendable.map(toFundingSource));
  return sources.filter((source): source is FundingSource => source !== null);
}
