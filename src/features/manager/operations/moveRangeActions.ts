/**
 * @id PP-MGR-MOD-001 (POO-310, POO-437)
 * @name Move-range build orchestration actions
 * @implements-rules-version v2
 *
 * The server-side steps of an on-chain move-range (rebalance), each authenticated with the Bearer
 * derived from the SIWE session. `useMoveRange` chains them by network family (POO-437):
 * - current (Polygon): optimize → routing → build.
 * - legacy (Arbitrum/Base): compute swap client-side → build (no optimization step; the legacy
 *   contract has none, so the current path's `optimize-move-range` reverts on these networks).
 *
 * POO-475: the two BUILD actions (`buildMoveRangeTxAction`, `buildMoveRangeTxLegacyAction`) never
 * throw across the RSC boundary — each returns a {@link BuildTxResult} ({ ok: true, tx } | { ok:
 * false, code, message }); the not-signed-in case is SESSION_MISSING and upstream failures keep their
 * code so `classifyTxError` can act on them in production. The read-only optimize/routing/legacy-swap
 * steps still return their own shapes (they run inside the client hook's try/catch, before the build).
 *
 * PP-INTEGRATION-POINT (POO-475): move-range optimize/routing/build ← pool-party-api
 *   (/swap-optimization/optimize-move-range, /swap-router/move-range/complete,
 *    /portfolio/build/move-range-tx). The build endpoint dispatches by network to the v0.5.1
 *    (Polygon) or v0.5.0 (Arbitrum/Base) path internally, so both families POST to the same route.
 */
"use server";

import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import {
  type MoveRangeRoutingResponse,
  moveRangeRoutingResponseSchema,
  type OptimizeMoveRangeResponse,
  optimizeMoveRangeResponseSchema,
} from "@/lib/manager/moveRangeSchemas";
import {
  computeLegacyMoveRangeSwap,
  type LegacyMoveRangeSwapAmounts,
} from "@/lib/manager/moveRangeSwap";
import { fetchPositions } from "@/lib/portfolio/fetchPositions";
import { type BuildTxResult, buildTxFailure } from "@/lib/tx/actionResult";
import { builtTxSchema } from "@/lib/tx/builtTxSchema";
import { tickToPrice } from "@/lib/uniswap/tick";

/** Default optimizer targets (match the interface's move-range call: 99.99% / 10 iterations). */
const TARGET_UTILIZATION = 99.99;
const MAX_ITERATIONS = 10;

/** Shared range key for a position on a network. */
interface MoveRangeKey {
  network: string;
  positionId: `0x${string}`;
  tickLower: number;
  tickUpper: number;
  slippageTolerance: number;
}

/** Step 1: optimal swap amounts to rebalance into [tickLower, tickUpper]. */
export async function optimizeMoveRangeAction(
  input: MoveRangeKey,
): Promise<OptimizeMoveRangeResponse | null> {
  return apiFetch("swap-optimization/optimize-move-range", {
    method: "POST",
    body: {
      network: input.network,
      positionId: input.positionId,
      tickLower: input.tickLower,
      tickUpper: input.tickUpper,
      slippageTolerance: input.slippageTolerance,
      targetUtilization: TARGET_UTILIZATION,
      maxIterations: MAX_ITERATIONS,
    },
    schema: optimizeMoveRangeResponseSchema,
    network: input.network,
    headers: await getAuthHeader(),
  });
}

/** Step 2: complete routing (universal-router params + V3 paths) for the optimized swap amounts. */
export async function getMoveRangeRoutingAction(
  input: MoveRangeKey & { swapZeroForOneAmount: string; swapOneForZeroAmount: string },
): Promise<MoveRangeRoutingResponse | null> {
  return apiFetch("swap-router/move-range/complete", {
    method: "POST",
    body: {
      network: input.network,
      positionId: input.positionId,
      tickLower: input.tickLower,
      tickUpper: input.tickUpper,
      slippageTolerance: input.slippageTolerance,
      swapZeroForOneAmount: input.swapZeroForOneAmount,
      swapOneForZeroAmount: input.swapOneForZeroAmount,
    },
    schema: moveRangeRoutingResponseSchema,
    network: input.network,
    headers: await getAuthHeader(),
  });
}

/**
 * Step 3: build the move-range tx for the signed-in wallet (POO-475). Returns typed data, never
 * throws: SESSION_MISSING when not signed in, the upstream failure code otherwise.
 */
