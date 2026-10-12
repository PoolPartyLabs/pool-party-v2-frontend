/**
 * @id PP-MGR-LIB-075
 * @name solanaBuilderRuntime
 * @implements-rules-version v1 (POO-2301)
 * @implements-rules-version v1 (POO-2343 R7: the Raydium seed carries the default pool)
 * @analytics-events none, pure local descriptor and draft binding.
 */

import type { BlockKind, SolanaLocalBlockConfig } from "../build/plan/buildPlan";
import { buildMandateCatalog, type MandateCatalog } from "../mandateCatalog";
import type { ProtocolId } from "../mandateDraft";
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
 * POO-2342 R4: add the Solana entries to a catalog. The API catalog (or the mock one) keeps every
 * field it has, including `loading`, `error`, `retry` and `validateDraft`, so a Solana entry never
 * hides the API load or error state. Added here: the Solana network, Kamino, Jupiter, Raydium and
 * Orca (each available on Solana only), the WSOL token and the USDC deposit token of Solana.
 * Known token metadata is not a market, balance, price-feed or execution capability.
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
