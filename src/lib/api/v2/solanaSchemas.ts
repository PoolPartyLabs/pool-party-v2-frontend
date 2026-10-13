/**
 * @id PP-MGR-LIB-100 (POO-2262)
 * @name v2SolanaSchemas
 * @implements-rules-version DEC-188, DEC-190, DEC-191, DEC-204 (founder rulings, unversioned)
 * Wire contracts of pool-party-api `docs/SOLANA_API_CONTRACT.md` (§3.1-§3.13), parsed after the
 * `protocolVersion` tags are stripped. What the Manager signs or sends is validated strictly; the
 * review-only structs pass through.
 */
import { z } from "zod";
import { addressSchema, poolIdSchema } from "./schemas";

export const base58Schema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const uint = z.string().regex(/^\d{1,78}$/);
const hexData = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
const signatureHex = z.string().regex(/^0x[0-9a-fA-F]{130}$/);

/** §3.13: an EVM transaction the Manager sends as is (`gas` is the limit to send, when present). */
export const evmBuildSchema = z.object({
  chainId: z.union([z.literal(42161), z.literal(4663)]),
  to: addressSchema,
  from: addressSchema,
  data: hexData,
  value: uint,
  gas: uint.nullable().optional(),
  sendAfter: z.string().optional(),
});
export type EvmBuild = z.infer<typeof evmBuildSchema>;

/** §1: EIP-712 payloads come untagged with a NUMERIC domain chainId; signed as returned. */
export const typedDataSchema = z.object({
  domain: z
    .object({
      name: z.string(),
      version: z.string(),
      chainId: z.literal(42161),
      verifyingContract: addressSchema,
      salt: poolIdSchema.optional(),
    })
    .strict(),
  types: z.record(z.array(z.object({ name: z.string(), type: z.string() }).strict())),
  primaryType: z.string(),
  message: z.record(z.unknown()),
});
export type V2TypedData = z.infer<typeof typedDataSchema>;

/** §3.1: every Solana builder returns this. The API owns the blockhash. */
export const unsignedSolanaBuildSchema = z
  .object({
    transaction: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
    transactionVersion: z.literal(0),
    transactionBytes: z.number().int().positive().max(1232),
    blockhash: base58Schema,
    lastValidBlockHeight: z.number().int().positive(),
    computeUnitLimit: z.number().int().positive(),
    computeUnitsMeasured: z.boolean(),
    requiredSigners: z.array(base58Schema).min(1).max(4),
  })
  .passthrough();
export type UnsignedSolanaBuild = z.infer<typeof unsignedSolanaBuildSchema>;

export const creationOptionsSchema = z
  .object({
    available: z.boolean(),
    factory: addressSchema,
    hubChainId: z.literal(42161),
    program: base58Schema,
    assets: z.array(
      z
        .object({
          id: z.string(),
          symbol: z.string(),
          mint: base58Schema,
          decimals: z.number().int(),
          stock: z.boolean(),
          required: z.boolean(),
          default: z.boolean(),
          swapAvailable: z.boolean(),
        })
        .passthrough(),
    ),
    venues: z.array(
      z
        .object({
          id: z.string(),
          kind: z.enum(["kamino", "raydium"]),
          pair: z.string(),
          pool: base58Schema.nullable(),
          reserve: base58Schema.nullable(),
          requiresAssets: z.array(z.string()),
          default: z.boolean(),
          request: z.record(z.unknown()),
        })
        .passthrough(),
    ),
    fees: z
      .object({
        managementFeeBps: z.object({ min: z.number(), max: z.number(), default: z.number() }),
        performanceFeeBps: z.object({ min: z.number(), max: z.number(), default: z.number() }),
        payoutFeeBps: z.object({ min: z.number(), max: z.number(), default: z.number() }),
      })
      .passthrough(),
    seed: z.object({ token: addressSchema, decimals: z.number(), default: uint, minimum: uint }),
    mandate: z
      .object({ minFirstDeposit: uint, spokeCap: uint, maxReportAge: z.number() })
      .passthrough(),
  })
  .passthrough();
export type CreationOptions = z.infer<typeof creationOptionsSchema>;

