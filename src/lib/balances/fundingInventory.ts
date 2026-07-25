/**
 * @id PP-CORE-LIB-053 (POO-1031)
 * @name funding inventory
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * What can this wallet actually PAY WITH, across Arbitrum, Base and Polygon?
 *
 * Layer 2 of the funding rail (`docs/_hackathon/00_IMPLEMENTATION_PLAN.md` §5): the intersection of
 * what the wallet holds and what Uniswap can route. Holdings come from the shipped, server-only
 * multi-chain reader ({@link fetchWalletHoldings}) — this file adds no second balance source — and
 * routability from `GET /swappable_tokens`, scoped per held token.
 *
 * The intersection is the whole point ([R1]). A balance the router cannot move is not money the user
 * can spend here, and offering it produces a plan that dies at quote time, after the user chose it.
 *
 * Degradation is layered rather than all-or-nothing, because a funded wallet that renders as empty is
 * the worst outcome in this feature: one chain failing is skipped ([R3], the shipped behavior of
 * `fetchWalletHoldings`), every chain failing falls back to the USDC-only on-chain read ([R4]), and
 * one token's routability lookup failing drops that token only.
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
import { supportedChainMetas } from "@/lib/chains/config";
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
   * The supported chains this token can be routed to, ascending. Never empty: a token that reaches
   * none of them is not a funding source at all ([R1]).
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

/** The chain ids this app operates on. A route to anywhere else cannot fund an operation here. */
const SUPPORTED_CHAIN_IDS = supportedChainMetas.map((meta) => meta.chain.id);

/** A plain, unsigned decimal number: what {@link parseUnits} can be trusted with. */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

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

/**
 * A holding's balance in base units, as a decimal string, or `null` when it cannot be expressed
 * exactly ([R2]).
 *
 * Two safety properties, both about never claiming more than the wallet holds:
 *
 *   - the EXACT decimal string is preferred over the float beside it. `Number("1.234567890123456789")`
 *     rounds UP, and a swap sized from that reverts for insufficient balance;
 *   - a fraction longer than the token's decimals is TRUNCATED, not rounded, because `parseUnits`
 *     rounds and rounding up one base unit has the same effect.
 *
 * The float path remains for the degraded USDC-only read, where the balance was a number to begin
 * with. `toFixed` there mirrors the shipped precedent in `seedAmounts.ts:110`; anything it cannot
 * render as a plain decimal (a value past 1e21, an infinity) is rejected rather than guessed at.
 */
export function toBaseUnits(holding: TokenBalance): string | null {
  const decimal = (holding.amountExact ?? holding.amount.toFixed(holding.decimals)).trim();
  if (!PLAIN_DECIMAL.test(decimal)) return null;

  const [whole, fraction = ""] = decimal.split(".");
  const truncated =
    fraction.length > holding.decimals
      ? `${whole}.${fraction.slice(0, holding.decimals)}`
      : decimal;

  try {
    const raw = parseUnits(truncated, holding.decimals);
    return raw > BigInt(0) ? raw.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Which supported chains this token can be routed to ([R1]). Empty means "not a funding source":
 * either Uniswap routes it nowhere we operate, or we could not find out, and an unproven route is
 * not a route. Failing closed is the right side to err on here — the cost is a token missing from
 * the picker, against a plan that fails after the user committed to it.
 *
 * The token's OWN chain is not assumed: it is reported only when the API lists it, because a token
 * with no same-chain pair genuinely cannot fund an operation on its own chain without bridging. In
 * practice any listed token comes back with its own chain among the results.
 */
async function reachableChainIds(tokenIn: string, tokenInChainId: number): Promise<number[]> {
  const result = await listSwappableTokens({ tokenIn, tokenInChainId });
  if (!result.ok) return [];

  const reachable = new Set(result.tokens.map((token) => token.chainId));
  return SUPPORTED_CHAIN_IDS.filter((chainId) => reachable.has(chainId)).sort((a, b) => a - b);
}

/** A holding as a funding source, or `null` when it cannot fund anything. */
async function toFundingSource(holding: TokenBalance): Promise<FundingSource | null> {
  // No contract address means nothing can be quoted, approved or bridged against it.
  if (!holding.address) return null;

  const amount = toBaseUnits(holding);
  if (amount === null) return null;

  const reach = await reachableChainIds(holding.address, holding.chainId);
  if (reach.length === 0) return null;

  return {
    address: holding.address,
    chainId: holding.chainId,
    symbol: holding.symbol,
    decimals: holding.decimals,
    amount,
    // [R6] Already priced by the holdings feed. Quoting each row to USDC just to label it would be
    // one upstream call per token on a surface that lists many.
    usd: holding.usd,
    reachableChainIds: reach,
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
