/**
 * @id PP-STR-LIB-025 (POO-2175)
 * @name fundSchemas
 * @implements-rules-version v2 (POO-2175); v1 (POO-2179 explorer records)
 * Fund-only view and transaction contracts, optional rollout previews.
 */
import { z } from "zod";
import { addressSchema, fundDetailSchema, fundIdentitySchema, poolIdSchema } from "./schemas";

const version = { protocolVersion: z.literal("v2") };
export const uint = z.string().regex(/^\d{1,78}$/);
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const record = z.object(version).passthrough();
const wireInteger = z.preprocess(
  (value) => (typeof value === "string" ? Number(value) : value),
  z.number().int().nonnegative().max(1_000_000),
) as z.ZodType<number>;
const amount = record.extend({ raw: uint, decimal });
const amounts = record.extend({ amount0: amount.nullable(), amount1: amount.nullable() });
const profile = record.extend({
  name: z.string().optional(),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  managerDisplayName: z.string().optional(),
  manager: z.unknown().optional(),
});
export const fundRowSchema = fundIdentitySchema.extend({ profile: profile.nullable().optional() });
export const fundListSchema = z.object({
  ...version,
  funds: z.array(fundRowSchema),
  nextBlock: uint.optional(),
  discovery: z.string(),
});
export const positionSchema = record.extend({
  chainId: z.string(),
  positionKey: poolIdSchema,
  adapterKind: z.string(),
  status: z.string(),
  tokens: z.array(
    record.extend({ address: addressSchema, symbol: z.string(), decimals: z.number().int() }),
  ),
  valueUsd: decimal.nullable(),
  currentValueUsd: decimal.nullable().optional(),
  uncollectedIncomeUsd: decimal.nullable(),
  shareOfNav: decimal.nullable(),
  currentAmounts: amounts.nullable().optional(),
  uncollectedIncome: amounts.nullable().optional(),
  uniswap: record
    .extend({
      tickLower: z.number(),
      tickUpper: z.number(),
      currentTick: z.number(),
      inRange: z.boolean(),
      lowerPrice: record.optional(),
      upperPrice: record.optional(),
    })
    .nullable(),
  aave: record.extend({ currentBalance: amount, supplyApy: decimal.nullable() }).nullable(),
  holderExposure: record.optional().nullable(),
});
export const positionsSchema = record.extend({ positions: z.array(positionSchema) });
export const fundViewSchema = fundDetailSchema.extend({
  profile: profile.nullable().optional(),
  lastReport: record
    .extend({
      ageSeconds: z.preprocess(
        (value) => (typeof value === "string" ? Number(value) : value),
        z.number().nonnegative(),
      ) as z.ZodType<number>,
      report: record.extend({ sequence: uint, timestamp: uint }),
    })
    .nullable()
    .optional(),
  positionsSummary: positionsSchema.optional(),
  limits: record.optional().nullable(),
  limitsUsage: z
    .union([record, z.array(record)])
    .optional()
    .nullable(),
  fees: record
    .extend({
      flowFeeBps: wireInteger,
      payoutFeeBps: wireInteger,
      performanceFeeBps: wireInteger,
      managementFeeBps: wireInteger,
      standardPayoutTermSeconds: wireInteger,
    })
    .optional(),
});
export const holderSchema = record.extend({
  shares: uint,
  value: uint,
  incomeOwed: uint,
  claimable: z.boolean(),
  incomeWithdrawal: z.tuple([uint, z.boolean()]),
  payout: record.extend({
    open: z.boolean(),
    usdcOutstanding: uint,
    termEndsAt: uint,
    awaitingSettlement: z.boolean(),
  }),
  positionsSummary: positionsSchema.optional(),
  positions: z.array(positionSchema).optional(),
});
export const positionDetailSchema = record.extend({
  position: positionSchema.nullable(),
  history: record
    .extend({
      complete: z.boolean(),
      events: z.array(
        record.extend({ type: z.string(), timestamp: z.string(), transactionHash: poolIdSchema }),
      ),
    })
    .nullable(),
});
export const fundHistorySchema = record.extend({
  coreVault: addressSchema,
  events: z.array(
    record.extend({
      type: z.string(),
      kind: z.string(),
      eventName: z.string(),
      chainId: z.enum(["42161", "4663"]),
      vault: addressSchema,
      transactionHash: poolIdSchema,
      blockNumber: uint,
      logIndex: z.number().int().nonnegative(),
      timestamp: z.string().datetime(),
      account: addressSchema.optional(),
      amounts: z.record(z.string()).optional(),
      details: z.record(z.unknown()).optional(),
    }),
  ),
  nextCursor: z
    .string()
    .regex(/^\d{1,16}:\d{1,32}:0x[0-9a-f]{64}:\d{1,10}$/)
    .nullable(),
  indexing: z.array(
    record.extend({
      chainId: z.enum(["42161", "4663"]),
      vault: addressSchema,
      nextBlock: uint,
      updatedAt: z.string().datetime(),
    }),
  ),
});
export type FundHistory = z.infer<typeof fundHistorySchema>;
export const transitSchema = record.extend({
  transitId: poolIdSchema,
  direction: z.string(),
  kind: z.string(),
  stage: z.string(),
  state: z.string(),
  amountSent: uint,
  credited: uint.nullable(),
  nextStepHint: z.string().nullable(),
  legs: record,
});
export const transitsSchema = record.extend({
  items: z.array(transitSchema),
  nextCursor: z.string().nullable(),
  coverage: z.array(record),
});
export const balancesSchema = record.extend({
  chainId: z.string(),
  status: z.string(),
  balancesStatus: z.string(),
  operatingCash: uint.nullable(),
  readyForNextStep: z.boolean(),
  tokens: z.array(record.extend({ token: addressSchema, unallocatedBalance: uint.nullable() })),
});
export const transactionSchema = z.object({
  ...version,
  to: addressSchema,
  from: addressSchema,
  data: z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/),
  value: uint,
  chainId: z.literal(42161),
});
export const previewSchema = record.extend({
  sharesMinted: uint.optional(),
  usdcCharged: uint.optional(),
  flowFee: uint.optional(),
  refundToCaller: uint.optional(),
  sharePrice: uint.optional(),
  usdcGross: uint.optional(),
  payoutFee: uint.optional(),
  usdcPaid: uint.optional(),
  sharesBurned: uint.optional(),
  usdcRequested: uint.optional(),
  usdcOutstanding: uint.optional(),
  marketCost: uint.optional(),
  shareAssets: uint.optional(),
});
export const fundBuildSchema = record.extend({
  transactions: z.array(transactionSchema).length(1),
  nextAction: z.string().optional(),
  preview: previewSchema.nullable().optional(),
  previewUnavailableReason: z.string().optional(),
});
export const reportStartSchema = record.extend({ jobId: z.string().uuid() });
export const reportJobSchema = record.extend({
  jobId: z.string().uuid(),
  core: addressSchema,
  status: z.enum(["pending", "delivered", "expired", "failed"]),
});
export type FundRow = z.infer<typeof fundRowSchema>;
export type FundView = z.infer<typeof fundViewSchema>;
export type FundHolder = z.infer<typeof holderSchema>;
export type FundPosition = z.infer<typeof positionSchema>;
export type FundBuild = z.infer<typeof fundBuildSchema>;
export type FundPositionDetail = z.infer<typeof positionDetailSchema>;
export type FundTransit = z.infer<typeof transitSchema>;
export type FundBalances = z.infer<typeof balancesSchema>;
