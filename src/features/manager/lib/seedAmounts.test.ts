/**
 * @id PP-MGR-SCR-002 (POO-309, POO-878)
 * @name seedAmounts.test
 * @implements-rules-version v1
 *
 * Parsing rejects empty / non-numeric / zero; valid only when 0 < amount ≤ balance.
 * POO-878 rules v1: the wrapped-native funding helpers pick the leg's source (native vs ERC-20
 * WETH/WPOL), resolve the selected source's balance, and decide when the leg is fully exhausted.
 */
import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";
import {
  autoWrappedFunding,
  formatTokenAmount,
  NATIVE_MAX_GAS_RESERVE_USD,
  nativeMaxWithGasReserve,
  parseSeedAmount,
  seedTokensNeeded,
  seedValid,
  wrappedLegExhausted,
  wrappedSourceBalance,
} from "./seedAmounts";

describe("parseSeedAmount", () => {
  it("parses a decimal string to raw units for the token's decimals", () => {
    expect(parseSeedAmount("1.5", 6)).toBe(BigInt(1_500_000));
    expect(parseSeedAmount("2", 18)).toBe(BigInt("2000000000000000000"));
  });

  it("returns null for empty, non-numeric, or non-positive input", () => {
    expect(parseSeedAmount("", 6)).toBeNull();
    expect(parseSeedAmount("   ", 6)).toBeNull();
    expect(parseSeedAmount(".", 6)).toBeNull();
    expect(parseSeedAmount("abc", 6)).toBeNull();
    expect(parseSeedAmount("1.2.3", 6)).toBeNull();
    expect(parseSeedAmount("0", 6)).toBeNull();
    expect(parseSeedAmount("0.0", 6)).toBeNull();
  });
});

describe("formatTokenAmount", () => {
  it("formats raw units back to a decimal string", () => {
    expect(formatTokenAmount(BigInt(1_500_000), 6)).toBe("1.5");
    expect(formatTokenAmount(BigInt(0), 18)).toBe("0");
  });
});

describe("seedValid", () => {
  const balance = BigInt(1_000_000); // 1.0 at 6 decimals

  it("accepts a positive amount within balance", () => {
    expect(seedValid(BigInt(500_000), balance)).toBe(true);
    expect(seedValid(balance, balance)).toBe(true); // exactly max
  });

  it("rejects null, zero, or over-balance amounts", () => {
    expect(seedValid(null, balance)).toBe(false);
    expect(seedValid(BigInt(0), balance)).toBe(false);
    expect(seedValid(balance + BigInt(1), balance)).toBe(false);
  });
});

describe("seedTokensNeeded", () => {
  it("needs both tokens for a range straddling the current price", () => {
    expect(seedTokensNeeded(0, -100, 100)).toEqual({ needs0: true, needs1: true });
    // The lower bound is inclusive: current tick exactly at tickLower still needs both.
    expect(seedTokensNeeded(-100, -100, 100)).toEqual({ needs0: true, needs1: true });
  });

  it("needs only token0 when the range sits entirely above the current price", () => {
    // current tick below the whole range → position is all token0.
    expect(seedTokensNeeded(-500, -100, 100)).toEqual({ needs0: true, needs1: false });
  });

  it("needs only token1 when the range sits entirely below the current price", () => {
    // current tick at/above the upper bound → position is all token1.
    expect(seedTokensNeeded(100, -100, 100)).toEqual({ needs0: false, needs1: true });
    expect(seedTokensNeeded(500, -100, 100)).toEqual({ needs0: false, needs1: true });
  });

  it("defaults to both when the current tick or range is unknown", () => {
    expect(seedTokensNeeded(null, -100, 100)).toEqual({ needs0: true, needs1: true });
    expect(seedTokensNeeded(Number.NaN, -100, 100)).toEqual({ needs0: true, needs1: true });
    expect(seedTokensNeeded(0, null, 100)).toEqual({ needs0: true, needs1: true });
    expect(seedTokensNeeded(0, -100, null)).toEqual({ needs0: true, needs1: true });
  });
});

// POO-878 wrapped-native funding helpers ---------------------------------------------------------

