/**
 * @id PP-MGR-LIB-031
 * @name panelCatalogView
 * @implements-rules-version v1 (POO-2185 rules v1, slice PC of POO-2171)
 * @analytics-events none (data hooks): a pure mapping module, nothing here touches the dataLayer.
 *
 * What the Build configuration panels read, as pure functions over data the app already holds or
 * fetches. No I/O, no React, no clock:
 *
 * - {@link toPanelPoolView}: one live Uniswap v4 catalog pool as the view the pool panel renders and
 *   snaps ticks against. Fee, tick spacing, token decimals and the price come from the POOL (its key
 *   and the catalog), never from a v3 fee tier (handoff v1.2, "Range bounds").
 * - {@link panelPoolsFor}: the panel's pool LIST, which needs no fetch at all: the mandate's own
 *   Uniswap v4 pools of one network.
 * - {@link selectPanelReserves}: the Aave Supply panel's asset list, the catalog's reserves joined to
 *   the mandate's tokens, an unusable reserve listed with its reason instead of dropped (P1, P13).
 *
 * Conventions that matter to the callers:
 *
 * - **The canonical price is token1 per token0**, and which token is which is decided by the POOL
 *   KEY's currency order (currency0 is the lower address), never by the order the catalog writes the
 *   pair in (`tokens`, `pairSymbols`). A bound the manager types is stored canonical plus a
 *   `displayInverted` flag, so everything downstream of this module speaks canonical.
 * - **`poolId` is the bare v4 PoolId** (bytes32, lowercase), the value a Pool block's `config.poolId`
 *   holds and the only id the live read accepts (decision A1). Mock mode has no PoolId (the mandate's
 *   mock Pools step lists slugs), so a mock row's `poolId` is its slug and the mock read answers to it.
 * - **TVL and APR are not exposed.** The alpha serves both as null, and a pool row leaves that stack
 *   out (decision A3); a number the catalog may serve later would still never reach the panel from
 *   here, and active liquidity is never shown as TVL.
 * - **Eligibility is re-checked on every read.** A pool can stop being usable between the mandate
 *   step and the panel; the launch driver would only say so after the fund exists. `eligible` mirrors
 *   `eligiblePool` of `mandatePoolSource.ts` without its liquidity test, which is the separate flag
 *   `hasActiveLiquidity`; `panelCatalogView.parity.test.ts` pins that the two agree.
 * - **Reserve usability mirrors `v2Mandate.ts`** (`toV2MandateSelection`): available, active, not
 *   frozen, not paused and the supply cap not reached.
 */
import type { CatalogPool, CatalogReserve, V2ChainId } from "@/lib/api/v2/schemas";
import {
  type MandateDraft,
  type MandatePoolRef,
  type MandateTokenRef,
  type NetworkId,
  tokenKey,
} from "../../mandateDraft";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One side of a live pool, or a reserve's asset: identity and the decimals the maths needs. */
export interface PanelToken {
  /** Lowercase address. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Null when the catalog has no logo for it, never an invented one. */
  logoUrl: string | null;
}

/**
 * The canonical quote orientation of a pool: its price is `quote` per `base`. Fixed by the pool
 * key's currency order (base is currency0, quote is currency1). Inverting the DISPLAY swaps the two
 * in the panel only; the stored bounds stay canonical.
 */
export interface PanelPoolOrientation {
  base: PanelToken;
  quote: PanelToken;
}

/** A live Uniswap v4 pool, as the pool panel renders it. */
export interface PanelPoolView {
  /** The bare v4 PoolId (bytes32, lowercase): what a Pool block's `config.poolId` holds. */
  poolId: string;
  chainId: V2ChainId;
  network: NetworkId;
  /** currency0, the lower address: the BASE of the canonical price. */
  token0: PanelToken;
  /** currency1, the higher address: the QUOTE of the canonical price. */
  token1: PanelToken;
  orientation: PanelPoolOrientation;
  /** `token0 / token1` symbols in the pool key's order: the card title (inverting changes the panel only). */
  pairLabel: string;
  /** `poolKey.fee` as served, in hundredths of a basis point (500 is 0.05%). */
  feeTier: number;
  /** The fee as a percent: `poolKey.fee / 10000`. */
  feePct: number;
  /** The pool's own tick spacing: the grid every bound snaps to. */
  tickSpacing: number;
  currentTick: number;
  /** The canonical price, token1 per token0, in human units (decimals applied). */
  price: number;
  /** Passes every mandate-eligibility check except liquidity. */
  eligible: boolean;
  /** Active liquidity at the current tick is above zero. */
  hasActiveLiquidity: boolean;
}

