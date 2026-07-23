/**
 * @id PP-ACCOUNT (POO-197)
 * @name useAccountService tests
 * @implements-rules-version v1
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const mockReadUsdcBalance = vi.fn();

vi.mock("./readUsdcBalance", () => ({
  readUsdcBalance: (...args: unknown[]) => mockReadUsdcBalance(...args),
  RpcError: class RpcError extends Error {},
}));

vi.mock("./getWalletKind", () => ({
  getWalletKind: () => "embedded",
}));

vi.mock("@/lib/services", () => ({
  isMockMode: true,
  accountService: {
    getUsdcBalance: vi.fn(async () => 50),
    getWalletKind: vi.fn(async () => "embedded"),
  },
}));

vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: [] }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined }),
  useChainId: () => 8453,
}));

const { useAccountService } = await import("./useAccountService");

describe("useAccountService", () => {
  it("returns the mock accountService in mock mode", () => {
    const { result } = renderHook(() => useAccountService());

    expect(result.current.getUsdcBalance).toBeTypeOf("function");
    expect(result.current.getWalletKind).toBeTypeOf("function");
  });

  it("mock mode getUsdcBalance returns the mock value", async () => {
    const { result } = renderHook(() => useAccountService());

    const balance = await result.current.getUsdcBalance();
    expect(balance).toBe(50);
  });

  it("mock mode getWalletKind returns the mock value", async () => {
    const { result } = renderHook(() => useAccountService());

    const kind = await result.current.getWalletKind();
    expect(kind).toBe("embedded");
  });
});