describe("autoWrappedFunding (POO-878 R3)", () => {
  const native = BigInt("2000000000000000000"); // 2 native (ETH/POL), 18 decimals
  const erc20 = BigInt("5000000000000000000"); // 5 wrapped (WETH/WPOL), 18 decimals

  // @rule POO-878 R3: default native — a null amount (nothing typed yet) stays native while native
  // holds a balance.
  it("defaults to native when no amount is entered and native holds a balance", () => {
    expect(autoWrappedFunding(null, native, erc20)).toBe("native");
  });

  // @rule POO-878 R3/R4: at load (no amount) an empty native but a funded wrapped balance defaults to
  // wrapped, so the manager sees a usable balance instead of a misleading 0.
  it("defaults to erc20 when native is empty but the wrapped balance is funded (no amount yet)", () => {
    expect(autoWrappedFunding(null, BigInt(0), erc20)).toBe("erc20");
    expect(autoWrappedFunding(null, BigInt(0), BigInt(0))).toBe("native");
  });

  // @rule POO-878 R3: an amount native alone can cover stays native, even when WETH could also cover.
  it("stays native when native covers the amount", () => {
    expect(autoWrappedFunding(BigInt("1000000000000000000"), native, erc20)).toBe("native");
    expect(autoWrappedFunding(native, native, erc20)).toBe("native"); // exactly native
  });

  // @rule POO-878 R3: auto-switch to WETH only when native can't cover the amount but WETH can.
  it("switches to erc20 when native cannot cover but the wrapped balance can", () => {
    expect(autoWrappedFunding(BigInt("3000000000000000000"), native, erc20)).toBe("erc20");
  });

  // @rule POO-878 R4: when neither source covers the amount, keep native (over-balance/zero handles it).
  it("keeps native when neither source can cover the amount", () => {
    expect(autoWrappedFunding(BigInt("9000000000000000000"), native, erc20)).toBe("native");
  });
});

describe("wrappedSourceBalance (POO-878 R4)", () => {
  const native = BigInt(2);
  const erc20 = BigInt(5);

  it("returns the native balance for the native source", () => {
    expect(wrappedSourceBalance("native", native, erc20)).toBe(native);
  });

  it("returns the wrapped ERC-20 balance for the erc20 source", () => {
    expect(wrappedSourceBalance("erc20", native, erc20)).toBe(erc20);
  });
});

describe("nativeMaxWithGasReserve (POO-878 R5)", () => {
  // @rule POO-878 R5: Max on the NATIVE source reserves a flat $1.50-worth of native for gas.
  it("reserves $1.50-worth of native at the native price", () => {
    // $2500/native, 18 decimals: reserve = 1.5/2500 = 0.0006 native = 6e14 wei.
    const bal = parseUnits("1", 18);
    const reserve = parseUnits("0.0006", 18);
    expect(nativeMaxWithGasReserve(bal, 18, 2500)).toBe(bal - reserve);
  });

  // @rule POO-878 R5: never negative — a balance below the reserve clamps at 0.
  it("clamps at 0 when the balance is below the reserve", () => {
    expect(nativeMaxWithGasReserve(parseUnits("0.0005", 18), 18, 2500)).toBe(BigInt(0));
    expect(nativeMaxWithGasReserve(parseUnits("0.0006", 18), 18, 2500)).toBe(BigInt(0));
  });

  // @rule POO-878 R5: graceful fallback — no usable native price → full-balance Max (never blocked).
  it("falls back to the full balance when the native price is missing or zero", () => {
    const bal = parseUnits("2", 18);
    expect(nativeMaxWithGasReserve(bal, 18, undefined)).toBe(bal);
    expect(nativeMaxWithGasReserve(bal, 18, 0)).toBe(bal);
  });

  it("exposes the flat cross-chain USD reserve constant", () => {
    expect(NATIVE_MAX_GAS_RESERVE_USD).toBe(1.5);
  });
});

describe("wrappedLegExhausted (POO-878 R4)", () => {
  // @rule POO-878 R4: the zero-balance prompt fires only when NEITHER source can cover the leg.
  it("is exhausted only when both the native and the wrapped balance are zero", () => {
    expect(wrappedLegExhausted(BigInt(0), BigInt(0))).toBe(true);
    expect(wrappedLegExhausted(BigInt(1), BigInt(0))).toBe(false);
    expect(wrappedLegExhausted(BigInt(0), BigInt(1))).toBe(false);
    expect(wrappedLegExhausted(BigInt(1), BigInt(1))).toBe(false);
  });
});

// POO-497 R2: the no-price seed heuristic (seedTokensWhenPriceUnknown) is retired dead code — no-price
// pools no longer reach the seed step (they are filtered out of the picker, POO-497 R1). The former
// funded-token-heuristic tests are removed with the function.
