/**
 * @id PP-BALANCES (POO-238)
 * @name getTokenBalances.test
 * @implements-rules-version v1
 * Unit tests for the mock token-balance source: shape, zero-balance hiding, and chain filtering.
 */
import { describe, expect, it } from "vitest";
import { getTokenBalances } from "./getTokenBalances";

describe("getTokenBalances", () => {
  it("returns holdings with a token amount and a USD value", async () => {
    const balances = await getTokenBalances();
    expect(balances.length).toBeGreaterThan(0);
    for (const balance of balances) {
      expect(balance.amount).toBeGreaterThan(0);
      expect(balance.usd).toBeGreaterThanOrEqual(0);
      expect(typeof balance.symbol).toBe("string");
      expect(typeof balance.logoUrl).toBe("string");
    }
  });

  it("hides zero balances", async () => {
    const balances = await getTokenBalances();
    expect(balances.every((balance) => balance.amount > 0)).toBe(true);
  });

  it("filters to a single chain when chainId is provided", async () => {
    const base = await getTokenBalances(8453);
    expect(base.length).toBeGreaterThan(0);
    expect(base.every((balance) => balance.chainId === 8453)).toBe(true);
  });

  it("merges all chains when no chainId is given", async () => {
    const all = await getTokenBalances();
    const chainIds = new Set(all.map((balance) => balance.chainId));
    expect(chainIds.size).toBeGreaterThan(1);
  });
});
