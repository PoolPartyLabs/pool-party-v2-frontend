/**
 * @id PP-REW (POO-853)
 * @name useReferralOperationLog tests
 *
 * [R6] Real-mode only, fire-and-forget, dedups logged tx hashes in localStorage so an effect re-render
 * can't double-post the same operation. The wallet + referrer code are resolved server-side.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ isMockMode: false }));
const logAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return state.isMockMode;
  },
}));
vi.mock("../actions", () => ({
  logReferralOperationAction: (...args: unknown[]) => logAction(...args),
}));

import { useReferralOperationLog } from "./useReferralOperationLog";

const OP = { operation: "ADD_LIQUIDITY" as const, amountUsd: 100, txHash: "0xhash" };

beforeEach(() => {
  state.isMockMode = false;
  logAction.mockReset();
  logAction.mockResolvedValue(undefined);
  window.localStorage.clear();
});

describe("useReferralOperationLog", () => {
  it("no-ops in mock mode", () => {
    state.isMockMode = true;
    const { result } = renderHook(() => useReferralOperationLog());
    result.current(OP);
    expect(logAction).not.toHaveBeenCalled();
  });

  it("no-ops without a tx hash", () => {
    const { result } = renderHook(() => useReferralOperationLog());
    result.current({ ...OP, txHash: "" });
    expect(logAction).not.toHaveBeenCalled();
  });

  it("logs the operation once and dedups the same tx afterwards", async () => {
    const { result } = renderHook(() => useReferralOperationLog());

    result.current(OP);
    await vi.waitFor(() => expect(logAction).toHaveBeenCalledOnce());
    expect(logAction).toHaveBeenCalledWith(OP);

    // Persisted → a second log of the same tx (e.g. an effect re-render) is a no-op.
    result.current(OP);
    expect(logAction).toHaveBeenCalledOnce();
  });

  it("skips a tx already in the localStorage dedup set", () => {
    window.localStorage.setItem("pp.referral.loggedOps", JSON.stringify(["0xseen"]));
    const { result } = renderHook(() => useReferralOperationLog());
    result.current({ ...OP, txHash: "0xseen" });
    expect(logAction).not.toHaveBeenCalled();
  });
});
