/**
 * @id PP-BALANCES (POO-814)
 * @name groupWalletBalances.test
 * @implements-rules-version v1
 * Unit tests for the wallet-modal holdings grouping: USDC first, then everything else, each group
 * sorted by USD desc, rows < $1 hidden (USDC and non-USDC alike). The total is NOT computed here
 * (it stays a Σ over all holdings incl. hidden dust).
 */
import { describe, expect, it } from "vitest";
import { groupWalletBalances } from "./groupWalletBalances";
import type { TokenBalance } from "./types";

function tb(overrides: Partial<TokenBalance> & { symbol: string; usd: number }): TokenBalance {
  return {
    name: overrides.symbol,
    amount: overrides.usd,
    decimals: 6,
    chainId: 8453,
    logoUrl: "l",
    ...overrides,
  };
}

describe("groupWalletBalances", () => {
  it("puts USDC first (across networks) and everything else in the other group", () => {
    const { usdc, others } = groupWalletBalances([
      tb({ symbol: "WETH", usd: 50, chainId: 42161 }),
      tb({ symbol: "USDC", usd: 100, chainId: 8453 }),
      tb({ symbol: "USDC", usd: 40, chainId: 42161 }),
      tb({ symbol: "DAI", usd: 30, chainId: 137 }),
    ]);
    expect(usdc.map((b) => b.symbol)).toEqual(["USDC", "USDC"]);
    expect(others.map((b) => b.symbol)).toEqual(["WETH", "DAI"]);
  });

  it("sorts each group by USD value descending", () => {
    const { usdc, others } = groupWalletBalances([
      tb({ symbol: "USDC", usd: 40, chainId: 42161 }),
      tb({ symbol: "USDC", usd: 100, chainId: 8453 }),
      tb({ symbol: "DAI", usd: 30, chainId: 137 }),
      tb({ symbol: "WETH", usd: 50, chainId: 42161 }),
    ]);
    expect(usdc.map((b) => b.usd)).toEqual([100, 40]);
    expect(others.map((b) => b.usd)).toEqual([50, 30]);
  });

  it("hides rows worth less than $1 — USDC and non-USDC alike", () => {
    const { usdc, others } = groupWalletBalances([
      tb({ symbol: "USDC", usd: 100, chainId: 8453 }),
      tb({ symbol: "USDC", usd: 0.42, chainId: 137 }), // USDC dust → hidden
      tb({ symbol: "WETH", usd: 50, chainId: 42161 }),
      tb({ symbol: "PEPE", usd: 0.35, chainId: 8453 }), // non-USDC dust → hidden
    ]);
    expect(usdc.map((b) => b.usd)).toEqual([100]);
    expect(others.map((b) => b.symbol)).toEqual(["WETH"]);
  });

  it("keeps a row worth exactly $1 (strictly < $1 is hidden)", () => {
    const { others } = groupWalletBalances([tb({ symbol: "ARB", usd: 1 })]);
    expect(others).toHaveLength(1);
  });

  it("identifies USDC case-insensitively", () => {
    const { usdc, others } = groupWalletBalances([tb({ symbol: "usdc", usd: 10 })]);
    expect(usdc).toHaveLength(1);
    expect(others).toHaveLength(0);
  });

  it("returns empty groups for no input or all-dust input", () => {
    expect(groupWalletBalances([])).toEqual({ usdc: [], others: [] });
    const allDust = groupWalletBalances([
      tb({ symbol: "USDC", usd: 0.5 }),
      tb({ symbol: "PEPE", usd: 0.1 }),
    ]);
    expect(allDust).toEqual({ usdc: [], others: [] });
  });
});
