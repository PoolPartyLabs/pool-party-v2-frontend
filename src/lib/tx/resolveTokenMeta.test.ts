/**
 * @id PP-CORE-LIB-042 (POO-810)
 * @name resolveTokenMeta tests
 * @implements-rules-version v1
 *
 * Resolve `{ decimals, symbol }` for a decoded receipt leg (POO-810 R7): USDC fast-path (config,
 * 6 decimals) → the position's non-USDC `currency` (by USDC-symbol elimination on the 2-token pool)
 * → an on-chain ERC-20 `decimals()`/`symbol()` read → undefined (then the caller drops the leg / R9).
 * The on-chain reads are injected so this unit-tests without a live chain.
 */
import { describe, expect, it, vi } from "vitest";
import type { DecodedTransfer } from "./decodeExecutedAmounts";
import { resolveTokenMeta } from "./resolveTokenMeta";

const USDC_LEG: DecodedTransfer = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  isUsdc: true,
  rawValue: BigInt(5_000_000),
};
const WETH_LEG: DecodedTransfer = {
  address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  isUsdc: false,
  rawValue: BigInt(3_000_000_000_000_000),
};
const CHAIN_ID = 42161;

const usdcCurrency = { symbol: "USDC", decimals: 6 };
const wethCurrency = { symbol: "WETH", decimals: 18 };

describe("resolveTokenMeta", () => {
  it("resolves the USDC leg from config (6 decimals) without any read (R7 fast-path)", async () => {
    // @rule R7
    const read = vi.fn();
    const meta = await resolveTokenMeta(USDC_LEG, {
      chainId: CHAIN_ID,
      currencies: [usdcCurrency, wethCurrency],
      readMeta: read,
    });
    expect(meta).toEqual({ symbol: "USDC", decimals: 6 });
    expect(read).not.toHaveBeenCalled();
  });

  it("resolves the non-USDC leg from the position's currency by USDC elimination (R7)", async () => {
    // @rule R7
    const read = vi.fn();
    const meta = await resolveTokenMeta(WETH_LEG, {
      chainId: CHAIN_ID,
      currencies: [usdcCurrency, wethCurrency],
      readMeta: read,
    });
    expect(meta).toEqual({ symbol: "WETH", decimals: 18 });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads on-chain when the non-USDC currency is unavailable (R7 on-chain fallback)", async () => {
    // @rule R7
    const read = vi.fn().mockResolvedValue({ symbol: "ARB", decimals: 18 });
    const meta = await resolveTokenMeta(WETH_LEG, {
      chainId: CHAIN_ID,
      currencies: undefined,
      readMeta: read,
    });
    expect(meta).toEqual({ symbol: "ARB", decimals: 18 });
    expect(read).toHaveBeenCalledWith(WETH_LEG.address, CHAIN_ID);
  });

  it("returns undefined when the on-chain read also fails (R9: caller drops the leg)", async () => {
    // @rule R9
    const read = vi.fn().mockRejectedValue(new Error("rpc down"));
    const meta = await resolveTokenMeta(WETH_LEG, {
      chainId: CHAIN_ID,
      currencies: undefined,
      readMeta: read,
    });
    expect(meta).toBeUndefined();
  });

  it("falls through to the on-chain read when both currencies are USDC-symbol'd (degenerate) (R7)", async () => {
    // @rule R7
    const read = vi.fn().mockResolvedValue({ symbol: "WETH", decimals: 18 });
    const meta = await resolveTokenMeta(WETH_LEG, {
      chainId: CHAIN_ID,
      currencies: [usdcCurrency, usdcCurrency],
      readMeta: read,
    });
    expect(meta).toEqual({ symbol: "WETH", decimals: 18 });
    expect(read).toHaveBeenCalled();
  });
});
