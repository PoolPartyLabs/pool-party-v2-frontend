/**
 * @id PP-MGR (POO-306)
 * @name seedUsdValue tests
 * @implements-rules-version v1
 */
import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";
import { seedUsdValue } from "./seedUsdValue";

describe("seedUsdValue", () => {
  it("sums each side's USD value (amount × price)", () => {
    // 1 ETH @ $1700 + 1700 USDC @ $1 = $3400.
    const value = seedUsdValue(parseUnits("1", 18), 18, 1700, parseUnits("1700", 6), 6, 1);
    expect(value).toBeCloseTo(3400, 2);
  });

  it("treats an empty side as zero", () => {
    const value = seedUsdValue(parseUnits("5", 6), 6, 1, null, 6, 1);
    expect(value).toBe(5);
  });

  it("returns null when a USD price is unavailable (minimum not enforced)", () => {
    expect(seedUsdValue(parseUnits("1", 18), 18, undefined, parseUnits("1", 6), 6, 1)).toBeNull();
    expect(
      seedUsdValue(parseUnits("1", 18), 18, 1700, parseUnits("1", 6), 6, undefined),
    ).toBeNull();
  });

  it("returns null when decimals are not yet resolved", () => {
    expect(seedUsdValue(parseUnits("1", 18), null, 1700, parseUnits("1", 6), 6, 1)).toBeNull();
  });
});
