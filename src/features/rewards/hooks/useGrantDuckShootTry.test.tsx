/**
 * @id PP-REW (POO-764)
 * @name useGrantDuckShootTry tests
 * [R1][R2] Real-mode only, dedups granted tx hashes in localStorage, retries TX_NOT_FOUND (indexer
 * lag), and settles on granted / already-used / weekly-cap without re-granting.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ isMockMode: false }));
const grantAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return state.isMockMode;
  },
}));
vi.mock("../actions", () => ({
  grantDuckShootTryAction: (...args: unknown[]) => grantAction(...args),
}));

import { useGrantDuckShootTry } from "./useGrantDuckShootTry";

beforeEach(() => {
  state.isMockMode = false;
  grantAction.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGrantDuckShootTry", () => {
  it("no-ops in mock mode", () => {
    state.isMockMode = true;
    const { result } = renderHook(() => useGrantDuckShootTry());
    result.current("0xhash");
    expect(grantAction).not.toHaveBeenCalled();
  });

  it("no-ops without a tx hash", () => {
    const { result } = renderHook(() => useGrantDuckShootTry());
    result.current(undefined);
    expect(grantAction).not.toHaveBeenCalled();
  });

  it("grants once and dedups the same tx afterwards", async () => {
    grantAction.mockResolvedValue({ status: "granted", triesRemaining: 3, weeklyTriesLeft: 4 });
    const { result } = renderHook(() => useGrantDuckShootTry());

    result.current("0xhash");
    await vi.waitFor(() => expect(grantAction).toHaveBeenCalledOnce());
    // The wallet is derived server-side; the client only passes the tx hash.
    expect(grantAction).toHaveBeenCalledWith("0xhash");

    // Persisted → a second grant of the same tx is a no-op.
    result.current("0xhash");
    expect(grantAction).toHaveBeenCalledOnce();
  });

  it("skips a tx already in the localStorage dedup set", () => {
    window.localStorage.setItem("pp.duckShoot.grantedTxs", JSON.stringify(["0xseen"]));
    const { result } = renderHook(() => useGrantDuckShootTry());
    result.current("0xseen");
    expect(grantAction).not.toHaveBeenCalled();
  });

  it("retries TX_NOT_FOUND (indexer lag) then settles", async () => {
    vi.useFakeTimers();
    grantAction
      .mockResolvedValueOnce({ status: "tx_not_found" })
      .mockResolvedValueOnce({ status: "granted", triesRemaining: 2, weeklyTriesLeft: 3 });
    const { result } = renderHook(() => useGrantDuckShootTry());

    result.current("0xlag");
    // Flush the first attempt's promise (tx_not_found → schedules a retry).
    await vi.advanceTimersByTimeAsync(0);
    expect(grantAction).toHaveBeenCalledTimes(1);
    // Advance past the retry delay → the second attempt fires and settles.
    await vi.advanceTimersByTimeAsync(12_000);
    expect(grantAction).toHaveBeenCalledTimes(2);
  });
});
