/**
 * @id PP-MGR (POO-310)
 * @name Move-range API schemas
 * @implements-rules-version v1
 *
 * Zod schemas for the two read steps of the on-chain move-range (rebalance) orchestration, ported
 * from pool-party-interface's `swap-optimization` entity:
 *   1. `optimize-move-range`  → the optimal swap amounts (binary search).
 *   2. `swap-router/move-range/complete` → universal-router params + V3 paths + min/expected outs
 *      + `sqrtPriceX96After`, which together feed `build/move-range-tx`.
 */
import { z } from "zod";

/** Universal Router swap leg (one direction). */
export const universalSwapParamsSchema = z.object({
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  amountOutMinimum: z.string(),
  commands: z.string(),
  inputs: z.array(z.string()),
  deadline: z.string(),
});
export type UniversalSwapParams = z.infer<typeof universalSwapParamsSchema>;

/** Expected per-token capital utilization (percent). */
const expectedUtilizationSchema = z.object({
  token0: z.number(),
  token1: z.number(),
});

/** Step 1 — `optimize-move-range`: the optimal swap amounts to rebalance into the new range. */
export const optimizeMoveRangeResponseSchema = z.object({
  swapZeroForOneAmount: z.string(),
  swapOneForZeroAmount: z.string(),
  expectedUtilization: expectedUtilizationSchema.optional(),
  converged: z.boolean().optional(),
  iterations: z.number().optional(),
});
export type OptimizeMoveRangeResponse = z.infer<typeof optimizeMoveRangeResponseSchema>;

/** Step 2 — `swap-router/move-range/complete`: everything `build/move-range-tx` needs. */
export const moveRangeRoutingResponseSchema = z.object({
  zeroForOneUniversalSwapParams: universalSwapParamsSchema,
  oneForZeroUniversalSwapParams: universalSwapParamsSchema,
  multihopSwapPathZeroForOne: z.string(),
  multihopSwapPathOneForZero: z.string(),
  swapZeroForOneAmount: z.string(),
  swapOneForZeroAmount: z.string(),
  swapZeroForOneMinOut: z.string(),
  swapOneForZeroMinOut: z.string(),
  swapZeroForOneExpectedOut: z.string(),
  swapOneForZeroExpectedOut: z.string(),
  sqrtPriceX96After: z.string(),
  expectedUtilization: expectedUtilizationSchema,
});
export type MoveRangeRoutingResponse = z.infer<typeof moveRangeRoutingResponseSchema>;
