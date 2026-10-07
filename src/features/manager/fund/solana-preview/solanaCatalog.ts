/**
 * @id PP-MGR-LIB-064
 * @name solanaCatalog
 * @description Local protocol descriptors with explicitly unavailable financial data/execution.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8679-382
 * @linear https://linear.app/yeildbay/issue/POO-2291
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, pure catalog; preview host retains existing intent events.
 */
import { z } from "zod";
import {
  solanaAddressSchema,
  solanaRawAmountSchema,
  solanaReadStateSchema,
  solanaTokenSchema,
  USDC_MINT,
} from "./solanaSchemas";

/** This catalog only defines local choices. Neither fixture nor observed values may fill it. */
const unavailable = z
  .object({
    status: z.literal("unavailable"),
    reason: z.literal("not-integrated"),
    source: z.null(),
  })
  .strict();
export const solanaLocalExecutionSchema = z
  .object({ status: z.literal("unavailable"), reason: z.literal("local-preview-only") })
  .strict();
const localContext = {
  network: z.literal("solana"),
  cluster: z.literal("mainnet-beta"),
  program: unavailable,
  position: unavailable,
  execution: solanaLocalExecutionSchema,
};
const lpFields = {
  pool: unavailable,
  canonicalMints: unavailable,
  tickGrid: unavailable,
  feeModel: unavailable,
  price: unavailable,
  liquidity: unavailable,
  principal: unavailable,
  fees: unavailable,
  rewards: unavailable,
};
const supplyUsdc = solanaTokenSchema.refine(
  (asset) =>
    asset.kind === "spl" &&
    asset.cluster === "mainnet-beta" &&
    asset.mint === USDC_MINT &&
    asset.decimals === 6,
  "Kamino Supply requires mainnet USDC",
);
export const solanaCatalogEntrySchema = z.discriminatedUnion("family", [
  z
    .object({
      ...localContext,
      id: z.literal("solana:mainnet-beta:kamino-supply"),
      protocol: z.literal("kamino"),
      family: z.literal("kamino-supply"),
      asset: supplyUsdc,
      market: unavailable,
      reserve: unavailable,
      accountRisk: unavailable,
      availableLiquidity: unavailable,
      supplyApy: unavailable,
      principal: unavailable,
      interest: unavailable,
      rewards: unavailable,
    })
    .strict(),
  z
    .object({
      ...localContext,
      id: z.literal("solana:mainnet-beta:jupiter-swap"),
      protocol: z.literal("jupiter"),
      family: z.literal("jupiter-swap"),
      inputMint: unavailable,
      outputMint: unavailable,
      quote: unavailable,
    })
    .strict(),
  z
    .object({
      ...localContext,
      ...lpFields,
      id: z.literal("solana:mainnet-beta:raydium-clmm"),
      protocol: z.literal("raydium"),
      family: z.literal("raydium-clmm"),
    })
    .strict(),
  z
    .object({
      ...localContext,
      ...lpFields,
      id: z.literal("solana:mainnet-beta:orca-whirlpools"),
      protocol: z.literal("orca"),
      family: z.literal("orca-whirlpools"),
    })
    .strict(),
  z
    .object({
      ...localContext,
      id: z.literal("solana:mainnet-beta:holding"),
      protocol: z.literal("holding"),
      family: z.literal("holding"),
      custody: unavailable,
      asset: unavailable,
      quantity: unavailable,
      wrapPlan: unavailable,
    })
    .strict(),
]);
export type SolanaCatalogEntry = z.infer<typeof solanaCatalogEntrySchema>;
const absent = { status: "unavailable", reason: "not-integrated", source: null } as const;
const context = {
  network: "solana",
  cluster: "mainnet-beta",
  program: absent,
  position: absent,
  execution: { status: "unavailable", reason: "local-preview-only" },
} as const;
const lp = {
  pool: absent,
  canonicalMints: absent,
  tickGrid: absent,
  feeModel: absent,
  price: absent,
  liquidity: absent,
  principal: absent,
  fees: absent,
  rewards: absent,
} as const;
/** Metadata uses the official mainnet mint. Financial reads remain unavailable.
 * PP-INTEGRATION-POINT: POO-2239/2240 will separately bind verified Solana discovery and read models.
 */