const venueRequestSchema = z.union([
  z.object({ kind: z.literal("kamino"), reserve: base58Schema }).strict(),
  z.object({ kind: z.literal("raydium"), pool: base58Schema }).strict(),
]);
/** §3.13 request: the unsigned call, or the signed rebuild with all five pins. */
export const buildCreationRequestSchema = z
  .object({
    manager: addressSchema,
    managerSolanaKey: base58Schema,
    managementFeeBps: z.number().int().min(0).max(500).optional(),
    performanceFeeBps: z.number().int().min(1000).max(9000).optional(),
    payoutFeeBps: z.number().int().min(0).max(1000).optional(),
    assets: z
      .array(z.enum(["usdc", "wsol", "tslax", "nvdax"]))
      .min(2)
      .max(3)
      .optional(),
    venues: z.array(venueRequestSchema).min(1).max(4).optional(),
    seedAmount: uint.optional(),
    spokes: z.tuple([z.literal("robinhood"), z.literal("solana")]).optional(),
    bindingTtlSeconds: z.number().int().min(1800).max(86400).optional(),
    creationNumber: uint.nullable().optional(),
    bindingNonce: uint.nullable().optional(),
    bindingExpiry: uint.nullable().optional(),
    bindingSignature: signatureHex.nullable().optional(),
    swapPolicySignature: signatureHex.nullable().optional(),
  })
  .strict();
export type BuildCreationRequest = z.infer<typeof buildCreationRequestSchema>;

