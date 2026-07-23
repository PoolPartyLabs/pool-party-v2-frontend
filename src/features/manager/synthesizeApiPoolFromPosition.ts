/**
 * @id PP-MGR-SCR-004 (POO-537)
 * @name synthesizeApiPoolFromPosition
 * @implements-rules-version v1
 *
 * Anti-corruption fallback: build an {@link ApiPool} from a held position's own pool descriptor so
 * {@link mapManagerStrategyDetail} can render a manager's CLOSED strategy read-only.
 *
 * The manage detail resolves through `listStrategiesForHoldings` + `fetchManagedPoolDetail`, both of
 * which read `/pools` — the backend serves it WITHOUT closed/wound-down pools (POO-373). A manager's
 * closed strategy therefore has no catalog match and no pool-detail row, and `getManagerStrategyDetailAction`
 * returned null → the console showed "not found" (POO-537). The position already carries the same
 * descriptor fields (name, token pair + decimals, TVL, investors, feesApr, network, closed, current
 * tick) via POO-526's `Position.fallbackStrategy`, so we synthesize a minimal ApiPool from it and
 * reuse the existing mapper. `pool`/`poolManager` are required by the type but unread by the mapper;
 * the enrichment-only fields the mapper reads defensively (fee tier, ticks, dex address, lifetime
 * fees, in-range) are omitted — it degrades to honest defaults, never fabricated data.
 */
import type { Position } from "@/lib/schemas";
import type { ApiPool } from "@/lib/strategies/poolsSchema";

/** Synthesize a minimal ApiPool from a held position, or null when it lacks the synth descriptor. */
export function synthesizeApiPoolFromPosition(position: Position): ApiPool | null {
  const descriptor = position.fallbackStrategy;
  // The synth strategy (POO-526) only exists when the position carried the pool essentials.
  if (!descriptor?.poolPair) return null;

  return {
    // D1: the pool IS the position; its id is the position address (matches Position.strategyId).
    positionId: position.strategyId,
    name: descriptor.name,
    // Required by the type but unread by mapManagerStrategyDetail — carry the real (truncated) manager.
    poolManager: descriptor.manager,
    poolTvlUsd: descriptor.tvl,
    feesApr: descriptor.estReturn,
    totalInvestors: descriptor.investors,
    closed: descriptor.status === "closed",
    currency0: { symbol: descriptor.poolPair.token0, decimals: position.decimals0 },
    currency1: { symbol: descriptor.poolPair.token1, decimals: position.decimals1 },
    network: descriptor.network,
    // Unread by the mapper (dexPoolAddress drives the Uniswap link); the position id is a valid stand-in.
    pool: position.strategyId,
    // Current tick from the position (the only real tick we have); range prices fall back to placeholders.
    tickCurrent: position.tickCurrent,
    // Omitted (no source on a wound-down pool): description, poolFeeTier, inRange, totalFeesInUsd,
    // tickLower/tickUpper, dexPoolAddress — mapManagerStrategyDetail degrades gracefully.
  };
}
