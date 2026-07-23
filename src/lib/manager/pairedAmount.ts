/**
 * @id PP-MGR (POO-306)
 * @name pairedSeedAmounts
 * @implements-rules-version v1
 *
 * Derive the dependent create-pool seed amount from the one the manager typed, for a
 * `[tickLower, tickUpper]` position at the pool's current price. Mirrors the v1 interface
 * (`create-pool/model/store/deposit-slice.ts`): `Position.fromAmount0/fromAmount1` in range, and a
 * single-sided position out of range (price above the range → all token1; below → all token0). Uses
 * the Uniswap v3 SDK exactly like `mintAmountsWithSlippage`. Server-only: the SDK never reaches the
 * browser bundle (so the paired-amount calc runs through a Server Action, not in the client).
 */
import "server-only";

import { Token } from "@uniswap/sdk-core";
import { Pool, Position } from "@uniswap/v3-sdk";
import type { DexPoolState } from "./dexPoolState";

/** Which seed input the manager edited; the other is derived. */
export type IndependentField = 0 | 1;

/** Both resolved seed amounts in raw token units (wei), as decimal strings. */
export interface ResolvedSeedAmounts {
  amount0: string;
  amount1: string;
}

/**
 * @param state             Pool on-chain state (sqrtPriceX96 / liquidity / tickCurrent + decimals).
 * @param chainId           EVM chain id (for the SDK Token instances).
 * @param tickLower/Upper   The position's (aligned) tick bounds.
 * @param independentField  Which token the manager typed (0 or 1).
 * @param independentAmount The typed amount in raw token units (wei), as a decimal string.
 * @returns Both amounts (wei strings); the independent one is kept verbatim, the dependent derived.
 */
export function pairedSeedAmounts(
  state: DexPoolState,
  chainId: number,
  tickLower: number,
  tickUpper: number,
  independentField: IndependentField,
  independentAmount: string,
): ResolvedSeedAmounts {
  // Non-positive / unparsable input → nothing to derive.
  let typed: bigint;
  try {
    typed = BigInt(independentAmount);
  } catch {
    return { amount0: "0", amount1: "0" };
  }
  if (typed <= BigInt(0)) return { amount0: "0", amount1: "0" };

  // Out of range is single-sided and needs no SDK (matches v1 `inRange()`): boundaries count as
  // in-range, so use strict `>`/`<` like the interface.
  if (state.tickCurrent > tickUpper) {
    return { amount0: "0", amount1: independentField === 1 ? independentAmount : "0" };
  }
  if (state.tickCurrent < tickLower) {
    return { amount0: independentField === 0 ? independentAmount : "0", amount1: "0" };
  }

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

  if (independentField === 0) {
    const position = Position.fromAmount0({
      pool,
      tickLower,
      tickUpper,
      amount0: independentAmount,
      useFullPrecision: true,
    });
    // Keep the manager's input verbatim on the independent side (as v1 does), derive the other.
    return { amount0: independentAmount, amount1: position.amount1.quotient.toString() };
  }

  const position = Position.fromAmount1({
    pool,
    tickLower,
    tickUpper,
    amount1: independentAmount,
  });
  return { amount0: position.amount0.quotient.toString(), amount1: independentAmount };
}
