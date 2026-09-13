/**
 * @id PP-CORE-HOK-034 (POO-1800) - tests
 * @name useOnRampProvider - tests
 * @implements-rules-version v1 (POO-1800 rules v1)
 * @analytics-events none, the hook reads two flags and returns a rail name; it renders nothing.
 *
 * The hook exists so `/deposit` and the provisioning panel finally read the flag the SAME way:
 * today one host uses the env-pure read and the other the dev-overridable hook, so a tester flipping
 * the flag in the Dev menu moves one and not the other. That is why every case here drives the
 * DEV-OVERRIDE STORE rather than `vi.stubEnv`: the override path is the half that was broken, and a
 * hook that only passed under stubbed env would prove nothing about it.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetDevOverridesForTests, setOverride } from "@/lib/features/devOverrides";
import { useOnRampProvider } from "./useOnRampProvider";

beforeEach(() => {
  localStorage.clear();
  __resetDevOverridesForTests();
});
afterEach(() => {
  localStorage.clear();
  __resetDevOverridesForTests();
});

describe("useOnRampProvider", () => {
  // @rule R1
  it("[R1] answers none on the registry baseline, where fiat is off", () => {
    // Both flags ship off, so the hook's untouched answer is the one a user gets today.
    const { result } = renderHook(() => useOnRampProvider());
    expect(result.current).toBe("none");
  });

  // @rule R1
  it("[R1] privyOnRamp alone never turns fiat on", () => {
    const { result } = renderHook(() => useOnRampProvider());
    act(() => {
      setOverride("privyOnRamp", true);
    });
    expect(result.current).toBe("none");
  });

  it("routes to paybis when fiat is on and privy is off", () => {
    const { result } = renderHook(() => useOnRampProvider());
    act(() => {
      setOverride("fiatOnRamp", true);
    });
    expect(result.current).toBe("paybis");
  });

  it("routes to privy when both are on", () => {
    const { result } = renderHook(() => useOnRampProvider());
    act(() => {
      setOverride("fiatOnRamp", true);
      setOverride("privyOnRamp", true);
    });
    expect(result.current).toBe("privy");
  });

  it("re-renders when the Dev menu flips the rail, and again when it flips back", () => {
    // The whole point of the twin: a Dev-menu flip has to move the hosts LIVE, not on next reload.
    const { result } = renderHook(() => useOnRampProvider());
    act(() => {
      setOverride("fiatOnRamp", true);
    });
    expect(result.current).toBe("paybis");

    act(() => {
      setOverride("privyOnRamp", true);
    });
    expect(result.current).toBe("privy");

    act(() => {
      setOverride("privyOnRamp", false);
    });
    expect(result.current).toBe("paybis");

    act(() => {
      setOverride("fiatOnRamp", false);
    });
    expect(result.current).toBe("none");
  });
});
