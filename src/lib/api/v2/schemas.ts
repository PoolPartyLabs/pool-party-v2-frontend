/**
 * @id PP-CORE-LIB-113 (POO-2133)
 * @name v2ApiSchemas
 * @implements-rules-version v1
 * Wire schemas from the October 3 catalog and fund API contracts.
 */
import { z } from "zod";

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const poolIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const chainIdSchema = z.union([z.literal(42161), z.literal(4663)]);
const wireChain = z.enum(["42161", "4663"]);
const uint = z.string().regex(/^\d+$/);
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const version = { protocolVersion: z.literal("v2") };
export const spokeCapPercentSchema = z.number().int().min(0).max(100).multipleOf(5).nullable();

export const catalogTokenSchema = z.object({
  ...version,
  chainId: wireChain,
  address: addressSchema,
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals: z.number().int().min(0).max(255),
  logoUrl: z.string().nullable(),
  hubPriced: z.boolean(),
  priceUsd: decimal.nullable(),
  priceUpdatedAt: uint.nullable(),
  priceSource: addressSchema,
  priceProvenance: z.enum(["fixed-1:1", "chainlink"]),
  priceUnavailableReason: z.string().nullable(),
});
export const poolKeySchema = z.object({
  ...version,
  currency0: addressSchema,
  currency1: addressSchema,
  fee: z.number().int().min(0).max(10_000),
  tickSpacing: z.number().int().positive(),
  hooks: addressSchema,
});
export const catalogPoolSchema = z.object({
  ...version,
  chainId: wireChain,
  adapterKind: z.literal("uniswap-v4"),
  poolId: poolIdSchema,
  poolKey: poolKeySchema,
  tokens: z.array(catalogTokenSchema).length(2),
  pairSymbols: z.array(z.string()).length(2),
  hooked: z.boolean(),
  currentTick: z.number().int(),
  sqrtPriceX96: uint,
  currentPrice: z.object({ ...version, token1PerToken0: decimal, token0PerToken1: decimal }),
  liquidity: uint,
  eligible: z.boolean(),
  registration: z.literal("at-fund-creation"),
  tvlUsd: decimal.nullable(),
  feesApr: decimal.nullable(),
  tvlUnavailableReason: z.string().nullable(),
  feesAprUnavailableReason: z.string().nullable(),
});
export const catalogReserveSchema = z.object({
  ...version,
  chainId: z.literal("42161"),
  adapterKind: z.literal("aave-v3"),
  mode: z.literal("supply"),
  token: catalogTokenSchema,
  poolKey: poolIdSchema,
  poolAddress: addressSchema,
  dataProviderAddress: addressSchema,
  aTokenAddress: addressSchema,
  supplyApy: decimal,
  supplyRateRay: uint,
  supplyCap: uint,
  currentSupply: z.object({ ...version, raw: uint, decimal }),
  active: z.boolean(),
  frozen: z.boolean(),
  paused: z.boolean(),
  supplyCapReached: z.boolean(),
  available: z.boolean(),
  mandateRequired: z.boolean(),
});
export const catalogTokensSchema = z.object({
  ...version,
  chainId: wireChain,
  tokens: z.array(catalogTokenSchema),
});
export const catalogPoolsSchema = z.object({
  ...version,
  chainId: wireChain,
  pools: z.array(catalogPoolSchema),
});
export const catalogReservesSchema = z.object({
  ...version,
  chainId: z.literal("42161"),
  reserves: z.array(catalogReserveSchema),
});
const chainDeployment = z.object({
  ...version,
  chainId: wireChain,
  spokeVault: addressSchema,
  uniswapV3SwapAdapter: addressSchema,
  uniswapV4Adapter: addressSchema.optional(),
  aaveV3Adapter: addressSchema.optional(),
  acrossBridgeAdapter: addressSchema.optional(),
  status: z.enum(["created", "pending"]),
});
const profile = z
  .object({
    ...version,
    spokeCapPercent: spokeCapPercentSchema.optional(),
    broadMandate: z.boolean().optional(),
  })
  .passthrough();
export const fundIdentitySchema = z.object({
  ...version,
  creationNumber: uint,
  fundId: poolIdSchema,
  manager: addressSchema,
  mandateHash: poolIdSchema,
  coreVault: addressSchema,
  shareToken: addressSchema,
  managerFeeVault: addressSchema.optional(),
  valueReportReceiver: addressSchema,
  chains: z.array(chainDeployment),
  profile: profile.nullable().optional(),
});
const adapter = z.object({ ...version, chainId: wireChain, adapter: addressSchema });
const spoke = z.object({
  ...version,
  chainId: wireChain,
  wormholeChainId: z.number().int(),
  spokeVault: poolIdSchema,
  spokeToken: addressSchema,
  spokeCap: uint,
  maxReportAge: z.number().int(),
});
export const mandateSchema = z.object({
  ...version,
  manager: addressSchema,
  hubChainId: z.literal("42161"),
  hubWormholeChainId: z.number().int(),
  usdc: addressSchema,
  tokens: z.array(z.object({ ...version, chainId: wireChain, token: addressSchema })).max(16),
  adapters: z.array(adapter),
  swapAdapters: z.array(adapter),
  pools: z.array(adapter.extend({ poolKey: poolIdSchema })),
  spokes: z.array(spoke),
  bridgeAdapters: z.array(adapter.extend({ spokeChainId: wireChain })),
  operatingCash: z.array(z.object({ ...version, chainId: wireChain, floor: uint, topUp: uint })),
  payoutFeeBps: z.number().int(),
  minFirstDeposit: uint,
  performanceFeeBps: z.number().int(),
  managementFeeBps: z.number().int(),
});
export const fundsSchema = z.object({
  ...version,
  funds: z.array(fundIdentitySchema),
  nextBlock: uint.optional(),
  discovery: z.string(),
});
export const fundDetailSchema = fundIdentitySchema
  .extend({
    mandate: mandateSchema,
    state: z.enum(["Open", "Closing", "Closed"]),
    fundState: z.number().int().min(0).max(2),
    sharePrice: uint,
    shareAssets: uint,
    grossAssets: uint,
    idle: uint,
    freeIdle: uint,
    payoutReserve: uint,
    inFlightValue: uint,
    totalSupply: uint,
  })
  .passthrough();
export type CatalogToken = z.infer<typeof catalogTokenSchema>;
export type CatalogPool = z.infer<typeof catalogPoolSchema>;
export type CatalogReserve = z.infer<typeof catalogReserveSchema>;
export type V2ChainId = z.infer<typeof chainIdSchema>;
