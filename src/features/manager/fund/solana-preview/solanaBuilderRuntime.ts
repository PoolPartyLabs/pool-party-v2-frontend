/**
 * @id PP-MGR-LIB-075
 * @name solanaBuilderRuntime
 * @implements-rules-version v1 (POO-2301)
 * @implements-rules-version v1 (POO-2343 R7: the Raydium seed carries the default pool)
 * @implements-rules-version DEC-204 (POO-2262: the stock tokens and their Raydium pools are listed and unavailable)
 * @analytics-events none, pure local descriptor and draft binding.
 */

import type { BlockKind, SolanaLocalBlockConfig } from "../build/plan/buildPlan";
import {
  buildMandateCatalog,
  type MandateCatalog,
  type MandateCatalogToken,
} from "../mandateCatalog";
import type { MandatePoolRef, ProtocolId } from "../mandateDraft";
import { DEFAULT_RAYDIUM_POOL_ADDRESS } from "./raydiumBlockPool";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

export const SOLANA_LOCAL_CONFIGS: Partial<Record<BlockKind, SolanaLocalBlockConfig>> = {
  solanaOrcaPool: { catalogId: "solana:mainnet-beta:orca-whirlpools", pair: "SOL / USDC" },
  // POO-2343 R7: a new Raydium block starts on the default SOL/USDC pool. The picker gives the pools
  // of the mandate; this seed is the answer when the mandate has none.
  solanaRaydiumPool: {
    catalogId: "solana:mainnet-beta:raydium-clmm",
    pair: "SOL / USDC",
    poolAddress: DEFAULT_RAYDIUM_POOL_ADDRESS,
  },
  solanaKaminoSupply: { catalogId: "solana:mainnet-beta:kamino-supply", pair: "USDC / SOL" },
  solanaHolding: { catalogId: "solana:mainnet-beta:holding", pair: "USDC / SOL" },
};

/**
 * DEC-204: the stock tokens of the pinned Solana release catalog (the dev API
 * `GET /api/v2/funds/creation-options` lists them as `stock: true, swapAvailable: false`). The
 * builder lists them so a manager sees them, and never lets one into a mandate: their swaps stay off
 * while the stock oracle is off. Mints are case sensitive and never lower-cased.
 */
const TSLAX = {
  address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  symbol: "TSLAx",
  name: "Tesla xStock",
};
const NVDAX = {
  address: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  symbol: "NVDAx",
  name: "NVIDIA xStock",
};
export const SOLANA_STOCK_TOKENS: readonly { address: string; symbol: string; name: string }[] = [
  TSLAX,
  NVDAX,
];

const SOL_SIDE: MandatePoolRef["token0"] = {
  address: WSOL_MINT,
  symbol: "SOL",
  name: "Wrapped SOL",
  logoUrl: null,
};
const USDC_SIDE: MandatePoolRef["token1"] = {
  address: USDC_MINT,
  symbol: "USDC",
  name: "USD Coin",
  logoUrl: null,
};

/** One pinned Raydium CLMM pool, in the shape `mapRaydiumPair` gives a DEX Screener pair. */
function releasePool(address: string, token0: MandatePoolRef["token0"]): MandatePoolRef {
  return {
    // The id DEX Screener rows get (`solana:<pair address>`), so the two never list the same pool twice.
    id: `solana:${address}`,
    address,
    network: "solana",
    protocol: "raydium",
    token0,
    token1: USDC_SIDE,
    feeBps: null,
    feeTier: null,
    tvlUsd: null,
    aprPct: null,
    volume24hUsd: null,
    tierSharePct: null,
    hasHook: false,
  };
}

/**
 * DEC-204: the Raydium CLMM pools of the pinned release catalog. SOL/USDC is the default pool and
 * can be added. TSLAx/USDC and NVDAx/USDC are listed and refused: their stock side is an unavailable
 * catalog token, so `addPool` and the Pools step refuse them through the catalog, not through this list.
 */
export const RAYDIUM_RELEASE_POOLS: readonly MandatePoolRef[] = [
  releasePool(DEFAULT_RAYDIUM_POOL_ADDRESS, SOL_SIDE),
  releasePool("8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF", { ...TSLAX, logoUrl: null }),
  releasePool("49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6", { ...NVDAX, logoUrl: null }),
];

