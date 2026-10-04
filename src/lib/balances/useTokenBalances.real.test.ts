/** @id PP-BALANCES @implements-rules-version v1 (POO-2224) */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ address: "0xabc", holdings: vi.fn(), fallback: vi.fn() }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address }) }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("./walletHoldingsActions", () => ({ getWalletHoldingsAction: mocks.holdings }));
vi.mock("./getRealTokenBalances", () => ({ getRealTokenBalances: mocks.fallback }));

import { useTokenBalances } from "./useTokenBalances";

const holding = {
  symbol: "USDC",
  name: "USD Coin",
  amount: 12,
  decimals: 6,
  usd: 12,
  chainId: 42161,
  logoUrl: "",
};
beforeEach(() => {
  mocks.address = "0xabc";
  vi.clearAllMocks();
  mocks.holdings.mockResolvedValue(null);
  mocks.fallback.mockResolvedValue([holding]);
});
it("R1 uses current-address public fallback before SIWE and checks API identity", async () => {
  const { result } = renderHook(useTokenBalances);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(mocks.holdings).toHaveBeenCalledWith("0xabc");
  expect(mocks.fallback).toHaveBeenCalledWith("0xabc");
  expect(result.current.totalUsd).toBe(12);
});
it("R1 respects a successful empty holdings response", async () => {
  mocks.holdings.mockResolvedValue([]);
  const { result } = renderHook(useTokenBalances);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(mocks.fallback).not.toHaveBeenCalled();
  expect(result.current.balances).toEqual([]);
});
it("R4 does not retain the previous account's holdings when the new read fails", async () => {
  const { result, rerender } = renderHook(useTokenBalances);
  await waitFor(() => expect(result.current.totalUsd).toBe(12));
  mocks.address = "0xdef";
  mocks.fallback.mockRejectedValue(new Error("RPC unavailable"));
  act(() => rerender());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.balances).toEqual([]);
});