export const buildCreationSchema = z
  .object({
    status: z.enum(["awaiting-signatures", "ready", "created"]),
    factory: addressSchema,
    hubChainId: z.literal(42161),
    creationNumber: uint,
    fundId: poolIdSchema,
    core: addressSchema,
    predicted: z
      .object({
        hub: z.object({ core: addressSchema }).passthrough(),
        robinhood: z.object({ spokeVault: addressSchema }).passthrough(),
      })
      .passthrough(),
    solana: z
      .object({
        program: base58Schema,
        fundPda: base58Schema,
        vault: base58Schema,
        usdcAta: base58Schema,
        managerSolanaKey: base58Schema,
      })
      .passthrough(),
    policyHash: poolIdSchema,
    mandateHash: poolIdSchema,
    binding: z
      .object({
        nonce: uint,
        expiry: uint,
        expiresAt: z.string(),
        digest: poolIdSchema,
        typedData: typedDataSchema,
        signature: signatureHex.nullable(),
      })
      .passthrough(),
    swapPolicy: z
      .object({
        hash: poolIdSchema,
        digest: poolIdSchema,
        typedData: typedDataSchema,
        signature: signatureHex.nullable(),
      })
      .passthrough(),
    seed: z
      .object({
        amount: uint,
        token: addressSchema,
        allowance: uint,
        balance: uint,
        approveRequired: z.boolean(),
        balanceSufficient: z.boolean(),
      })
      .passthrough(),
    transactions: z.object({
      approve: evmBuildSchema.nullable(),
      createFund: evmBuildSchema.nullable(),
      createSpoke: evmBuildSchema.nullable(),
    }),
    robinhoodSpokeCreated: z.boolean(),
    nextAction: z.string(),
    nextRequests: z
      .object({
        buildCreation: z.object({ body: z.record(z.unknown()) }).passthrough(),
        solanaBootstrap: z.object({ body: z.record(z.unknown()) }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
export type BuildCreation = z.infer<typeof buildCreationSchema>;

/** §3.7 request, as `nextRequests.solanaBootstrap.body` of a ready/created plan. */
export const bootstrapRequestSchema = z
  .object({
    manager: base58Schema,
    nonce: uint,
    expiry: uint,
    signature: signatureHex,
    swapPolicy: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
    swapSignature: signatureHex.optional(),
  })
  .strict();
export const bootstrapSchema = z
  .object({
    policyHash: poolIdSchema,
    bindingDigest: poolIdSchema,
    fund: base58Schema,
    ordered: z.literal(true),
    transactions: z.array(unsignedSolanaBuildSchema).min(1).max(12),
  })
  .passthrough();

const solanaAccountsSchema = z
  .object({
    program: base58Schema,
    fund: base58Schema,
    vault: base58Schema,
    usdcAta: base58Schema,
  })
  .passthrough();
const reportFreshnessSchema = z
  .object({
    receiverIndex: z.number().int(),
    hasReport: z.boolean(),
    ageSeconds: uint.nullable(),
    maxReportAge: uint,
    usable: z.boolean(),
  })
  .passthrough();
/** §3.8/§3.9: what the journey needs from `GET /funds/:core`; EVM spoke entries keep their shape. */
export const solanaFundDetailSchema = z
  .object({
    coreVault: addressSchema,
    manager: addressSchema,
    chains: z.array(
      z
        .object({
          chainId: z.string(),
          status: z.string(),
          spokeVault: addressSchema.optional(),
          solana: solanaAccountsSchema.nullable().optional(),
        })
        .passthrough(),
    ),
    spokes: z
      .array(
        z
          .object({
            chainId: z.string(),
            status: z.string().optional(),
            reportFreshness: reportFreshnessSchema.optional(),
          })
          .passthrough(),
      )
      .optional(),
    reportsUsable: z.boolean().optional(),
    freeIdle: uint.optional(),
    sharePrice: uint.optional(),
    totalSupply: uint.optional(),
  })
  .passthrough();
export type SolanaFundDetail = z.infer<typeof solanaFundDetailSchema>;

export const sendToSolanaSchema = z
  .object({
    transactions: z.array(evmBuildSchema).length(1),
    preview: z
      .object({
        transitId: poolIdSchema,
        amount: uint,
        feeBps: z.number().int(),
        maxFee: uint,
        amountToArrive: uint,
        fast: z.boolean().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

const creditSchema = z
  .object({
    credited: z.boolean(),
    amount: uint.nullable(),
    destinationTxHash: z.string().nullable(),
  })
  .passthrough();
export const solanaTransitSchema = z
  .object({
    transitId: poolIdSchema,
    direction: z.enum(["hub-to-solana", "solana-to-hub"]),
    stage: z.enum(["sent", "attesting", "attested", "submitted", "credited", "acknowledged"]),
    cctp: z
      .object({
        status: z.enum(["pending", "attested", "submitted", "credited"]),
        sourceTxHash: z.string(),
        credit: creditSchema,
      })
      .passthrough()
      .nullable(),
    relay: z
      .object({
        mode: z.enum(["keeper", "manual", "unavailable"]),
        manualReceive: z.object({ available: z.boolean() }).passthrough(),
      })
      .passthrough(),
    retryAfterSeconds: z.number().nullable(),
  })
  .passthrough();
export type SolanaTransit = z.infer<typeof solanaTransitSchema>;
export const trackTransitSchema = z
  .object({ txHash: poolIdSchema, transits: z.array(solanaTransitSchema) })
  .passthrough();

export const solanaVenuesSchema = z
  .object({
    fund: base58Schema,
    vault: base58Schema,
    venues: z.array(
      z
        .object({
          kind: z.enum(["kamino", "raydium"]),
          reserve: base58Schema.nullable(),
          pool: base58Schema.nullable(),
          token0: base58Schema,
          token1: base58Schema.nullable(),
          pair: z.string(),
          swapAvailable: z.boolean(),
          adapterInitialized: z.boolean(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type SolanaVenues = z.infer<typeof solanaVenuesSchema>;

export const solanaBalancesSchema = z
  .object({
    chainId: z.literal("1"),
    balancesStatus: z.string(),
    tokens: z.array(
      z
        .object({
          token: base58Schema,
          stock: z.boolean(),
          decimals: z.number().int(),
          unallocatedBalance: uint,
          tokenAccountBalance: uint,
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type SolanaBalances = z.infer<typeof solanaBalancesSchema>;

export const raydiumPoolStateSchema = z
  .object({
    pool: base58Schema,
    mint0: base58Schema,
    mint1: base58Schema,
    decimals0: z.number().int(),
    decimals1: z.number().int(),
    tickSpacing: z.number().int().positive(),
    tickCurrent: z.number().int(),
    price: z.union([z.string(), z.number()]),
    minTick: z.number().int(),
    maxTick: z.number().int(),
  })
  .passthrough();
export type RaydiumPoolState = z.infer<typeof raydiumPoolStateSchema>;

export const solanaBuildSchema = unsignedSolanaBuildSchema.extend({
  raydium: z
    .object({
      pool: base58Schema,
      tickLower: z.number().int(),
      tickUpper: z.number().int(),
      liquidity: uint,
      expectedAmount0: uint,
      expectedAmount1: uint,
    })
    .passthrough()
    .optional(),
});

export const signedQuoteSchema = z
  .object({
    executionReady: z.literal(true),
    router: z.string(),
    transaction: unsignedSolanaBuildSchema,
    quote: z.object({ quotedAmountIn: uint, minAmountOut: uint }).passthrough(),
    maxPriceImpactBps: z.number().int(),
    envelope: z.record(z.unknown()),
  })
  .passthrough();

export const reportFreshSchema = z
  .object({
    source: z.literal("solana"),
    ageSeconds: z.union([z.number(), z.string()]).nullable(),
    usable: z.boolean(),
    refreshing: z.boolean(),
    jobId: z.string().nullable(),
    waitingOn: z.string().nullable(),
    retryAfterSeconds: z.number().nullable(),
  })
  .passthrough();