/**
 * DEC-204: the pinned release pools that answer a Solana pool search, first, then the DEX Screener
 * pools, with no pool twice. A pinned pool answers when it holds the searched mint (and the second
 * mint, when there is one). When DEX Screener also lists it, its row (with TVL and volume) takes the
 * pinned place, so the list keeps every measured value and invents none.
 */
export function withRaydiumReleasePools(
  found: readonly MandatePoolRef[],
  tokenAddress: string,
  secondTokenAddress?: string,
): MandatePoolRef[] {
  const holds = (pool: MandatePoolRef, mint: string) =>
    pool.token0.address === mint || pool.token1.address === mint;
  const pinned = RAYDIUM_RELEASE_POOLS.filter(
    (pool) =>
      holds(pool, tokenAddress) &&
      (secondTokenAddress === undefined || holds(pool, secondTokenAddress)),
  ).map((pool) => found.find((row) => row.address === pool.address) ?? pool);
  const listed = new Set(pinned.map((pool) => pool.address));
  return [...pinned, ...found.filter((row) => !listed.has(row.address))];
}

/**
 * POO-2342 R4: add the Solana entries to a catalog. The API catalog (or the mock one) keeps every
 * field it has, including `loading`, `error`, `retry` and `validateDraft`, so a Solana entry never
 * hides the API load or error state. Added here: the Solana network, Kamino, Jupiter, Raydium and
 * Orca (each available on Solana only), the WSOL token and the USDC deposit token of Solana.
 * Known token metadata is not a market, balance, price-feed or execution capability.
 *
 * DEC-204: the stock tokens (TSLAx, NVDAx) follow WSOL, listed with `unavailableReason`, never
 * eligible and never priced, so the Tokens step shows them disabled and no reducer accepts them.
 */
export function withSolanaCatalog(base: MandateCatalog): MandateCatalog {
  // PP-INTEGRATION-POINT: POO-2239/2240 own the real Solana mandate/catalog contract;
  // canonical WSOL/USDC metadata permits local drawing only and supplies no price-feed claim.
  const local: Array<{ id: ProtocolId; kind: "lending" | "swap" | "dex" }> = [
    { id: "kamino", kind: "lending" },
    { id: "jupiter", kind: "swap" },
    { id: "raydium", kind: "dex" },
    { id: "orca", kind: "dex" },
  ];
  return {
    ...base,
    networks: [
      ...base.networks,
      {
        id: "solana",
        name: "fundBuilder.networkNames.solana",
        isHub: false,
        available: true,
        brandColor: "#9945FF",
        chainId: null,
      },
    ],
    protocols: [
      ...base.protocols,
      ...local.map(({ id, kind }) => ({
        id,
        kind,
        name: `solanaPreview.protocols.${id}`,
        required: false,
        available: true,
        availableOn: ["solana" as const],
        captionKey: `fundBuilder.protocolCaptions.${kind}`,
      })),
    ],
    tokensFor(networks, protocols) {
      return [
        ...base.tokensFor(
          networks.filter((network) => network !== "solana"),
          protocols,
        ),
        ...(networks.includes("solana")
          ? [
              {
                address: WSOL_MINT,
                symbol: "WSOL",
                name: "Wrapped SOL",
                network: "solana" as const,
                logoUrl: "/protocols/solana-preview/solana.svg",
                priced: false,
                visualEligible: true,
              },
              ...SOLANA_STOCK_TOKENS.map(
                (token): MandateCatalogToken => ({
                  ...token,
                  network: "solana",
                  // No stock logo ships in `public/`, so the card draws the fallback token mark.
                  logoUrl: null,
                  priced: false,
                  visualEligible: false,
                  unavailableReason: "stockSwapsUnavailable",
                }),
              ),
            ]
          : []),
      ];
    },
    depositTokenFor(network) {
      if (network !== "solana") return base.depositTokenFor(network);
      return {
        address: USDC_MINT,
        symbol: "USDC",
        name: "USD Coin",
        network,
        logoUrl: null,
        priced: false,
        visualEligible: true,
      };
    },
  };
}

/** The mock catalog with the Solana entries (tests and stories). */
export function buildSolanaBuilderCatalog(): MandateCatalog {
  return withSolanaCatalog(buildMandateCatalog());
}
