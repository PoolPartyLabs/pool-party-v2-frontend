/**
 * @id PP-BALANCES (POO-239)
 * @name getRealTokenBalances tests
 * @implements-rules-version v1
 *
 * Real on-chain wallet balances: one USDC entry per network with a non-zero balance, priced 1:1,
 * tolerant of per-network RPC failures. readUsdcBalance is mocked (no real RPC).
 */
import { describe, expect, it, vi } from "vitest";

const mockReadUsdcBalance = vi.fn();
vi.mock("@/lib/account/readUsdcBalance", () => ({
  readUsdcBalance: (address: `0x${string}`, chainId: number) =>
    mockReadUsdcBalance(address, chainId),
}));

const { getRealTokenBalances } = await import("./getRealTokenBalances");

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`;
// Supported network chain ids.
const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

describe("getRealTokenBalances", () => {
  it("returns one USDC holding per network with a non-zero balance, priced 1:1", async () => {
    mockReadUsdcBalance.mockImplementation(async (_address: `0x${string}`, chainId: number) => {
      if (chainId === ARBITRUM) return 5;
      if (chainId === POLYGON) return 0.13;
      return 0; // base: omitted
    });

    const balances = await getRealTokenBalances(ADDRESS);

    expect(balances).toHaveLength(2);
    expect(balances.every((b) => b.symbol === "USDC" && b.usd === b.amount)).toBe(true);
    expect(balances.map((b) => b.chainId).sort((a, b) => a - b)).toEqual([POLYGON, ARBITRUM]);
    // Base held zero → omitted entirely.
    expect(balances.map((b) => b.chainId)).not.toContain(BASE);
  });

  it("skips a network whose RPC read fails instead of hiding funds held elsewhere", async () => {
    mockReadUsdcBalance.mockImplementation(async (_address: `0x${string}`, chainId: number) => {
      if (chainId === ARBITRUM) throw new Error("rpc down");
      return 2; // base + polygon
    });

    const balances = await getRealTokenBalances(ADDRESS);

    expect(balances).toHaveLength(2);
    expect(balances.map((b) => b.chainId)).not.toContain(ARBITRUM);
    expect(balances.every((b) => b.amount === 2)).toBe(true);
  });

  it("returns an empty list when the wallet holds no USDC anywhere", async () => {
    mockReadUsdcBalance.mockResolvedValue(0);
    expect(await getRealTokenBalances(ADDRESS)).toEqual([]);
  });
});
