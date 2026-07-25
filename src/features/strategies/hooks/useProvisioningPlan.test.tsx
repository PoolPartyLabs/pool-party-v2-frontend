/**
 * @id PP-CORE-HOK-019 (POO-1023)
 * @name useProvisioningPlan tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1023 rules v1):
 *   [R1] the hook resolves plans through the `computePlan` seam ONLY, never `mockComputePlan`
 *   [R3] `computePlan` is async, so the hook exposes a pending state and never yields a half-plan
 *   [R4] a valid explicit gas choice re-plans; an absent one does not
 *
 * [R2] (mock-mode parity) and [R5] (both PP-FIXMEs deleted) are asserted in
 * `provisioningSeam.test.ts`, which is a source-level guard rather than a behavioral one.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "@/lib/provisioning";
import { useProvisioningPlan } from "./useProvisioningPlan";

// [R1] The seam is the ONLY plan source, so it is the only thing the hook may call.
const computePlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/provisioning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provisioning")>()),
  computePlan,
}));

const INPUT: ProvisioningNeedInput = {
  nativeBalanceUsd: 0,
  usdcBalanceUsd: 0,
  currentChainId: 8453,
  targetChainId: 42161,
  opRequiredUsdc: 100,
  gasEstimateUsd: 0.5,
};

/** A minimal plan; the hook is a pass-through, so only identity matters here. */
function planStub(marker: string): ProvisioningPlan {
  return {
    needed: true,
    reason: ["usdc"],
    variant: "multi",
    steps: [{ type: "op", key: marker, labelKey: "op", amountUsd: 0 }],
    quote: {
      shortfallUsd: 100,
      bufferUsd: 2,
      feesUsd: 1,
      totalPayUsd: 103,
      quotedAt: "2026-07-24T00:00:00.000Z",
      ttlMs: 60_000,
    },
  };
}

afterEach(() => {
  computePlan.mockReset();
});

describe("useProvisioningPlan (POO-1023)", () => {
  // [R1] The seam, and nothing but the seam.
  it("resolves the plan through computePlan", async () => {
    computePlan.mockResolvedValue(planStub("via-seam"));

    const { result } = renderHook(() => useProvisioningPlan(INPUT));

    await waitFor(() => expect(result.current.plan).not.toBeNull());
    expect(computePlan).toHaveBeenCalledWith(INPUT, undefined);
    expect(result.current.plan?.steps[0]?.key).toBe("via-seam");
  });

  // [R3] Async seam: there is a pending state, and no plan is exposed during it.
  it("reports pending until the plan resolves, and never exposes a partial plan", async () => {
    let release!: (plan: ProvisioningPlan) => void;
    computePlan.mockReturnValue(
      new Promise<ProvisioningPlan>((resolve) => {
        release = resolve;
      }),
    );

    const { result } = renderHook(() => useProvisioningPlan(INPUT));

    expect(result.current.loading).toBe(true);
    expect(result.current.plan).toBeNull();

    await act(async () => {
      release(planStub("resolved"));
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plan?.steps[0]?.key).toBe("resolved");
  });

  // [R4] A valid explicit gas choice re-plans, and is passed through to the seam.
  it("re-plans when an explicit gas choice arrives", async () => {
    computePlan.mockResolvedValue(planStub("first"));
    const gas: GasChoice = { presetUsd: 25, amountUsd: 25 };

    const { result, rerender } = renderHook(
      ({ gasChoice }: { gasChoice?: GasChoice }) => useProvisioningPlan(INPUT, gasChoice),
      { initialProps: {} as { gasChoice?: GasChoice } },
    );

    await waitFor(() => expect(result.current.plan).not.toBeNull());
    expect(computePlan).toHaveBeenLastCalledWith(INPUT, undefined);

    computePlan.mockResolvedValue(planStub("regassed"));
    rerender({ gasChoice: gas });

    await waitFor(() => expect(result.current.plan?.steps[0]?.key).toBe("regassed"));
    expect(computePlan).toHaveBeenLastCalledWith(INPUT, gas);
  });

  // [R3] A planner failure surfaces as an error rather than an empty plan card that never fills.
  it("surfaces a planner failure instead of hanging in pending", async () => {
    computePlan.mockRejectedValue(new Error("planner exploded"));

    const { result } = renderHook(() => useProvisioningPlan(INPUT));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plan).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  // [R3] A superseded in-flight plan must never overwrite a newer one (re-plan race).
  it("ignores a stale in-flight plan when the inputs change", async () => {
    let releaseFirst!: (plan: ProvisioningPlan) => void;
    computePlan.mockReturnValueOnce(
      new Promise<ProvisioningPlan>((resolve) => {
        releaseFirst = resolve;
      }),
    );
    const gas: GasChoice = { presetUsd: 10, amountUsd: 10 };

    const { result, rerender } = renderHook(
      ({ gasChoice }: { gasChoice?: GasChoice }) => useProvisioningPlan(INPUT, gasChoice),
      { initialProps: {} as { gasChoice?: GasChoice } },
    );

    computePlan.mockResolvedValueOnce(planStub("newer"));
    rerender({ gasChoice: gas });
    await waitFor(() => expect(result.current.plan?.steps[0]?.key).toBe("newer"));

    // The first (superseded) call settles late; it must not clobber the newer plan.
    await act(async () => {
      releaseFirst(planStub("stale"));
    });
    expect(result.current.plan?.steps[0]?.key).toBe("newer");
  });
});
