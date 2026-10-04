import { describe, expect, it } from "vitest";
import type { CatalogPool } from "@/lib/api/v2/schemas";
import { composition, positionAmounts } from "./composition";

const base = `0x${"12".repeat(20)}`;
const other = `0x${"34".repeat(20)}`;
const pool = {
  currentPrice: { token1PerToken0: "4" },
  tokens: [
    { address: base, decimals: 6 },
    { address: other, decimals: 18 },
  ],
} as CatalogPool;
describe("range-derived launch composition [R2, R3]", () => {
  it("uses one-sided inputs outside range and real decimal interpolation inside", () => {
    expect(composition(pool, "5", "6").share0.toString()).toBe("1");
    expect(composition(pool, "1", "3").share1.toString()).toBe("1");
    const split = composition(pool, "1", "9");
    expect(split.share0.plus(split.share1).toString()).toBe("1");
    expect(() => composition(pool, "0", "9")).toThrow("INVALID_RANGE");
  });
  it("quotes only the missing token from the leaf net budget", () => {
    const amounts = positionAmounts(
      pool,
      { [base]: BigInt("100000000") },
      BigInt("100000000"),
      base,
      "1",
      "9",
    );
    expect(amounts.swapRaw > BigInt(0)).toBe(true);
    expect(amounts.swapRaw < BigInt("100000000")).toBe(true);
    expect(amounts.otherToken).toBe(other);
    expect(amounts.amount0).toBe("0.000000");
  });
  it("does not repeat a successful conversion on retry with actual token balances", () => {
    const amounts = positionAmounts(
      pool,
      { [base]: BigInt("100000000"), [other]: BigInt("1000000000000000000000") },
      BigInt("100000000"),
      base,
      "1",
      "9",
    );
    expect(amounts.swapRaw).toBe(BigInt(0));
    expect(Number(amounts.amount0)).toBeGreaterThan(0);
    const reversed = positionAmounts(
      pool,
      { [other]: BigInt("1000000000000000000000"), [base]: BigInt("100000000") },
      BigInt("100000000"),
      other,
      "1",
      "9",
    );
    expect(reversed.otherToken).toBe(base);
  });
  it("handles single-sided zero targets and rejects non-base pairs", () => {
    const amounts = positionAmounts(
      pool,
      { [base]: BigInt("100000000") },
      BigInt("100000000"),
      base,
      "5",
      "6",
    );
    expect(amounts.swapRaw).toBe(BigInt(0));
    expect(amounts.amount0).toBe("100.000000");
    expect(() => positionAmounts(pool, {}, BigInt(1), "missing", "1", "9")).toThrow(
      "UNSUPPORTED_PAIR",
    );
  });
  it("R1 caps base deposits by the unspent leaf budget even after a price change", () => {
    const amounts = positionAmounts(
      pool,
      { [base]: BigInt("900000"), [other]: BigInt("2000000000000000000") },
      BigInt("600000"),
      base,
      "1",
      "9",
      BigInt("500000"),
    );
    expect(Number(amounts.amount0)).toBeLessThanOrEqual(0.1);
    expect(amounts.swapRaw).toBe(BigInt(0));
  });
});
