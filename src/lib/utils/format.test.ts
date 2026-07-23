import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatIdentityLabel,
  formatPercent,
  formatPoolTvl,
  formatSignedUsd,
  formatSignedUsdTile,
  formatTokenAmount,
  formatTokenAmountParts,
  formatTxHash,
  formatUsd,
  formatUsdCompact,
  formatUsdPrecise,
  formatUsdTile,
} from "./format";

describe("format utils", () => {
  it("formats USD with two decimals and thousands separators", () => {
    expect(formatUsd(4532.5)).toBe("$4,532.50");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("formats USD at full token precision, trimming trailing zeros", () => {
    // The exact spendable wallet balance must survive display (POO-303): no 2dp rounding.
    expect(formatUsdPrecise(38.005424)).toBe("$38.005424");
    expect(formatUsdPrecise(50)).toBe("$50");
    expect(formatUsdPrecise(38.4)).toBe("$38.4");
    expect(formatUsdPrecise(1234.5)).toBe("$1,234.5");
  });

  it("formats compact USD for large figures", () => {
    expect(formatUsdCompact(1_250_000)).toBe("$1.25M");
    expect(formatUsdCompact(880_000)).toBe("$880K");
  });

  it("[POO-843 R4] formats KPI-tile USD: exact below $1M, compact at/above so 7-figure values fit a half-width tile", () => {
    // Below the $1M threshold → the exact figure (same as formatUsd), so small tiles never change.
    expect(formatUsdTile(0)).toBe("$0.00");
    expect(formatUsdTile(4532.5)).toBe("$4,532.50");
    expect(formatUsdTile(999_999.99)).toBe("$999,999.99");
    // At / above the threshold → compact K/M/B/T (the overflow case R4 targets).
    expect(formatUsdTile(1_000_000)).toBe("$1M");
    expect(formatUsdTile(1_234_567.89)).toBe("$1.23M");
    expect(formatUsdTile(30_000_000)).toBe("$30M");
    // Negatives compact past the threshold on magnitude, keeping their sign; small negatives stay exact.
    expect(formatUsdTile(-2_500_000)).toBe("-$2.5M");
    expect(formatUsdTile(-4532.5)).toBe("-$4,532.50");
  });

  it("[POO-843 R4/B2] formats a signed KPI-tile delta: exact signed below $1M, signed-compact at/above", () => {
    // Below the threshold → the exact signed figure (same as formatSignedUsd); small deltas unchanged.
    expect(formatSignedUsdTile(0)).toBe("$0.00");
    expect(formatSignedUsdTile(612.5)).toBe("+$612.50");
    expect(formatSignedUsdTile(-120)).toBe("-$120.00");
    expect(formatSignedUsdTile(999_999.99)).toBe("+$999,999.99");
    // At / above → signed compact (the 7-figure yield overflow B2 fixes).
    expect(formatSignedUsdTile(1_000_000)).toBe("+$1M");
    expect(formatSignedUsdTile(1_234_567.89)).toBe("+$1.23M");
    expect(formatSignedUsdTile(-2_500_000)).toBe("-$2.5M");
  });

  it("[POO-390 R5] formats pool TVL, dashing missing or zero (never $0, never the managed value)", () => {
    // Present pool TVL renders as compact USD, same as any large figure.
    expect(formatPoolTvl(18_300_000)).toBe("$18.3M");
    expect(formatPoolTvl(880_000)).toBe("$880K");
    // Missing / zero → a neutral dash. R5: it must NOT fall back to $0 or the managed position value.
    expect(formatPoolTvl(undefined)).toBe("-");
    expect(formatPoolTvl(0)).toBe("-");
    expect(formatPoolTvl(Number.NaN)).toBe("-");
  });

  it("formats signed USD deltas", () => {
    expect(formatSignedUsd(612.5)).toBe("+$612.50");
    expect(formatSignedUsd(-120)).toBe("-$120.00");
    expect(formatSignedUsd(0)).toBe("$0.00");
  });

  it("formats percentages from already-percent values", () => {
    expect(formatPercent(7.4)).toBe("7.4%");
    expect(formatPercent(8.4, 2)).toBe("8.40%");
  });

  it("formats token amounts with their symbol", () => {
    expect(formatTokenAmount(12.85, "USDC")).toBe("12.85 USDC");
  });

  describe("formatTokenAmount across magnitudes (POO-229)", () => {
    // @rule R3: |x| >= 1 → up to maxDecimals, trailing zeros trimmed, en-US thousands separators.
    it("groups and trims large/whole amounts", () => {
      expect(formatTokenAmount(1_250_000.5, "USDC")).toBe("1,250,000.5 USDC");
      expect(formatTokenAmount(1000, "USDC")).toBe("1,000 USDC");
      expect(formatTokenAmount(38.005424, "USDC", 4)).toBe("38.0054 USDC");
    });

    // @rule R6: exact 0 stays "0"; negatives keep their sign.
    it("keeps zero as zero and preserves the sign", () => {
      expect(formatTokenAmount(0, "USDC")).toBe("0 USDC");
      expect(formatTokenAmount(-12.5, "USDC")).toBe("-12.5 USDC");
    });

    // @rule R4: 1 > |x| >= 1e-4 → ~4 significant figures, plain decimal (no subscript).
    it("uses significant figures for sub-1 amounts above 1e-4", () => {
      expect(formatTokenAmount(0.0001234, "USDC")).toBe("0.0001234 USDC");
      expect(formatTokenAmount(0.5, "USDC")).toBe("0.5 USDC");
    });

    // @rule R5: 0 < |x| < 1e-4 → subscript-zero (DEX-style), zeroCount = leading zeros after the dot.
    it("compresses ultra-tiny amounts into subscript-zero notation", () => {
      expect(formatTokenAmount(0.00001234, "TKN")).toBe("0.0₄1234 TKN");
      expect(formatTokenAmount(1.234e-16, "TKN")).toBe("0.0₁₅1234 TKN");
    });

    // @rule R1 + R2: the original bug — under the smart default (no explicit precision) a nonzero
    // amount must never render as "0" or in scientific notation; subscript-zero preserves it.
    it("never renders a nonzero amount as 0 or scientific (the tiny-amount bug)", () => {
      expect(formatTokenAmount(1e-16, "TKN")).toBe("0.0₁₅1 TKN");
      expect(formatTokenAmount(1e-16, "TKN")).not.toBe("0 TKN");
      expect(formatTokenAmount(1e-16, "TKN")).not.toContain("e-");
    });
  });

  // POO-303 / FIX-1: an explicit maxFractionDigits wins for EVERY magnitude — plain fixed-decimal at
  // that precision (Decimal-exact, trailing zeros trimmed), bypassing the sig-fig + subscript-zero
  // smart defaults. This is what lets InvestModal render the exact Permit2-signed hero.
  describe("formatTokenAmount honors explicit maxFractionDigits for all magnitudes (POO-303)", () => {
    // @rule R4: explicit precision on a sub-1 value is NOT truncated to 4 significant figures.
    it("renders the exact sub-1 amount at explicit precision (signing exactness)", () => {
      expect(formatTokenAmount(0.123456, "USDC", 6)).toBe("0.123456 USDC");
      // guard: not the 4-sig-fig smart form
      expect(formatTokenAmount(0.123456, "USDC", 6)).not.toBe("0.1235 USDC");
    });

    // @rule R5: explicit precision bypasses subscript-zero — a small value below 1e-4 renders plain.
    it("renders a <1e-4 amount as plain fixed-decimal, not subscript, under explicit precision", () => {
      expect(formatTokenAmount(0.000012, "USDC", 6)).toBe("0.000012 USDC");
      expect(formatTokenAmount(0.000012, "USDC", 6)).not.toContain("₀");
      expect(formatTokenAmount(0.000012, "USDC", 6)).not.toContain("sub");
    });

    // @rule R3: trailing zeros are trimmed even under explicit precision.
    it("trims trailing zeros under explicit precision", () => {
      expect(formatTokenAmount(0.1, "USDC", 6)).toBe("0.1 USDC");
      expect(formatTokenAmount(0.12, "USDC", 6)).toBe("0.12 USDC");
    });

    // @rule R3: grouping is kept for the integer part when |x| >= 1 under explicit precision.
    it("keeps thousands grouping for the integer part under explicit precision", () => {
      expect(formatTokenAmount(1_234.5, "USDC", 6)).toBe("1,234.5 USDC");
    });

    // @rule R4 + R5: with NO explicit precision, the smart default is unchanged (regression guard).
    it("leaves the smart default unchanged when precision is omitted", () => {
      // sub-1 above 1e-4 → 4 significant figures
      expect(formatTokenAmount(0.123456, "USDC")).toBe("0.1235 USDC");
      // < 1e-4 → subscript-zero
      expect(formatTokenAmount(0.000012, "USDC")).toBe("0.0₄12 USDC");
    });
  });

  describe("formatTokenAmountParts (POO-229)", () => {
    // @rule R7: parts expose the subscript count and the exact value for the render component.
    it("returns structured parts for an ultra-tiny amount", () => {
      const parts = formatTokenAmountParts(1.234e-16, "TKN");
      expect(parts).toEqual({
        sign: "",
        lead: "0.0",
        zeroCount: 15,
        trail: "1234",
        text: "0.0₁₅1234",
        exact: "0.0000000000000001234",
        symbol: "TKN",
      });
    });

    it("returns plain parts (no subscript) for a normal amount", () => {
      const parts = formatTokenAmountParts(12.85, "USDC");
      expect(parts.zeroCount).toBe(0);
      expect(parts.lead).toBe("12.85");
      expect(parts.text).toBe("12.85");
      expect(parts.exact).toBe("12.85");
    });
  });

  it("shortens transaction hashes to first 6 + last 4", () => {
    expect(formatTxHash("0x7a3f5b8c0d1e2f4a6b8c0d1e2f4a6b8c0d1e9c2e")).toBe("0x7a3f…9c2e");
    expect(formatTxHash("0xshort")).toBe("0xshort");
  });

  // POO-841 R2 — identity rows must never render a raw address/hash id.
  describe("formatIdentityLabel (POO-841 R2)", () => {
    it("shortens a raw 40-hex address", () => {
      expect(formatIdentityLabel("0x357d9d041f953ae4885998c475744c500eba8d1a")).toBe("0x357d…8d1a");
    });

    it("shortens the 66-char position id from the screenshot bug", () => {
      expect(
        formatIdentityLabel("0x357d9d041f953ae4885998c475744c500eba8d1a4cb26ccc3627c2ce553fd64c"),
      ).toBe("0x357d…d64c");
    });

    it("returns a real strategy name unchanged", () => {
      expect(formatIdentityLabel("Delta-Neutral Farming")).toBe("Delta-Neutral Farming");
    });

    it("leaves a short or non-hex 0x-ish string alone", () => {
      expect(formatIdentityLabel("0xNotAnAddress")).toBe("0xNotAnAddress");
    });
  });

  it("formats integer counts pinned to en-US with thousands separators", () => {
    expect(formatCount(15_021)).toBe("15,021");
    expect(formatCount(5_000_000)).toBe("5,000,000");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(48)).toBe("48");
    expect(formatCount(0)).toBe("0");
  });
});
