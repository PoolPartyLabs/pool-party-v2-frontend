/**
 * @id PP-MGR-LIB-075
 * @name solanaStockTokens tests
 * @implements-rules-version DEC-204 (POO-2262: the stock tokens and their Raydium pools are listed and unavailable)
 * @analytics-events none, pure catalog assertions.
 *
 * DEC-204: TSLAx and NVDAx are VISIBLE in the Manager V2 builder and never selectable, because their
 * swaps stay off while the stock oracle is off. The same holds for their Raydium CLMM pools. These
 * cases pin the Solana catalog entries, the pinned release pools, the order a Solana pool search
 * answers in, and that the builder's pinned list agrees with the release catalog of `lib/solana` and
 * the stock pools the v6 launch refuses, so the three lists cannot drift apart silently.
 */
import { describe, expect, it } from "vitest";
import { SOLANA_LP_CHOICES } from "@/lib/solana/lpChoices";
import { RAYDIUM_SOL_USDC_POOL, RAYDIUM_STOCK_POOLS } from "../launch/solanaV6Launch";
import { buildMandateCatalog } from "../mandateCatalog";
import type { MandatePoolRef } from "../mandateDraft";
import { DEFAULT_RAYDIUM_POOL_ADDRESS } from "./raydiumBlockPool";
import {
  buildSolanaBuilderCatalog,
  RAYDIUM_RELEASE_POOLS,
  SOLANA_STOCK_TOKENS,
  withRaydiumReleasePools,
} from "./solanaBuilderRuntime";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const TSLAX_POOL = "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF";
const NVDAX_POOL = "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

/** One pinned pool by index; the list is fixed, so a missing entry is a broken fixture. */
function pinned(index: number): MandatePoolRef {
  const pool = RAYDIUM_RELEASE_POOLS[index];
  if (!pool) throw new Error(`no pinned pool ${index}`);
  return pool;
}

describe("DEC-204: the Solana catalog lists the stock tokens as unavailable", () => {
  it("lists TSLAx and NVDAx after WSOL, unpriced, not eligible and with their reason", () => {
    const tokens = buildSolanaBuilderCatalog().tokensFor(["solana"], []);

    expect(tokens.map((token) => token.symbol)).toEqual(["WSOL", "TSLAx", "NVDAx"]);
    expect(tokens[0]?.unavailableReason).toBeUndefined();
    expect(tokens.slice(1)).toEqual([
      {
        address: TSLAX,
        symbol: "TSLAx",
        name: "Tesla xStock",
        network: "solana",
        logoUrl: null,
        priced: false,
        visualEligible: false,
        unavailableReason: "stockSwapsUnavailable",
      },
      {
        address: NVDAX,
        symbol: "NVDAx",
        name: "NVIDIA xStock",
        network: "solana",
        logoUrl: null,
        priced: false,
        visualEligible: false,
        unavailableReason: "stockSwapsUnavailable",
      },
    ]);
  });

  it("keeps the stock tokens off the EVM networks, whose lists stay as they were", () => {
    const catalog = buildSolanaBuilderCatalog();
    const evm = catalog.tokensFor(["arbitrum", "robinhood"], []);

    expect(evm).toEqual(buildMandateCatalog().tokensFor(["arbitrum", "robinhood"], []));
    expect(evm.some((token) => token.unavailableReason !== undefined)).toBe(false);
    expect(catalog.depositTokenFor("solana")?.unavailableReason).toBeUndefined();
  });
});

describe("DEC-204: the pinned Raydium release pools", () => {
  it("pins SOL/USDC (the default pool), TSLAx/USDC and NVDAx/USDC, in that order", () => {
    expect(
      RAYDIUM_RELEASE_POOLS.map((pool) => [
        pool.address,
        `${pool.token0.symbol}/${pool.token1.symbol}`,
      ]),
    ).toEqual([
      [DEFAULT_RAYDIUM_POOL_ADDRESS, "SOL/USDC"],
      [TSLAX_POOL, "TSLAx/USDC"],
      [NVDAX_POOL, "NVDAx/USDC"],
    ]);
    for (const pool of RAYDIUM_RELEASE_POOLS) {
      // The shape `mapRaydiumPair` gives a DEX Screener pair, with no measured value invented.
      expect(pool).toMatchObject({
        id: `solana:${pool.address}`,
        network: "solana",
        protocol: "raydium",
        feeBps: null,
        tvlUsd: null,
        aprPct: null,
        hasHook: false,
      });
    }
  });

  it("agrees with the release catalog of lib/solana and with the pools the v6 launch refuses", () => {
    const choices = new Map(SOLANA_LP_CHOICES.map((choice) => [String(choice.poolId), choice]));

    expect(RAYDIUM_RELEASE_POOLS.map((pool) => pool.address).sort()).toEqual(
      [...choices.keys()].sort(),
    );
    for (const pool of RAYDIUM_RELEASE_POOLS) {
      const choice = choices.get(pool.address);
      expect(choice?.tokens.map((token) => String(token.mint))).toEqual([
        pool.token0.address,
        pool.token1.address,
      ]);
      expect(RAYDIUM_STOCK_POOLS.has(pool.address)).toBe(choice?.stockMarketHoursRequired);
    }
    expect(pinned(0).address).toBe(RAYDIUM_SOL_USDC_POOL);
    expect(SOLANA_STOCK_TOKENS.map((token) => token.address)).toEqual(
      SOLANA_LP_CHOICES.filter((choice) => choice.stockMarketHoursRequired).map((choice) =>
        String(choice.tokens[0].mint),
      ),
    );
  });

  it("leads a search with the pinned pools that hold the searched mint, or both mints", () => {
    const addresses = (pools: MandatePoolRef[]) => pools.map((pool) => pool.address);

    expect(addresses(withRaydiumReleasePools([], USDC_MINT))).toEqual([
      DEFAULT_RAYDIUM_POOL_ADDRESS,
      TSLAX_POOL,
      NVDAX_POOL,
    ]);
    expect(addresses(withRaydiumReleasePools([], WSOL_MINT))).toEqual([
      DEFAULT_RAYDIUM_POOL_ADDRESS,
    ]);
    expect(addresses(withRaydiumReleasePools([], USDC_MINT, TSLAX))).toEqual([TSLAX_POOL]);
    expect(withRaydiumReleasePools([], WSOL_MINT, TSLAX)).toEqual([]);
    expect(withRaydiumReleasePools([], JUP)).toEqual([]);
  });

  it("lists a pool once, keeping the DEX Screener row and its measured values in the pinned place", () => {
    const measured: MandatePoolRef = { ...pinned(1), tvlUsd: 1234, volume24hUsd: 56 };
    const other: MandatePoolRef = {
      ...pinned(0),
      id: "solana:OtherPool",
      address: "OtherPool",
      tvlUsd: 9,
    };

    const found = withRaydiumReleasePools([other, measured], USDC_MINT);

    expect(found.map((pool) => pool.address)).toEqual([
      DEFAULT_RAYDIUM_POOL_ADDRESS,
      TSLAX_POOL,
      NVDAX_POOL,
      "OtherPool",
    ]);
    expect(found[1]).toBe(measured);
  });
});
