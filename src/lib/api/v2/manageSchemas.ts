/**
 * @id PP-MGR-LIB-055 (POO-2228)
 * @name manageSchemas
 * @implements-rules-version v1
 * @analytics-events none, typed contracts; the Manage screen owns intent instrumentation.
 * Verified against pool-party-api a8299b147eef1ab9b6ae9bc8c5498168006149e7.
 */
import { z } from "zod";
import { launchTransactionSchema, rawAmountSchema } from "./launchSchemas";
import { addressSchema, chainIdSchema, poolIdSchema } from "./schemas";

const version = { protocolVersion: z.literal("v2") };
const decimal = z.string().regex(/^\d+(\.\d+)?$/);
const positiveDecimal = decimal.refine((value) => /[1-9]/.test(value));
const tick = z.number().int().min(-887272).max(887272);
const token = z.object({
  ...version,
  address: addressSchema,
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(36),
});
const amount = z.object({ ...version, raw: rawAmountSchema, decimal });
const composition = z.object({ ...version, amount0: amount, amount1: amount.nullable() });
const price = z.object({
  ...version,
  token1PerToken0: positiveDecimal,
  token0PerToken1: positiveDecimal,
});
const protocolPoolKey = z.object({
  ...version,
  currency0: addressSchema,
  currency1: addressSchema,
  fee: z.number().int().min(0).max(1000000),
  tickSpacing: z.number().int().positive().max(32767),
  hooks: addressSchema,
});
const uniswap = z.object({
  ...version,
  poolKey: protocolPoolKey,
  tickLower: tick,
  tickUpper: tick,
  currentTick: tick,
  tickSpacing: z.number().int().positive().max(32767),
  fee: z.number().int().min(0).max(1000000),
  liquidity: rawAmountSchema,
  sqrtPriceX96: rawAmountSchema.refine((value) => BigInt(value) > BigInt(0)),
  inRange: z.boolean(),
  lowerPrice: price,
  upperPrice: price,
  currentPrice: price,
});
const aave = z.object({
  ...version,
  asset: token,
  suppliedPrincipal: amount,
  currentBalance: amount,
  accruedYield: amount,
  scaledBalance: rawAmountSchema,
  normalizedIncome: rawAmountSchema,
  supplyRateRay: rawAmountSchema,
  supplyApy: decimal,
});

/** Exact served position fields; arbitrary backend payload fields never cross the action boundary. */
export const managePositionSchema = z
  .object({
    ...version,
    chainId: z.enum(["42161", "4663"]),
    spokeVault: addressSchema,
    status: z.enum(["open", "closed", "pending"]),
    adapter: addressSchema,
    adapterKind: z.enum(["uniswap-v4", "aave-v3"]),
    positionKey: poolIdSchema,
    poolKey: poolIdSchema,
    poolId: poolIdSchema,
    tokens: z.array(token).min(1).max(2),
    uniswap: uniswap.nullable(),
    aave: aave.nullable(),
    currentAmounts: composition,
    oracleAmounts: composition,
    uncollectedIncome: composition,
    valueUsd: decimal,
    currentValueUsd: decimal,
    uncollectedIncomeUsd: decimal,
    shareOfNav: decimal,
    feesApr: decimal.nullable(),
  })
  .superRefine((position, context) => {
    const invalid = () =>
      context.addIssue({ code: z.ZodIssueCode.custom, message: "inconsistent position metadata" });
    if (position.adapterKind === "uniswap-v4") {
      const pool = position.uniswap;
      if (!pool || position.aave || position.tokens.length !== 2) return invalid();
      if (
        pool.poolKey.currency0.toLowerCase() !== position.tokens[0].address.toLowerCase() ||
        pool.poolKey.currency1.toLowerCase() !== position.tokens[1].address.toLowerCase() ||
        pool.tickSpacing !== pool.poolKey.tickSpacing ||
        pool.fee !== pool.poolKey.fee ||
        pool.tickLower >= pool.tickUpper ||
        pool.tickLower % pool.tickSpacing ||
        pool.tickUpper % pool.tickSpacing ||
        !position.currentAmounts.amount1 ||
        !position.oracleAmounts.amount1 ||
        !position.uncollectedIncome.amount1
      )
        invalid();
    } else if (
      !position.aave ||
      position.uniswap ||
      position.tokens.length !== 1 ||
      position.aave.asset.address.toLowerCase() !== position.tokens[0].address.toLowerCase() ||
      position.currentAmounts.amount1 ||
      position.oracleAmounts.amount1 ||
      position.uncollectedIncome.amount1
    )
      invalid();
  });
export const managePositionDetailSchema = z.object({
  ...version,
  position: managePositionSchema.nullable(),
});
export type ManagePosition = z.infer<typeof managePositionSchema>;

/** Draft carries canonical ticks, never budgets inferred from present holdings. */
export const manageMoveRangeDraftSchema = z
  .object({
    chainId: chainIdSchema,
    positionKey: poolIdSchema,
    tickLower: tick,
    tickUpper: tick,
    slippageBps: z.number().int().min(10).max(500),
  })
  .strict()
  .refine((draft) => draft.tickLower < draft.tickUpper);
export type ManageMoveRangeDraft = z.infer<typeof manageMoveRangeDraftSchema>;

/** DTOs exist for future integration, but no action exports a builder or signing path. */
export const manageMoveRangeBuildRequestSchema = z
  .object({
    action: z.literal("move-range"),
    from: addressSchema,
    side: z.enum(["hub", "spoke"]),
    adapter: addressSchema,
    positionKey: poolIdSchema,
    poolKey: poolIdSchema.optional(),
    amount0: decimal,
    amount1: decimal,
    amount0Min: decimal.optional(),
    amount1Min: decimal.optional(),
    tickLower: tick.optional(),
    tickUpper: tick.optional(),
    priceLower: positiveDecimal.optional(),
    priceUpper: positiveDecimal.optional(),
    deadline: z
      .string()
      .regex(/^\d{1,12}$/)
      .optional(),
    swap: z
      .object({
        tokenIn: addressSchema,
        tokenOut: addressSchema,
        amountIn: positiveDecimal,
        maxLossBps: z.number().int().min(1).max(500),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((body) => {
    const ticks =
      body.tickLower !== undefined &&
      body.tickUpper !== undefined &&
      body.priceLower === undefined &&
      body.priceUpper === undefined;
    const prices =
      body.priceLower !== undefined &&
      body.priceUpper !== undefined &&
      body.tickLower === undefined &&
      body.tickUpper === undefined;
    return (ticks || prices) && (/[1-9]/.test(body.amount0) || /[1-9]/.test(body.amount1));
  });
export const manageMoveRangeBuildResponseSchema = z
  .object({
    ...version,
    transactions: z.array(launchTransactionSchema.extend(version)).min(2).max(3),
  })
  .strict();
export const MANAGE_MOVE_RANGE_MISSING = [
  "principal-budgets",
  "post-close-preview",
  "network-fee",
  "move-range-fee-semantics",
  "price-impact",
  "continuation-recovery",
] as const;
export type ManageMoveRangeReview = {
  status: "unavailable";
  canConfirm: false;
  position: ManagePosition;
  draft: ManageMoveRangeDraft;
  missing: (typeof MANAGE_MOVE_RANGE_MISSING)[number][];
};
export type ManageActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { status: number; code: string } };
