/**
 * @id PP-ACCOUNT (POO-197)
 * @name readUsdcBalance tests
 * @implements-rules-version v1
 *
 * Tests for the on-chain USDC balance reader. Mocks viem's createPublicClient
 * so no real RPC calls are made.
 */
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const mockReadContract = vi.fn();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({ readContract: mockReadContract }),
  };
});

const { readUsdcBalance, RpcError } = await import("./readUsdcBalance");

// Base chain ID = 8453, USDC decimals = 6
const TEST_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`;
const BASE_CHAIN_ID = 8453;

describe("readUsdcBalance", () => {
  // [AC-1] getUsdcBalance() reads balanceOf(address) on USDC[chainId] -> USD number
  it("converts raw USDC balance to a human-readable number (1500000 raw -> 1.5)", async () => {
    mockReadContract.mockResolvedValueOnce(BigInt(1_500_000));

    const balance = await readUsdcBalance(TEST_ADDRESS, BASE_CHAIN_ID);

    expect(balance).toBe(1.5);
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "balanceOf",
        args: [TEST_ADDRESS],
      }),
    );
  });

  // [AC-2] Returns 0 (not throw) when wallet holds no USDC
  it("returns 0 when the wallet holds no USDC", async () => {
    mockReadContract.mockResolvedValueOnce(BigInt(0));

    const balance = await readUsdcBalance(TEST_ADDRESS, BASE_CHAIN_ID);

    expect(balance).toBe(0);
  });

  it("handles a large balance correctly", async () => {
    // 10,000 USDC = 10_000_000_000 raw (6 decimals)
    mockReadContract.mockResolvedValueOnce(BigInt(10_000_000_000));

    const balance = await readUsdcBalance(TEST_ADDRESS, BASE_CHAIN_ID);

    expect(balance).toBe(10_000);
  });

  // [AC-4] RPC failure surfaces a typed/handled error, not silent NaN
  it("throws RpcError on RPC failure", async () => {
    mockReadContract.mockRejectedValueOnce(new Error("network timeout"));

    await expect(readUsdcBalance(TEST_ADDRESS, BASE_CHAIN_ID)).rejects.toThrow(RpcError);
    await expect(readUsdcBalance(TEST_ADDRESS, BASE_CHAIN_ID)).rejects.toThrow(
      /Failed to read USDC balance/,
    );
  });

  it("throws RpcError for unsupported chain", async () => {
    await expect(readUsdcBalance(TEST_ADDRESS, 999999)).rejects.toThrow(RpcError);
    await expect(readUsdcBalance(TEST_ADDRESS, 999999)).rejects.toThrow(/Unsupported chain/);
  });

  // POO-303: full 6-decimal precision survives the raw → human conversion (no 2dp truncation), so the
  // exact spendable balance can be signed into the Permit2 single.
  it("preserves full USDC precision (38005424 raw -> 38.005424)", async () => {
    mockReadContract.mockResolvedValueOnce(BigInt(38_005_424));

    const balance = await readUsdcBalance(TEST_ADDRESS, BASE_CHAIN_ID);

    expect(balance).toBe(38.005424);
  });
});
