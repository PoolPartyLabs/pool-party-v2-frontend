/**
 * @id PP-CORE-LIB-043 (POO-810)
 * @name receivedAmounts tests
 * @implements-rules-version v1
 *
 * The pure presentation mapper (POO-810 R3/R5/R6): turns decoded receipt legs + their resolved
 * `{ symbol, decimals }` into display rows — the USDC leg as a USD number, the non-USDC leg as a
 * human token amount — plus the USDC total (drives the invest deployed figure + the collect/withdraw
 * USD body). POO-844: a leg whose meta didn't resolve is NOT dropped — it renders as a RAW base-unit
 * row (no `usd`) and flips `hasUnpricedLeg`, so the receipt can't collapse to an all-USDC total that
 * omits it.
 */
import { describe, expect, it } from "vitest";
import type { DecodedTransfer } from "./decodeExecutedAmounts";
import { buildReceivedLegs } from "./receivedAmounts";

const usdc: DecodedTransfer = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  isUsdc: true,
  rawValue: BigInt(12_340_000), // 12.34 USDC
};
const weth: DecodedTransfer = {
  address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  isUsdc: false,
  rawValue: BigInt(5_000_000_000_000_000), // 0.005 WETH
};

describe("buildReceivedLegs", () => {
  it("maps a USDC leg to a USD row (1:1, 6 decimals) and tallies usdcUsd (R3)", () => {
    // @rule R3
    const result = buildReceivedLegs([{ leg: usdc, meta: { symbol: "USDC", decimals: 6 } }]);
    expect(result.usdcUsd).toBeCloseTo(12.34, 6);
    expect(result.rows).toEqual([{ symbol: "USDC", amount: 12.34, usd: 12.34 }]);
  });

  it("maps a non-USDC leg to a token amount with no USD (R3)", () => {
    // @rule R3
    const result = buildReceivedLegs([{ leg: weth, meta: { symbol: "WETH", decimals: 18 } }]);
    expect(result.usdcUsd).toBe(0);
    expect(result.rows).toEqual([{ symbol: "WETH", amount: 0.005 }]);
  });

  it("maps a mixed pair: USDC USD row + token row, preserving order (R3/R5/R6)", () => {
    // @rule R3
    const result = buildReceivedLegs([
      { leg: usdc, meta: { symbol: "USDC", decimals: 6 } },
      { leg: weth, meta: { symbol: "WETH", decimals: 18 } },
    ]);
    expect(result.usdcUsd).toBeCloseTo(12.34, 6);
    expect(result.rows).toEqual([
      { symbol: "USDC", amount: 12.34, usd: 12.34 },
      { symbol: "WETH", amount: 0.005 },
    ]);
  });

  // @rule POO-844 R1 — an unpriced leg (meta did not resolve) is kept as a RAW base-unit row with a
  // short address label + NO `usd`, and flips `hasUnpricedLeg`. It used to be dropped, which made an
  // X/USDC pair look all-USDC and understated the receipt total.
  it("[POO-844] keeps an unpriced leg as a raw base-unit row + flips hasUnpricedLeg (was dropped)", () => {
    const result = buildReceivedLegs([
      { leg: usdc, meta: { symbol: "USDC", decimals: 6 } },
      { leg: weth, meta: undefined },
    ]);
    expect(result.usdcUsd).toBeCloseTo(12.34, 6);
    expect(result.hasUnpricedLeg).toBe(true);
    // The USDC leg keeps its USD row; the unpriced WETH leg is a RAW base-unit amount (no decimals
    // to scale it), labelled by a short address, carrying no `usd`.
    expect(result.rows).toEqual([
      { symbol: "USDC", amount: 12.34, usd: 12.34 },
      { symbol: "0x82aF…Bab1", amount: 5_000_000_000_000_000 },
    ]);
  });

  // @rule POO-844 R1 — an ALL-priced result never flips hasUnpricedLeg (the verbatim gate stays
  // eligible when every leg resolved).
  it("[POO-844] does not flip hasUnpricedLeg when every leg resolved", () => {
    const result = buildReceivedLegs([{ leg: usdc, meta: { symbol: "USDC", decimals: 6 } }]);
    expect(result.hasUnpricedLeg).toBe(false);
  });

  it("returns empty rows + zero usdcUsd for no legs (R9 fallback trigger)", () => {
    // @rule R9
    expect(buildReceivedLegs([])).toEqual({ rows: [], usdcUsd: 0, hasUnpricedLeg: false });
  });
});
