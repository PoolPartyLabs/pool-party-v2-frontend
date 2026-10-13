/**
 * @id PP-CORE-LIB-113 (POO-2133)
 * @name v2ApiSchemas
 * @implements-rules-version v1; v6 fund reads (POO-2262, pool-party-api `docs/SOLANA_API_CONTRACT.md` §3.8, §3.9)
 * Wire schemas from the October 3 catalog and fund API contracts. Fund reads also accept a v6
 * (Hub + Robinhood + Solana) Fund: Solana is chain "1" there, with its own entry shape and no EVM
 * addresses. Route parameters (`chainIdSchema`) and the catalog stay EVM-only.
 */
import { z } from "zod";

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const poolIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const chainIdSchema = z.union([z.literal(42161), z.literal(4663)]);
const wireChain = z.enum(["42161", "4663"]);
/** The wire id of the Solana spoke in v6 fund reads (API contract §3.8). Never a route parameter. */
export const SOLANA_FUND_CHAIN_ID = "1";
const fundWireChain = z.enum(["42161", "4663", SOLANA_FUND_CHAIN_ID]);
const base58Account = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
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
const evmChainDeployment = z.object({
  ...version,
  chainId: wireChain,
  spokeVault: addressSchema,
  uniswapV3SwapAdapter: addressSchema,
  uniswapV4Adapter: addressSchema.optional(),
  aaveV3Adapter: addressSchema.optional(),
  acrossBridgeAdapter: addressSchema.optional(),
  status: z.enum(["created", "pending"]),
});
/** §3.8: base58 accounts; `solana` is null while Solana is disabled or the Hub policy is unreadable. */
const solanaChainDeployment = z.object({
  ...version,
  chainId: z.literal(SOLANA_FUND_CHAIN_ID),
  status: z.enum(["created", "pending"]),
  solana: z
    .object({
      ...version,
      program: base58Account,
      fund: base58Account,
      vault: base58Account,
      usdcAta: base58Account,
    })
    .nullable(),
});
const chainDeployment = z.discriminatedUnion("chainId", [
  evmChainDeployment,
  solanaChainDeployment,
]);
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
const adapter = z.object({ ...version, chainId: fundWireChain, adapter: addressSchema });
const spoke = z.object({
  ...version,
  chainId: fundWireChain,
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
  tokens: z.array(z.object({ ...version, chainId: fundWireChain, token: addressSchema })).max(16),
  adapters: z.array(adapter),
  swapAdapters: z.array(adapter),
  pools: z.array(adapter.extend({ poolKey: poolIdSchema })),
  spokes: z.array(spoke),
  bridgeAdapters: z.array(adapter.extend({ spokeChainId: fundWireChain })),
  operatingCash: z.array(
    z.object({ ...version, chainId: fundWireChain, floor: uint, topUp: uint }),
  ),
  payoutFeeBps: z.number().int(),
  minFirstDeposit: uint,
  performanceFeeBps: z.number().int(),
  managementFeeBps: z.number().int(),
});
/** Seconds and indexes arrive as decimal strings or numbers; both normalize to a number. */
const wireCount = z.preprocess(
  (value) => (typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value),
  z.number().int().nonnegative(),
) as z.ZodType<number>;
/** §3.9: a spoke's report is usable when a transaction landing within the margin still sees it fresh. */
const reportFreshness = z.object({
  ...version,
  receiverIndex: wireCount,
  hasReport: z.boolean(),
  ageSeconds: wireCount.nullable(),
  maxReportAge: wireCount,
  marginSeconds: wireCount,
  usable: z.boolean(),
});
const spokeReportFields = {
  lastReport: z
    .object({ ...version, receiverIndex: wireCount, ageSeconds: wireCount })
    .passthrough()
    .nullable()
    .optional(),
  reportFreshness: reportFreshness.optional(),
};
/** `GET /funds/:core` spokes (every chain but the Hub), each with its own Hub-accepted report. */
const fundSpoke = z.discriminatedUnion("chainId", [
  evmChainDeployment.extend(spokeReportFields).passthrough(),
  solanaChainDeployment.extend(spokeReportFields).passthrough(),
]);
const fundSpokes = z.array(fundSpoke).optional();
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
    factory: addressSchema.optional(),
    // Display and gating detail only: a spoke list this client cannot read is dropped, never fatal.
    // The cast keeps input = output, which `v2Fetch(path, schema: ZodType<T>)` infers T from.
    spokes: fundSpokes.catch(undefined) as unknown as typeof fundSpokes,
    /** §3.9 deposit gate: every spoke's report is usable. Absent on an API without per-spoke reports. */
    reportsUsable: z.boolean().optional(),
  })
  .passthrough();
export type CatalogToken = z.infer<typeof catalogTokenSchema>;
export type CatalogPool = z.infer<typeof catalogPoolSchema>;
export type CatalogReserve = z.infer<typeof catalogReserveSchema>;
export type V2ChainId = z.infer<typeof chainIdSchema>;
export type FundChainDeployment = z.infer<typeof chainDeployment>;
export type EvmChainDeployment = z.infer<typeof evmChainDeployment>;
export type SolanaChainDeployment = z.infer<typeof solanaChainDeployment>;
export type FundSpoke = z.infer<typeof fundSpoke>;
export type FundReportFreshness = z.infer<typeof reportFreshness>;
/** An EVM deployment (Hub or Robinhood): the only kind with a spoke vault, adapters and an RPC. */
export function isEvmDeployment<Entry extends { chainId: string }>(
  entry: Entry,
): entry is Exclude<Entry, { chainId: typeof SOLANA_FUND_CHAIN_ID }> {
  return entry.chainId !== SOLANA_FUND_CHAIN_ID;
}
