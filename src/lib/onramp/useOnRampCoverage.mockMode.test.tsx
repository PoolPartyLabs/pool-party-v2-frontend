/**
 * @id PP-CORE-HOK-036 (POO-1805) - mock-mode tests
 * @name useOnRampCoverage - mock-mode tests
 * @implements-rules-version v2 (POO-1805 rules v2)
 * @analytics-events none, the hook emits nothing; see the module header.
 *
 * Its own file because `isMockMode` is a module constant read at import time, so the two branches
 * cannot share a module graph.
 *
 * The failure this pins is not cosmetic. `Providers` returns its children with NO `PrivyProvider`
 * in mock mode (`src/app/providers.tsx`), so a `usePrivy()` called unconditionally throws out of its
 * default context and takes the whole host down. The `@privy-io/react-auth` module is left
 * DELIBERATELY UNMOCKED here: a mock would hide exactly the call this test exists to forbid.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoverageProbeInput } from "./coverageProbe";

const mocks = vi.hoisted(() => ({ probe: vi.fn(), reportClientError: vi.fn() }));

vi.mock("./coverageProbe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./coverageProbe")>()),
  probeOnRampCoverage: mocks.probe,
}));
vi.mock("@/lib/observability/reportClientError", () => ({
  reportClientError: mocks.reportClientError,
}));
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: true,
}));

import { useOnRampCoverage } from "./useOnRampCoverage";

const INPUT: CoverageProbeInput = {
  fiat: "brl",
  amount: "100",
  destination: {
    chain: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    address: "0x1111111111111111111111111111111111111111",
  },
  environment: "sandbox",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOnRampCoverage in mock mode", () => {
  // @rule R1
  it("[R1] answers unknown/mock-mode without touching Privy or the network", async () => {
    // There is no rail to ask. A fabricated `covered` would send a mock-mode tester into a purchase
    // that cannot exist, which is [R1]'s own discipline applied to ourselves.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useOnRampCoverage());

    await expect(result.current(INPUT)).resolves.toEqual({
      status: "unknown",
      reason: "mock-mode",
    });
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("reports nothing: mock mode is not a failure", async () => {
    const { result } = renderHook(() => useOnRampCoverage());
    await result.current(INPUT);
    expect(mocks.reportClientError).not.toHaveBeenCalled();
  });

  it("returns a stable callback across renders", () => {
    const { result, rerender } = renderHook(() => useOnRampCoverage());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
