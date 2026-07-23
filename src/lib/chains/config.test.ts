/**
 * @id PP-CORE-SETUP (POO-195)
 * @name Chain config tests
 * @implements-rules-version v1
 *
 * Drift-guard tests for the single-source chain config. Ensures wagmi, Privy, USDC, and CSP
 * all derive from the same array, and that per-chain metadata is correct.
 */

import { arbitrum, base, polygon } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  type ChainMeta,
  defaultChain,
  getChainById,
  getExplorerTxUrl,
  getUsdcAddress,
  isWrappedNative,
  nativeSymbol,
  supportedChainMetas,
  supportedChains,
  transportMap,
  wrappedNativeSymbol,
} from "./config";

describe("chain config (POO-195)", () => {
  // [AC-1] Single source array with all 3 chains.
  it("exports exactly Arbitrum, Base, and Polygon", () => {
    const ids = supportedChains.map((c) => c.id);
    expect(ids).toEqual([arbitrum.id, base.id, polygon.id]);
  });

  it("exports a transport for every supported chain", () => {
    for (const chain of supportedChains) {
      expect(transportMap).toHaveProperty(String(chain.id));
    }
  });

  // [AC-2] USDC per chain correct.
  it("maps USDC on Arbitrum to 0xaf88d065e77c8cC2239327C5EDb3A432268e5831", () => {
    expect(getUsdcAddress(arbitrum.id)).toBe("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
  });

  it("maps USDC on Base to 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", () => {
    expect(getUsdcAddress(base.id)).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  it("recognizes the wrapped-native token per chain (case-insensitive), nothing else", () => {
    expect(isWrappedNative(base.id, "0x4200000000000000000000000000000000000006")).toBe(true);
    expect(
      isWrappedNative(base.id, "0x4200000000000000000000000000000000000006".toUpperCase()),
    ).toBe(true);
    expect(isWrappedNative(arbitrum.id, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1")).toBe(true);
    expect(isWrappedNative(polygon.id, "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270")).toBe(true);
    // A non-wrapped token (USDC) and an unsupported chain are false.
    expect(isWrappedNative(base.id, getUsdcAddress(base.id) as string)).toBe(false);
    expect(isWrappedNative(1, "0x4200000000000000000000000000000000000006")).toBe(false);
  });

  it("maps USDC on Polygon to 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", () => {
    expect(getUsdcAddress(polygon.id)).toBe("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359");
  });

  it("returns decimals 6 for every USDC", () => {
    for (const meta of supportedChainMetas) {
      expect(meta.usdc.decimals).toBe(6);
    }
  });

  // [AC-3] defaultChain matches NEXT_PUBLIC_CHAIN_ID (8453 = Base in .env.example).
  it("resolves defaultChain from NEXT_PUBLIC_CHAIN_ID", () => {
    // In test env, NEXT_PUBLIC_CHAIN_ID is unset, so default should be Base (8453).
    expect(defaultChain.id).toBe(base.id);
  });

  // Lookup helpers.
  it("getChainById returns the chain for a known id", () => {
    expect(getChainById(42161)?.id).toBe(arbitrum.id);
    expect(getChainById(137)?.id).toBe(polygon.id);
  });

  it("getChainById returns undefined for unknown id", () => {
    expect(getChainById(999999)).toBeUndefined();
  });

  it("getUsdcAddress returns undefined for unknown chain", () => {
    expect(getUsdcAddress(999999)).toBeUndefined();
  });

  // CSP derivability: RPC URLs are exposed so csp.ts can import them.
  it("exposes rpcUrl for every chain", () => {
    for (const meta of supportedChainMetas) {
      expect(meta.rpcUrl).toMatch(/^https:\/\//);
    }
  });

  // @rule POO-505 R1: the explorer tx URL derives from the viem chain metadata per network slug.
  it("getExplorerTxUrl builds the /tx/ URL for every supported network", () => {
    const hash = "0xabc123";
    expect(getExplorerTxUrl("arbitrum", hash)).toBe("https://arbiscan.io/tx/0xabc123");
    expect(getExplorerTxUrl("base", hash)).toBe("https://basescan.org/tx/0xabc123");
    expect(getExplorerTxUrl("polygon", hash)).toBe("https://polygonscan.com/tx/0xabc123");
  });

  // @rule POO-505 R1/R2: no network or no hash never yields a home/hardcoded URL — it yields nothing.
  it("getExplorerTxUrl returns undefined without a network or a hash", () => {
    expect(getExplorerTxUrl("solana", "0xabc")).toBeUndefined();
    expect(getExplorerTxUrl(undefined, "0xabc")).toBeUndefined();
    expect(getExplorerTxUrl("base", null)).toBeUndefined();
    expect(getExplorerTxUrl("base", "")).toBeUndefined();
  });

  // @rule POO-540 R1: the native token symbol derives from the viem chain per network slug —
  // POL on Polygon, ETH on the EVM L2s. Never hardcoded.
  it("nativeSymbol maps each network slug to its viem native currency symbol", () => {
    expect(nativeSymbol("arbitrum")).toBe(arbitrum.nativeCurrency.symbol);
    expect(nativeSymbol("base")).toBe(base.nativeCurrency.symbol);
    expect(nativeSymbol("polygon")).toBe(polygon.nativeCurrency.symbol);
    // Concrete symbols per today's viem: ETH on the L2s, POL on Polygon.
    expect(nativeSymbol("arbitrum")).toBe("ETH");
    expect(nativeSymbol("base")).toBe("ETH");
    expect(nativeSymbol("polygon")).toBe("POL");
  });

  // @rule POO-540 R4: an unknown or missing network degrades to the ETH default (previous behavior),
  // never crashes.
  it("nativeSymbol falls back to ETH for an unknown or missing network", () => {
    expect(nativeSymbol("solana")).toBe("ETH");
    expect(nativeSymbol(undefined)).toBe("ETH");
    expect(nativeSymbol(null)).toBe("ETH");
    expect(nativeSymbol("")).toBe("ETH");
  });

  // @rule POO-878 R1: the wrapped-native token symbol for the seed funding selector's ERC-20 option —
  // "W" prefixed on the native symbol (WETH on the L2s, WPOL on Polygon). Falls back to WETH.
  it("wrappedNativeSymbol prefixes the native symbol with W per network", () => {
    expect(wrappedNativeSymbol("arbitrum")).toBe("WETH");
    expect(wrappedNativeSymbol("base")).toBe("WETH");
    expect(wrappedNativeSymbol("polygon")).toBe("WPOL");
    expect(wrappedNativeSymbol("solana")).toBe("WETH");
    expect(wrappedNativeSymbol(undefined)).toBe("WETH");
  });
});
