/**
 * @id PP-MGR (POO-309)
 * @name readErc20 tests
 * @implements-rules-version v1
 *
 * Generic ERC-20 decimals + raw balanceOf reads. Mocks viem's createPublicClient so no real RPC
 * calls are made; balances stay RAW (the caller formats with the decimals).
 */
import { describe, expect, it, vi } from "vitest";

const mockReadContract = vi.fn();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({ readContract: mockReadContract }),
  };
});

const { readErc20Decimals, readErc20Symbol, readErc20Balance } = await import("./readErc20");
const { RpcError } = await import("@/lib/account/readUsdcBalance");

const TOKEN = "0x0000000000000000000000000000000000000abc" as `0x${string}`;
const OWNER = "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`;
const BASE_CHAIN_ID = 8453;

describe("readErc20Decimals", () => {
  it("reads decimals() and returns a number", async () => {
    mockReadContract.mockResolvedValueOnce(18);
    expect(await readErc20Decimals(TOKEN, BASE_CHAIN_ID)).toBe(18);
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "decimals", address: TOKEN }),
    );
  });

  it("throws RpcError on read failure", async () => {
    mockReadContract.mockRejectedValueOnce(new Error("boom"));
    await expect(readErc20Decimals(TOKEN, BASE_CHAIN_ID)).rejects.toThrow(RpcError);
  });

  it("throws RpcError for an unsupported chain", async () => {
    await expect(readErc20Decimals(TOKEN, 999999)).rejects.toThrow(/Unsupported chain/);
  });
});

describe("readErc20Symbol", () => {
  it("reads symbol() and returns the string (POO-810 R7)", async () => {
    mockReadContract.mockResolvedValueOnce("WETH");
    expect(await readErc20Symbol(TOKEN, BASE_CHAIN_ID)).toBe("WETH");
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "symbol", address: TOKEN }),
    );
  });

  it("throws RpcError on read failure", async () => {
    mockReadContract.mockRejectedValueOnce(new Error("boom"));
    await expect(readErc20Symbol(TOKEN, BASE_CHAIN_ID)).rejects.toThrow(RpcError);
  });
});

describe("readErc20Balance", () => {
  it("returns the raw balanceOf result for the owner", async () => {
    mockReadContract.mockResolvedValueOnce(BigInt(2_500_000));
    const raw = await readErc20Balance(TOKEN, OWNER, BASE_CHAIN_ID);
    expect(raw).toBe(BigInt(2_500_000));
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "balanceOf", args: [OWNER] }),
    );
  });

  it("throws RpcError on read failure", async () => {
    mockReadContract.mockRejectedValueOnce(new Error("boom"));
    await expect(readErc20Balance(TOKEN, OWNER, BASE_CHAIN_ID)).rejects.toThrow(RpcError);
  });
});
