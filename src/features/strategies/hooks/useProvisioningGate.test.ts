/**
 * @id PP-CORE-HOK-017 (POO-419)
 * @name useProvisioningGate — tests
 * @implements-rules-version v1
 *
 * The host-side gate decision. With the `provisioning` flag OFF (prod/test baseline) `evaluate`
 * always returns false so the op signs unchanged; with it ON, the mock demo trips it (invest = multi,
 * the no-USDC ops = gas-only). `reset` clears the stored input + lock.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import { useProvisioningGate } from "./useProvisioningGate";

// Control the dark-launched flag directly — the hook only reads `isEnabled("provisioning")`.
let flagOn = false;
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({
    isEnabled: (key: string) => (key === "provisioning" ? flagOn : false),
    flags: {},
  }),
}));

const strategy = { id: "s1", name: "Stable Yield" } as unknown as Strategy;

afterEach(() => {
  flagOn = false;
});

describe("useProvisioningGate", () => {
  it("evaluate() is inert (false, no input) while the flag is off", () => {
    flagOn = false;
    const { result } = renderHook(() => useProvisioningGate());
    let gated = true;
    act(() => {
      gated = result.current.evaluate("invest", strategy, 100);
    });
    expect(gated).toBe(false);
    expect(result.current.input).toBeNull();
  });

  it("gates invest as multi when the flag is on", () => {
    flagOn = true;
    const { result } = renderHook(() => useProvisioningGate());
    let gated = false;
    act(() => {
      gated = result.current.evaluate("invest", strategy, 100);
    });
    expect(gated).toBe(true);
    expect(result.current.input).not.toBeNull();
    expect(result.current.input?.opRequiredUsdc).toBe(100);
  });

  it("gates the no-USDC ops (gas-only) when the flag is on", () => {
    flagOn = true;
    for (const op of ["withdraw", "collect", "compound", "move-range", "close"] as const) {
      const { result } = renderHook(() => useProvisioningGate());
      let gated = false;
      act(() => {
        gated = result.current.evaluate(op, strategy);
      });
      expect(gated, op).toBe(true);
      expect(result.current.input?.opRequiredUsdc, op).toBe(0);
    }
  });

  it("reset() clears the stored input and the lock", () => {
    flagOn = true;
    const { result } = renderHook(() => useProvisioningGate());
    act(() => {
      result.current.evaluate("invest", strategy, 100);
      result.current.setLocked(true);
    });
    expect(result.current.input).not.toBeNull();
    expect(result.current.locked).toBe(true);

    act(() => {
      result.current.reset();
    });
    expect(result.current.input).toBeNull();
    expect(result.current.locked).toBe(false);
  });
});
