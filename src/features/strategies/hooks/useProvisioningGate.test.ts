/**
 * @id PP-CORE-HOK-017 (POO-419, POO-1042)
 * @name useProvisioningGate — tests
 * @implements-rules-version v2 (POO-1042 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The host-side gate decision. With the `provisioning` flag OFF (the shipped baseline) `evaluate`
 * always returns false so the op signs unchanged; with it ON, the mock demo trips it (invest =
 * multi, the no-USDC ops = gas-only). `reset` clears the stored input + lock.
 *
 * POO-1042 adds the real branch: the hook prefetches the live gate context for the operation's own
 * chain [R2], hands it to the builder [R1], and refuses to gate at all while that context is absent
 * [R6] — a degraded read must never stand between a funded user and their transaction.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Control the dark-launched flag directly — the hook only reads `isEnabled("provisioning")`.
let flagOn = false;
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({
    isEnabled: (key: string) => (key === "provisioning" ? flagOn : false),
    flags: {},
  }),
}));

// isMockMode is a module-level const derived from an env var; a getter lets each test flip it.
let mockModeValue = true;
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mockModeValue;
  },
}));

const getProvisioningContextAction = vi.fn();
vi.mock("@/lib/provisioning/planActions", () => ({
  getProvisioningContextAction: (...args: unknown[]) => getProvisioningContextAction(...args),
  computePlanAction: vi.fn(),
}));

const { useProvisioningGate } = await import("./useProvisioningGate");

const ARBITRUM = 42161;
const POLYGON = 137;

/** A live context: money on Polygon, nothing on the Arbitrum operation's chain. */
const LIVE_CONTEXT = {
  targetChainId: ARBITRUM,
  sources: [],
  gasByChain: {},
  balancesByChain: {
    [POLYGON]: { nativeUsd: 5, tokenUsd: 800 },
    [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
  },
  gasEstimateUsd: 0.07,
};

beforeEach(() => {
  vi.clearAllMocks();
  getProvisioningContextAction.mockResolvedValue({ ok: true, context: LIVE_CONTEXT });
});

afterEach(() => {
  flagOn = false;
  mockModeValue = true;
});

describe("useProvisioningGate (mock mode)", () => {
  it("evaluate() is inert (false, no input) while the flag is off", () => {
    flagOn = false;
    const { result } = renderHook(() => useProvisioningGate({ op: "invest" }));
    let gated = true;
    act(() => {
      gated = result.current.evaluate(100);
    });
    expect(gated).toBe(false);
    expect(result.current.input).toBeNull();
  });

  it("gates invest as multi when the flag is on", () => {
    flagOn = true;
    const { result } = renderHook(() => useProvisioningGate({ op: "invest" }));
    let gated = false;
    act(() => {
      gated = result.current.evaluate(100);
    });
    expect(gated).toBe(true);
    expect(result.current.input).not.toBeNull();
    expect(result.current.input?.opRequiredUsdc).toBe(100);
  });

  it("gates the no-USDC ops (gas-only) when the flag is on", () => {
    flagOn = true;
    for (const op of ["withdraw", "collect", "compound", "move-range", "close"] as const) {
      const { result } = renderHook(() => useProvisioningGate({ op }));
      let gated = false;
      act(() => {
        gated = result.current.evaluate();
      });
      expect(gated, op).toBe(true);
      expect(result.current.input?.opRequiredUsdc, op).toBe(0);
    }
  });

  it("never reaches for a live context in mock mode", () => {
    flagOn = true;
    renderHook(() => useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }));
    expect(getProvisioningContextAction).not.toHaveBeenCalled();
  });

  it("reset() clears the stored input and the lock", () => {
    flagOn = true;
    const { result } = renderHook(() => useProvisioningGate({ op: "invest" }));
    act(() => {
      result.current.evaluate(100);
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

describe("useProvisioningGate (real mode, POO-1042)", () => {
  beforeEach(() => {
    mockModeValue = false;
    flagOn = true;
  });

  it("[R2] prefetches the context for the chain the operation's network names", async () => {
    renderHook(() => useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }));

    await waitFor(() => expect(getProvisioningContextAction).toHaveBeenCalledWith(ARBITRUM));
  });

  it("[R2] all six operations resolve their own chain, including move-range and close", async () => {
    for (const op of [
      "invest",
      "withdraw",
      "collect",
      "compound",
      "move-range",
      "close",
    ] as const) {
      getProvisioningContextAction.mockClear();
      renderHook(() => useProvisioningGate({ op, network: "polygon", enabled: true }));
      await waitFor(() => expect(getProvisioningContextAction, op).toHaveBeenCalledWith(POLYGON));
    }
  });

  it("[R1] gates once the live context says the money is a chain away", async () => {
    const { result } = renderHook(() =>
      useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }),
    );
    await waitFor(() => expect(result.current.context).not.toBeNull());

    let gated = false;
    act(() => {
      gated = result.current.evaluate(100);
    });

    expect(gated).toBe(true);
    expect(result.current.input?.balancesByChain).toEqual(LIVE_CONTEXT.balancesByChain);
    expect(result.current.input?.gasEstimateUsd).toBe(0.07);
  });

  it("[R6] refuses to gate before the context has resolved", () => {
    getProvisioningContextAction.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() =>
      useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }),
    );

    let gated = true;
    act(() => {
      gated = result.current.evaluate(100);
    });

    expect(gated).toBe(false);
    expect(result.current.input).toBeNull();
  });

  it("[R6] a failed context read leaves the operation exactly as it is today", async () => {
    getProvisioningContextAction.mockResolvedValue({
      ok: false,
      code: "SYSTEM_INTERNAL",
      message: "balances unavailable",
    });
    const { result } = renderHook(() =>
      useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }),
    );
    await waitFor(() => expect(getProvisioningContextAction).toHaveBeenCalled());

    let gated = true;
    act(() => {
      gated = result.current.evaluate(100);
    });

    expect(gated).toBe(false);
    expect(result.current.context).toBeNull();
  });

  it("[R6] an unknown network yields no chain, no prefetch and no gate", () => {
    const { result } = renderHook(() =>
      useProvisioningGate({ op: "close", network: undefined, enabled: true }),
    );

    let gated = true;
    act(() => {
      gated = result.current.evaluate();
    });

    expect(getProvisioningContextAction).not.toHaveBeenCalled();
    expect(gated).toBe(false);
  });

  it("does not prefetch while the host surface is closed", () => {
    renderHook(() => useProvisioningGate({ op: "invest", network: "arbitrum", enabled: false }));
    expect(getProvisioningContextAction).not.toHaveBeenCalled();
  });

  it("[R10] binds no wallet: the gate decides, the panel signs", () => {
    // The gate mounts in all six op modals, always. Binding a wallet here would make every one of
    // them need Privy + wagmi context just to decide whether to gate, and this suite renders the
    // hook bare. `ProvisioningPanel` binds the rail instead, and it mounts only when provisioning
    // actually runs.
    const { result } = renderHook(() =>
      useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }),
    );
    expect(result.current).not.toHaveProperty("buildPlanSteps");
  });
});