export const SOLANA_LOCAL_CATALOG: readonly SolanaCatalogEntry[] = [
  solanaCatalogEntrySchema.parse({
    ...context,
    id: "solana:mainnet-beta:kamino-supply",
    protocol: "kamino",
    family: "kamino-supply",
    asset: {
      network: "solana",
      cluster: "mainnet-beta",
      kind: "spl",
      symbol: "USDC",
      mint: USDC_MINT,
      decimals: 6,
      unit: "base-units",
    },
    market: absent,
    reserve: absent,
    accountRisk: absent,
    availableLiquidity: absent,
    supplyApy: absent,
    principal: absent,
    interest: absent,
    rewards: absent,
  }),
  solanaCatalogEntrySchema.parse({
    ...context,
    id: "solana:mainnet-beta:jupiter-swap",
    protocol: "jupiter",
    family: "jupiter-swap",
    inputMint: absent,
    outputMint: absent,
    quote: absent,
  }),
  solanaCatalogEntrySchema.parse({
    ...context,
    ...lp,
    id: "solana:mainnet-beta:raydium-clmm",
    protocol: "raydium",
    family: "raydium-clmm",
  }),
  solanaCatalogEntrySchema.parse({
    ...context,
    ...lp,
    id: "solana:mainnet-beta:orca-whirlpools",
    protocol: "orca",
    family: "orca-whirlpools",
  }),
];
/** Holding remains a contract descriptor until its own local UI slice. */
export const SOLANA_HOLDING_DESCRIPTOR = solanaCatalogEntrySchema.parse({
  ...context,
  id: "solana:mainnet-beta:holding",
  protocol: "holding",
  family: "holding",
  custody: absent,
  asset: absent,
  quantity: absent,
  wrapPlan: absent,
});
export type SolanaLocalProtocol = Exclude<SolanaCatalogEntry["protocol"], "holding">;
export const SOLANA_LOCAL_PROTOCOLS: readonly SolanaLocalProtocol[] = SOLANA_LOCAL_CATALOG.flatMap(
  (entry) => (entry.protocol === "holding" ? [] : [entry.protocol]),
);

/** Local instance ownership does not turn a catalog/pool ID into a position identity. */
export const solanaLocalInstanceSchema = z
  .object({
    localId: z.string().min(1).max(128),
    catalogId: z.enum([
      "solana:mainnet-beta:kamino-supply",
      "solana:mainnet-beta:jupiter-swap",
      "solana:mainnet-beta:raydium-clmm",
      "solana:mainnet-beta:orca-whirlpools",
      "solana:mainnet-beta:holding",
    ]),
    position: unavailable,
  })
  .strict();
export type SolanaLocalInstance = z.infer<typeof solanaLocalInstanceSchema>;

const quoteValidity = solanaReadStateSchema(
  z.object({ expiresAt: z.string().datetime({ offset: true }) }).strict(),
);
const transactionValidity = solanaReadStateSchema(
  z
    .object({ blockhash: solanaAddressSchema, lastValidBlockHeight: solanaRawAmountSchema })
    .strict(),
);
const inspection = {
  inputMint: solanaAddressSchema,
  outputMint: solanaAddressSchema,
  rawInput: solanaRawAmountSchema,
  quoteValidity,
  transactionValidity,
  execution: solanaLocalExecutionSchema,
};
/** A typed inspection does not authorize transaction assembly or execution.
 * PP-INTEGRATION-POINT: POO-2261/2262 must verify quote/transaction validity and executor separately.
 */
export const jupiterInspectionSchema = z
  .discriminatedUnion("mode", [
    z
      .object({
        ...inspection,
        mode: z.literal("managed-order-execute"),
        requestId: z.string().min(1).max(128),
      })
      .strict(),
    z
      .object({
        ...inspection,
        mode: z.literal("composable-build"),
        instructionPrograms: z.array(solanaAddressSchema).max(64),
      })
      .strict(),
  ])
  .refine((entry) => entry.inputMint !== entry.outputMint, "Swap mints must differ");
export type JupiterInspection = z.infer<typeof jupiterInspectionSchema>;