export async function buildMoveRangeTxAction(input: {
  network: string;
  positionId: `0x${string}`;
  tickLower: number;
  tickUpper: number;
  slippageTolerance: number;
  mintSlippageTolerance: number;
  routing: MoveRangeRoutingResponse;
}): Promise<BuildTxResult> {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return { ok: false, code: "SESSION_MISSING", message: "Wallet session not established" };
  }

  const { routing } = input;
  try {
    const tx = await apiFetch("portfolio/build/move-range-tx", {
      method: "POST",
      body: {
        network: input.network,
        wallet,
        positionId: input.positionId,
        tickLower: input.tickLower,
        tickUpper: input.tickUpper,
        slippageTolerance: input.slippageTolerance,
        mintSlippageTolerance: input.mintSlippageTolerance,
        zeroForOneUniversalSwapParams: routing.zeroForOneUniversalSwapParams,
        oneForZeroUniversalSwapParams: routing.oneForZeroUniversalSwapParams,
        multihopSwapPathZeroForOne: routing.multihopSwapPathZeroForOne,
        multihopSwapPathOneForZero: routing.multihopSwapPathOneForZero,
        swapZeroForOneAmount: routing.swapZeroForOneAmount,
        swapOneForZeroAmount: routing.swapOneForZeroAmount,
        swapZeroForOneMinOut: routing.swapZeroForOneMinOut,
        swapOneForZeroMinOut: routing.swapOneForZeroMinOut,
        swapZeroForOneExpectedOut: routing.swapZeroForOneExpectedOut,
        swapOneForZeroExpectedOut: routing.swapOneForZeroExpectedOut,
        sqrtPriceX96After: routing.sqrtPriceX96After,
        expectedUtilization: routing.expectedUtilization,
      },
      schema: builtTxSchema,
      network: input.network,
      headers: await getAuthHeader(),
    });
    if (!tx) {
      return { ok: false, code: "SYSTEM_INTERNAL", message: "Build returned no transaction" };
    }
    return { ok: true, tx };
  } catch (error) {
    return buildTxFailure(error);
  }
}

/**
 * Legacy (Arbitrum/Base) step 1: size the rebalance swap [R2]. Legacy networks have no
 * swap-optimization endpoint, so the amounts are derived from the position's current pooled reserves
 * and the new range (`computeLegacyMoveRangeSwap`). The manager's own position carries that raw
 * on-chain state, so it is read server-side from the signed-in wallet's portfolio — the address is
 * never trusted from the client. Not signed in, or the position / its on-chain state is missing → null.
 */
export async function computeLegacyMoveRangeSwapAction(
  input: MoveRangeKey,
): Promise<LegacyMoveRangeSwapAmounts | null> {
  const wallet = await getSessionWallet();
  if (!wallet) return null;

  const positions = await fetchPositions(wallet, await getAuthHeader());
  const position = positions.find((p) => p.id.toLowerCase() === input.positionId.toLowerCase());
  if (
    !position ||
    position.totalSupply0 == null ||
    position.totalSupply1 == null ||
    position.tickCurrent == null ||
    position.decimals0 == null ||
    position.decimals1 == null
  ) {
    return null;
  }

  return computeLegacyMoveRangeSwap({
    totalSupply0: position.totalSupply0,
    totalSupply1: position.totalSupply1,
    decimals0: position.decimals0,
    decimals1: position.decimals1,
    currentPrice: tickToPrice(position.tickCurrent, position.decimals0, position.decimals1),
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
  });
}

/**
 * Legacy (Arbitrum/Base) step 2: build the move-range tx with the simpler v0.5.0 body [R3]. The
 * backend `buildMoveRangeTx` dispatches non-Polygon networks to `buildMoveRangeTx_v0_5_0`, which
 * takes the pre-sized swap amounts and does the routing internally — the Universal-Router / optimizer
 * fields are omitted (they are optional on the build DTO). Not signed in → null.
 */
export async function buildMoveRangeTxLegacyAction(
  input: MoveRangeKey & { swapZeroForOneAmount: string; swapOneForZeroAmount: string },
): Promise<BuildTxResult> {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return { ok: false, code: "SESSION_MISSING", message: "Wallet session not established" };
  }

  try {
    const tx = await apiFetch("portfolio/build/move-range-tx", {
      method: "POST",
      body: {
        network: input.network,
        wallet,
        positionId: input.positionId,
        tickLower: input.tickLower,
        tickUpper: input.tickUpper,
        slippageTolerance: input.slippageTolerance,
        swapZeroForOneAmount: input.swapZeroForOneAmount,
        swapOneForZeroAmount: input.swapOneForZeroAmount,
      },
      schema: builtTxSchema,
      network: input.network,
      headers: await getAuthHeader(),
    });
    if (!tx) {
      return { ok: false, code: "SYSTEM_INTERNAL", message: "Build returned no transaction" };
    }
    return { ok: true, tx };
  } catch (error) {
    return buildTxFailure(error);
  }
}
