/**
 * @id PP-MGR (POO-315)
 * @name mintAmountsWithSlippage
 * @implements-rules-version v1
 *
 * Position-aware create-pool mint mins, ported from pool-party-interface
 * (`shared/smartcontract/lib/slippage.ts`). The API trusts the client's `amount0Min/amount1Min`
 * (it applies its own slippage on top), so a two-sided full-range seed must compute the amounts that
 * are actually *consumed* at the current price for the range — a flat per-input haircut over-
 * constrains the over-supplied side and can revert the mint. This uses the Uniswap v3 SDK exactly
 * like the interface (`Position.fromAmounts(...).mintAmountsWithSlippage(Percent(slippage*100,
 * 10_000))`). Server-only: the SDK stays out of the browser bundle.
 */
import "server-only";

import { Percent, Token } from "@uniswap/sdk-core";
import { Pool, Position } from "@uniswap/v3-sdk";
import type { DexPoolState } from "./dexPoolState";

/** The computed minimum mint amounts (raw token units, as decimal strings). */
export interface MintMins {
  amount0Min: string;
  amount1Min: string;
}

/**
 * Compute `amount0Min` / `amount1Min` for a create-pool seed, accounting for how much of each input
 * is consumed at the pool's current price for the `[tickLower, tickUpper]` range.
 *
 * @param state   The pool's on-chain state (sqrtPriceX96 / liquidity / tickCurrent + token decimals).
 * @param chainId The EVM chain id (for the SDK Token instances).
 * @param tickLower / tickUpper The position's (aligned) tick bounds.
 * @param amount0 / amount1     The seed amounts in raw token units (wei), as decimal strings.
 * @param slippagePct           Slippage tolerance as a percent (e.g. 0.5 for 0.5%).
 */
export function mintAmountsWithSlippage(
  state: DexPoolState,
  chainId: number,
  tickLower: number,
  tickUpper: number,
  amount0: string,
  amount1: string,
  slippagePct: number,
): MintMins {
  const token0 = new Token(chainId, state.currency0.address, state.currency0.decimals);
  const token1 = new Token(chainId, state.currency1.address, state.currency1.decimals);

  const pool = new Pool(
    token0,
    token1,
    state.feeTier,
    state.sqrtPriceX96,
    state.liquidity,
    state.tickCurrent,
  );

  const position = Position.fromAmounts({
    pool,
    tickLower,
    tickUpper,
    amount0,
    amount1,
    useFullPrecision: true,
  });

  // Percent(slippage * 100, 10_000): 0.5% → 50/10000. Matches the interface.
  const slippage = new Percent(Math.round(slippagePct * 100), 10_000);
  const mins = position.mintAmountsWithSlippage(slippage);
  return { amount0Min: mins.amount0.toString(), amount1Min: mins.amount1.toString() };
}
