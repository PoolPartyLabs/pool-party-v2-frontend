/** @id PP-CP-HOOK-002 @name Cash+ interactive demo behavior rules @implements-rules-version v1 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCashPlusDemo } from "./useCashPlusDemo";

describe("Cash+ demo controller", () => {
  beforeEach(() => sessionStorage.clear());
  // @rule R1: invalid input does not move simulated funds and can be dismissed safely.
  it("reports an invalid amount and clears the error without moving funds", async () => {
    const { result } = renderHook(() => useCashPlusDemo(true));
    await act(() => result.current.review("deposit", "0.5"));
    expect(result.current.transaction.errorCode).toBe("AMOUNT_INVALID");
    expect(result.current.wallet.balanceAssets).toBe(BigInt(25000000000));
    act(() => result.current.resetTransaction());
    expect(result.current.transaction.phase).toBe("idle");
  });
  // @rule R2: double confirmation cannot apply one operation twice.
  it("applies a double-clicked confirmation exactly once and exposes pending", async () => {
    const { result } = renderHook(() => useCashPlusDemo(true));
    const before = result.current.wallet.balanceAssets ?? BigInt(0);
    await act(() => result.current.review("deposit", "1000"));
    let first: Promise<void>;
    act(() => {
      first = result.current.confirm();
    });
    expect(result.current.transaction.phase).toBe("pending");
    await act(async () => {
      await Promise.all([first, result.current.confirm()]);
    });
    expect(result.current.transaction.phase).toBe("success");
    expect(result.current.wallet.balanceAssets).toBe(before - BigInt(1000000000));
  });
  // @rule R3: refresh/remount preserves balances; explicit reset restores reproducible starting amounts.
  it("persists a completed investment and resets the demo", async () => {
    const first = renderHook(() => useCashPlusDemo(true));
    await act(() => first.result.current.review("deposit", "1000"));
    await act(() => first.result.current.confirm());
    const invested = first.result.current.snapshot?.investedAssets;
    first.unmount();
    const second = renderHook(() => useCashPlusDemo(true));
    expect(second.result.current.snapshot?.investedAssets).toBe(invested);
    await act(() => second.result.current.refresh());
    expect(second.result.current.wallet.balanceAssets).toBe(BigInt(24000000000));
    act(() => second.result.current.demo?.reset());
    expect(second.result.current.wallet.balanceAssets).toBe(BigInt(25000000000));
    expect(second.result.current.snapshot?.investedAssets).toBe(BigInt(100000000000));
    expect(second.result.current.transaction.phase).toBe("idle");
  });
  // @rule R4: explicit elapsed time invalidates an earlier quote before it can be confirmed.
  it("invalidates an old review when advancing a simulated day", async () => {
    const { result } = renderHook(() => useCashPlusDemo(true));
    await act(() => result.current.review("deposit", "1000"));
    await act(() => result.current.demo?.advanceDay());
    expect(result.current.transaction.errorCode).toBe("QUOTE_EXPIRED");
    await act(() => result.current.confirm());
    expect(result.current.wallet.balanceAssets).toBe(BigInt(25000000000));
    expect(result.current.snapshot?.interestAssets).toBeGreaterThan(BigInt(73400000));
  });
  // @rule R5: reset during the artificial delay prevents stale completion from overwriting the reset.
  it("ignores a delayed operation after reset", async () => {
    const { result } = renderHook(() => useCashPlusDemo(true));
    await act(() => result.current.review("deposit", "1000"));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.confirm();
    });
    act(() => result.current.demo?.reset());
    await act(async () => {
      await pending;
    });
    expect(result.current.transaction.phase).toBe("idle");
    expect(result.current.wallet.balanceAssets).toBe(BigInt(25000000000));
  });
  // @rule R6: disabled demo has no state and cannot change session storage.
  it("does not activate demo state in a real mode", async () => {
    const { result } = renderHook(() => useCashPlusDemo(false));
    await act(() => result.current.review("deposit", "1000"));
    await act(() => result.current.confirm());
    expect(result.current.snapshot).toBeNull();
    expect(result.current.demo).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });
});
