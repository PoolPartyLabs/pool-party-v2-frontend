/**
 * @id PP-BALANCES (POO-238, POO-808)
 * @name useTokenBalances.test
 * @implements-rules-version v1
 * Unit test for the wallet balance hook: loads holdings and derives the total + mock 24h change,
 * and the manual in-place refresh (POO-808): re-reads and swaps balances without a skeleton flash,
 * keeps the last balances on a failed refresh, and coalesces concurrent activations.
 *
 * getTokenBalances is mocked so the read sequence is controlled per test (mock mode returns it).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TokenBalance } from "./types";

const mockGetTokenBalances = vi.fn();
vi.mock("./getTokenBalances", () => ({
  getTokenBalances: (chainId?: number) => mockGetTokenBalances(chainId),
}));

const { useTokenBalances } = await import("./useTokenBalances");

/** A single-network USDC holding whose USD value equals `usd` (USDC is priced 1:1). */
function usdc(usd: number): TokenBalance {
  return {
    symbol: "USDC",
    name: "USD Coin",
    amount: usd,
    decimals: 6,
    usd,
    chainId: 8453,
    logoUrl: "u",
  };
}

afterEach(() => {
  mockGetTokenBalances.mockReset();
});

describe("useTokenBalances", () => {
  it("loads balances and derives the total and 24h change", async () => {
    mockGetTokenBalances.mockResolvedValue([usdc(1000), usdc(284.5)]);
    const { result } = renderHook(() => useTokenBalances());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.balances.length).toBe(2);
    expect(result.current.totalUsd).toBeCloseTo(1284.5, 1);
    expect(result.current.dayChangeUsd).toBe(58.4);
    expect(result.current.dayChangePct).toBeCloseTo(0.047, 3);
  });

  // POO-808 R1/R2: manual refresh re-reads and swaps the total in place — the spinner shows while
  // in flight, the loading skeleton never returns, and the previous total stays visible until the
  // new read resolves. Mirrors the reported bug: a frozen $0.31 refreshing up to the received $6.62.
  it("refreshes in place: spinner on, no skeleton, updates the total when the read resolves", async () => {
    mockGetTokenBalances.mockResolvedValueOnce([usdc(0.31)]);
    const { result } = renderHook(() => useTokenBalances());
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.totalUsd).toBeCloseTo(0.31, 2);

    // The wallet received more USDC; hold the next read open so the in-flight state is observable.
    let resolveRead: (next: TokenBalance[]) => void = () => {};
    mockGetTokenBalances.mockReturnValueOnce(
      new Promise<TokenBalance[]>((resolve) => {
        resolveRead = resolve;
      }),
    );

    act(() => {
      result.current.refresh();
    });

    // While in flight (R2): refreshing, NOT loading, previous total still shown.
    await waitFor(() => {
      expect(result.current.isRefreshing).toBe(true);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.totalUsd).toBeCloseTo(0.31, 2);

    await act(async () => {
      resolveRead([usdc(6.62)]);
    });

    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.totalUsd).toBeCloseTo(6.62, 2);
  });

  // POO-808 R3: a failed refresh keeps the last good balances on screen and never throws.
  it("keeps the last balances when a refresh read fails", async () => {
    mockGetTokenBalances.mockResolvedValueOnce([usdc(0.31)]);
    const { result } = renderHook(() => useTokenBalances());
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    mockGetTokenBalances.mockRejectedValueOnce(new Error("rpc down"));
    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.isRefreshing).toBe(false);
    });
    expect(result.current.totalUsd).toBeCloseTo(0.31, 2);
    expect(result.current.balances.length).toBe(1);
  });

  // POO-808 R5: activating refresh while one is in flight coalesces — exactly one extra read.
  it("coalesces concurrent refresh activations", async () => {
    mockGetTokenBalances.mockResolvedValue([usdc(1)]);
    const { result } = renderHook(() => useTokenBalances());
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    const callsAfterLoad = mockGetTokenBalances.mock.calls.length;

    await act(async () => {
      result.current.refresh();
      result.current.refresh();
    });

    expect(mockGetTokenBalances.mock.calls.length).toBe(callsAfterLoad + 1);
  });
});
