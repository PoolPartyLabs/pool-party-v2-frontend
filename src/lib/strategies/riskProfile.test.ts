/**
 * @id PP-STR (POO-298)
 * @name risk profile classifier tests
 * @implements-rules-version v1
 *
 * [R3] riskLevel derived from the token pair: steady→1, dynamic→3, wild→5.
 */
import { describe, expect, it } from "vitest";
import { getRiskLevel, getRiskProfile } from "./riskProfile";

describe("getRiskProfile", () => {
  it("[R3] both stablecoins → steady", () => {
    expect(getRiskProfile("USDC", "USDT")).toBe("steady");
    expect(getRiskProfile("DAI", "USDC")).toBe("steady");
  });

  it("[R3] both known with a major → dynamic", () => {
    expect(getRiskProfile("ETH", "USDC")).toBe("dynamic");
    expect(getRiskProfile("WETH", "WBTC")).toBe("dynamic");
    expect(getRiskProfile("USDC", "BTC")).toBe("dynamic");
  });

  it("[R3] any unknown token → wild", () => {
    expect(getRiskProfile("ARB", "USDC")).toBe("wild");
    expect(getRiskProfile("FOO", "BAR")).toBe("wild");
    expect(getRiskProfile("ETH", "PEPE")).toBe("wild");
  });

  it("[R3] is case-insensitive on symbols", () => {
    expect(getRiskProfile("usdc", "usdt")).toBe("steady");
    expect(getRiskProfile("eth", "usdc")).toBe("dynamic");
  });
});

describe("getRiskLevel", () => {
  it("[R3] maps steady→1, dynamic→3, wild→5", () => {
    expect(getRiskLevel("USDC", "USDT")).toBe(1);
    expect(getRiskLevel("ETH", "USDC")).toBe(3);
    expect(getRiskLevel("ARB", "USDC")).toBe(5);
  });
});