/** One row of the pool panel's list: a Uniswap v4 pool of the mandate, on one network. */
export interface PanelPoolRow {
  /** What `Use` writes to `config.poolId`: the bare PoolId in real mode, the mock slug in mock mode. */
  poolId: string;
  /** The mandate draft's own id for the pool (`<chainId>:<poolId>` in real mode), a React key. */
  rowId: string;
  network: NetworkId;
  token0: Pick<PanelToken, "address" | "symbol" | "name" | "logoUrl">;
  token1: Pick<PanelToken, "address" | "symbol" | "name" | "logoUrl">;
  /** `token0 / token1` symbols. */
  pairLabel: string;
  /** In hundredths of a basis point (500 is 0.05%). */
  feeTier: number;
  feePct: number;
  /** From the pool key; null for a mock pool, which has none until the live read. */
  tickSpacing: number | null;
}

/** Why an Aave reserve cannot be supplied to. The order is the order the causes are named in. */
export type PanelReserveReason =
  | "inactive"
  | "frozen"
  | "paused"
  | "supplyCapReached"
  | "unavailable";

/** One row of the Supply panel's asset list. */
export interface PanelReserveRow {
  /** `network:address`, lowercase: what a Supply block's `config.assetKey` holds. */
  assetKey: string;
  /** The token as the manager chose it in the mandate, with the catalog's decimals. */
  token: PanelToken;
  /** The supply APY in percent, exactly as the catalog served it. */
  supplyApy: string;
  usable: boolean;
  /** Null when usable. An unusable row is listed but disabled. */
  reason: PanelReserveReason | null;
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

/** The mandate network of a v2 chain id: the hub, or Robinhood Chain. */
export function networkOfChain(chainId: V2ChainId): NetworkId {
  return chainId === 42161 ? "arbitrum" : "robinhood";
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

// The compile target is ES2017, which has no BigInt literals (`0n`): the constants are built with
// the function, the way `launch/review.ts` does.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
/** 2^192: the square of the Q64.96 scale. */
const Q192 = ONE << BigInt(192);

/**
 * The canonical price, token1 per token0 in human units, from a Uniswap sqrt price Q64.96.
 *
 * `price = (sqrtPriceX96 / 2^96)^2 * 10^(decimals0 - decimals1)`, done in integers first so a pool
 * quoted at 3e-9 raw does not lose its digits, then turned into a float once. Null when the input is
 * not a positive integer string or the result leaves the float range.
 */
export function priceFromSqrtPriceX96(
  sqrtPriceX96: string,
  decimals0: number,
  decimals1: number,
): number | null {
  if (!/^\d+$/.test(sqrtPriceX96)) return null;
  if (!Number.isInteger(decimals0) || !Number.isInteger(decimals1)) return null;
  const sqrt = BigInt(sqrtPriceX96);
  if (sqrt <= ZERO) return null;
  const exponent = decimals0 - decimals1;
  const numerator = sqrt * sqrt * (exponent > 0 ? TEN ** BigInt(exponent) : ONE);
  const denominator = Q192 * (exponent < 0 ? TEN ** BigInt(-exponent) : ONE);
  const price = Number(numerator) / Number(denominator);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** The catalog's own price field when it is a positive number, else the one derived from the sqrt price. */
function readCanonicalPrice(pool: CatalogPool, decimals0: number, decimals1: number): number {
  const served = Number(pool.currentPrice.token1PerToken0);
  if (Number.isFinite(served) && served > 0) return served;
  const derived = priceFromSqrtPriceX96(pool.sqrtPriceX96, decimals0, decimals1);
  if (derived === null) throw new Error("catalog pool price unavailable");
  return derived;
}

// ---------------------------------------------------------------------------
// Live pool
// ---------------------------------------------------------------------------

/** The native currency in a v4 pool key: not supported by the fund contracts. */
const ZERO_ADDRESS = /^0x0{40}$/i;

/** The pool's token at `currency`, found by ADDRESS: the catalog's own token order means nothing. */
function tokenAt(pool: CatalogPool, currency: string): PanelToken {
  const wanted = currency.toLowerCase();
  const token = pool.tokens.find((entry) => entry.address.toLowerCase() === wanted);
  if (!token) throw new Error("catalog pool currency missing");
  return {
    address: token.address.toLowerCase(),
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    logoUrl: token.logoUrl,
  };
}

/**
 * A live catalog pool as the pool panel's view.
 *
 * Throws when the pool cannot be a view: a currency of the key that its tokens do not carry, or no
 * readable price. The hook turns that into an error with a retry, never into a half-filled panel.
 */
export function toPanelPoolView(pool: CatalogPool): PanelPoolView {
  const token0 = tokenAt(pool, pool.poolKey.currency0);
  const token1 = tokenAt(pool, pool.poolKey.currency1);
  const price = readCanonicalPrice(pool, token0.decimals, token1.decimals);
  const chainId: V2ChainId = pool.chainId === "42161" ? 42161 : 4663;
  return {
    poolId: pool.poolId.toLowerCase(),
    chainId,
    network: networkOfChain(chainId),
    token0,
    token1,
    orientation: { base: token0, quote: token1 },
    pairLabel: `${token0.symbol} / ${token1.symbol}`,
    feeTier: pool.poolKey.fee,
    feePct: pool.poolKey.fee / 10_000,
    tickSpacing: pool.poolKey.tickSpacing,
    currentTick: pool.currentTick,
    price,
    eligible:
      pool.eligible &&
      !pool.hooked &&
      ZERO_ADDRESS.test(pool.poolKey.hooks) &&
      !ZERO_ADDRESS.test(pool.poolKey.currency0) &&
      !ZERO_ADDRESS.test(pool.poolKey.currency1) &&
      pool.tokens.every((token) => token.hubPriced),
    hasActiveLiquidity: BigInt(pool.liquidity) > ZERO,
  };
}

// ---------------------------------------------------------------------------
// Pool list
// ---------------------------------------------------------------------------

/**
 * The pool panel's list: the mandate's Uniswap v4 pools of one network, in the mandate's order.
 *
 * A pool with a hook never gets here (R38 keeps it out of the mandate); it is skipped anyway, so a
 * damaged draft cannot offer a pool the launch refuses. TVL and APR are left out on purpose.
 */
export function panelPoolsFor(
  draft: Pick<MandateDraft, "pools">,
  chainId: V2ChainId,
): PanelPoolRow[] {
  const network = networkOfChain(chainId);
  return draft.pools
    .filter(
      (pool: MandatePoolRef) =>
        pool.protocol === "uniswap-v4" && pool.network === network && !pool.hasHook,
    )
    .map((pool) => {
      const feeTier = pool.poolKey?.fee ?? pool.feeTier;
      return {
        poolId: pool.poolId?.toLowerCase() ?? pool.id,
        rowId: pool.id,
        network,
        token0: rowToken(pool.token0),
        token1: rowToken(pool.token1),
        pairLabel: `${pool.token0.symbol} / ${pool.token1.symbol}`,
        feeTier,
        feePct: feeTier / 10_000,
        tickSpacing: pool.poolKey?.tickSpacing ?? null,
      };
    });
}

function rowToken(token: MandatePoolRef["token0"]): PanelPoolRow["token0"] {
  return {
    address: token.address.toLowerCase(),
    symbol: token.symbol,
    name: token.name,
    logoUrl: token.logoUrl,
  };
}

// ---------------------------------------------------------------------------
// Aave reserves
// ---------------------------------------------------------------------------

/**
 * Whether a reserve can be supplied to, and if not, why. Mirrors the check `toV2MandateSelection`
 * makes before it accepts a reserve (available, active, not frozen, not paused, cap not reached).
 * The most specific cause is named first, so a reserve that is both frozen and unavailable says
 * "frozen"; "unavailable" is the answer only when the catalog's overall flag is the sole reason.
 */
export function reserveUsability(reserve: CatalogReserve): {
  usable: boolean;
  reason: PanelReserveReason | null;
} {
  const reason: PanelReserveReason | null = !reserve.active
    ? "inactive"
    : reserve.frozen
      ? "frozen"
      : reserve.paused
        ? "paused"
        : reserve.supplyCapReached
          ? "supplyCapReached"
          : !reserve.available
            ? "unavailable"
            : null;
  return { usable: reason === null, reason };
}

/**
 * The Supply panel's asset list: the reserves of one chain joined to the mandate's tokens on its
 * network. A reserve whose token the mandate does not hold is left out (P1: the mandate only); one
 * the mandate holds but Aave cannot take is listed with its reason, so the panel can show it
 * disabled. Aave is on the hub alone, so a spoke has no row. The catalog's order is kept.
 */
export function selectPanelReserves(
  reserves: readonly CatalogReserve[],
  tokens: readonly MandateTokenRef[],
  chainId: V2ChainId,
): PanelReserveRow[] {
  const network = networkOfChain(chainId);
  const held = new Map<string, MandateTokenRef>();
  for (const token of tokens) {
    if (token.network === network) held.set(token.address.toLowerCase(), token);
  }
  const rows: PanelReserveRow[] = [];
  for (const reserve of reserves) {
    if (reserve.chainId !== String(chainId)) continue;
    const token = held.get(reserve.token.address.toLowerCase());
    if (!token) continue;
    const { usable, reason } = reserveUsability(reserve);
    rows.push({
      assetKey: tokenKey(token),
      token: {
        address: token.address.toLowerCase(),
        symbol: token.symbol,
        name: token.name,
        decimals: reserve.token.decimals,
        logoUrl: token.logoUrl,
      },
      supplyApy: reserve.supplyApy,
      usable,
      reason,
    });
  }
  return rows;
}
