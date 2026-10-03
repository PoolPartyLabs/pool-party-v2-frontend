/**
 * @id PP-MGR-LIB-027 (POO-2177)
 * @name v2LaunchSchemas
 * @implements-rules-version v1
 * Narrow allow-listed request and wallet transaction contracts.
 */
import { z } from "zod";
import { addressSchema, chainIdSchema, poolIdSchema, spokeCapPercentSchema } from "./schemas";

export const rawAmountSchema = z
  .string()
  .regex(/^\d{1,78}$/)
  .refine((value) => BigInt(value) < BigInt("2") ** BigInt("256"));
export const positiveAmountSchema = rawAmountSchema.refine((value) => BigInt(value) > BigInt("0"));
export const launchTransactionSchema = z.object({
  from: addressSchema,
  to: addressSchema,
  chainId: chainIdSchema,
  data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
  value: rawAmountSchema,
});
export type LaunchTransaction = z.infer<typeof launchTransactionSchema>;
export const transactionsSchema = z
  .object({
    protocolVersion: z.literal("v2"),
    transactions: z.array(launchTransactionSchema).min(1).max(2),
    nextAction: z.string().optional(),
  })
  .passthrough();
export const createRequestSchema = z
  .object({
    manager: addressSchema,
    chains: z
      .array(
        z.object({
          chainId: chainIdSchema,
          tokens: z.array(addressSchema).min(1).max(2),
          uniswapV4PoolIds: z.array(poolIdSchema).max(8),
        }),
      )
      .min(1)
      .max(2),
    aaveV3Reserves: z.array(addressSchema).max(1),
    spokeCapPercent: spokeCapPercentSchema,
    performanceFeeBps: z.number().int().min(1000).max(9000),
    managementFeeBps: z.number().int().min(0).max(500),
    payoutFeeBps: z.number().int().min(0).max(1000),
    minFirstDeposit: positiveAmountSchema,
    seedAmount: positiveAmountSchema,
  })
  .strict()
  .refine((value) => BigInt(value.seedAmount) >= BigInt(value.minFirstDeposit));
export const swapRequestSchema = z
  .object({
    core: addressSchema,
    side: z.enum(["hub", "spoke"]),
    tokenIn: addressSchema,
    tokenOut: addressSchema,
    amountIn: positiveAmountSchema,
    maxLossBps: z.number().int().min(1).max(500),
  })
  .strict();
export const genericBuildSchema = z
  .object({
    action: z.enum(["allocate-to-hub", "send-to-spoke", "swap"]),
    from: addressSchema,
    side: z.enum(["hub", "spoke"]),
    amount: positiveAmountSchema.optional(),
    spokeIndex: z.number().int().min(0).max(0).optional(),
    bridgeRank: z.number().int().min(0).max(0).optional(),
    bridgeData: z.literal("0x").optional(),
    tokenIn: addressSchema.optional(),
    tokenOut: addressSchema.optional(),
    swapData: z
      .string()
      .regex(/^0x[0-9a-fA-F]*$/)
      .optional(),
    maxLossBps: z.number().int().min(1).max(500).optional(),
  })
  .strict();
const decimal = z.string().regex(/^\d+(\.\d+)?$/);
export const openPositionSchema = z
  .object({
    action: z.literal("open"),
    from: addressSchema,
    side: z.enum(["hub", "spoke"]),
    adapter: addressSchema,
    poolKey: poolIdSchema,
    amount: decimal.optional(),
    amount0: decimal.optional(),
    amount1: decimal.optional(),
    amount0Min: decimal.optional(),
    amount1Min: decimal.optional(),
    priceLower: decimal.optional(),
    priceUpper: decimal.optional(),
  })
  .strict();
export const versionedRecordSchema = z.object({ protocolVersion: z.literal("v2") }).passthrough();
export const balancesSchema = z
  .object({
    protocolVersion: z.literal("v2"),
    chainId: z.enum(["42161", "4663"]),
    balancesStatus: z.enum(["available", "unavailable"]),
    tokens: z.array(
      z.object({ token: addressSchema, unallocatedBalance: rawAmountSchema.nullable() }),
    ),
  })
  .passthrough();
export const transitSchema = z
  .object({
    protocolVersion: z.literal("v2"),
    transitId: poolIdSchema,
    credited: rawAmountSchema.nullable(),
    readyForNextStep: z.boolean(),
    stage: z.string(),
  })
  .passthrough();
export type CreateFundRequest = z.infer<typeof createRequestSchema>;
