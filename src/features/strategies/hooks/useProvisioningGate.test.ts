/**
 * @id PP-CORE-HOK-017 (POO-419, POO-1042, POO-1564, POO-1749)
 * @name useProvisioningGate — tests
 * @implements-rules-version v5 (POO-1749 rules v1) · v4 (POO-1564 rules v1) · v3 (POO-1048 rules v1) · v2 (POO-1042 rules v1)
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
const BASE = 8453;

/**
 * One routable holding, so the fixture describes a wallet that can EXIST.
 *
 * POO-1149: `balancesByChain` is the RAW per-chain figure and `sources` is the routable inventory, and
 * the gate now judges "can this fund the operation" on the second. A fixture with $800 of raw token and
 * an empty inventory described a wallet holding money nothing could convert, which is exactly the shape
 * that produced the reported defect (POO-1552: 3.2263 VIRTUAL on Base suppressing the gate). Stating
 * both keeps these tests meaning what they say.
 */
function routable(chainId: number, usd: number) {
  return {
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    chainId,
    symbol: "USDC",
    decimals: 6,
    amount: "800000000",
    usd,
    reachableChainIds: [42161, 8453],
    isNative: false,
    logoUrl: "",
  };
}

/** A live context: money on Polygon, nothing on the Arbitrum operation's chain. */
const LIVE_CONTEXT = {
  targetChainId: ARBITRUM,
  sources: [routable(POLYGON, 800)],
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

  /**
   * POO-1552 [R2]/[R3]: the reported failure was a Base invest that deep-linked to `/deposit` while
   * routable USDC sat on Arbitrum, with the same wallet's Arbitrum invest gating correctly. Nothing
   * in `computeProvisioningNeed` or the chain config singles out any one chain, so a Base or Polygon
   * target with a resolved live context must gate exactly like the Arbitrum case above. This does
   * not reproduce the report itself (which needs a live wallet this suite has no access to); it
   * locks in that the calculator has no per-chain bias, so a future regression here cannot hide
   * behind "well it works on Arbitrum".
   */
  it("[R2] gates a Base target exactly like Arbitrum, given a resolved live context", async () => {
    getProvisioningContextAction.mockResolvedValue({
      ok: true,
      context: {
        targetChainId: BASE,
        sources: [],
        gasByChain: {},
        balancesByChain: {
          [ARBITRUM]: { nativeUsd: 5, tokenUsd: 305 },
          [BASE]: { nativeUsd: 0, tokenUsd: 0 },
        },
        gasEstimateUsd: 0.05,
      },
    });
    const { result } = renderHook(() =>
      useProvisioningGate({ op: "invest", network: "base", enabled: true }),
    );
    await waitFor(() => expect(result.current.context).not.toBeNull());

    let gated = false;
    act(() => {
      gated = result.current.evaluate(1);
    });

    expect(result.current.status).toBe("ready");
    expect(gated).toBe(true);
  });

  it("[R3] gates a Polygon target exactly like Arbitrum, given a resolved live context", async () => {
    getProvisioningContextAction.mockResolvedValue({
      ok: true,
      context: {
        targetChainId: POLYGON,
        sources: [],
        gasByChain: {},
        balancesByChain: {
          [ARBITRUM]: { nativeUsd: 5, tokenUsd: 305 },
          [POLYGON]: { nativeUsd: 0, tokenUsd: 0 },
        },
        gasEstimateUsd: 0.05,
      },
    });
    const { result } = renderHook(() =>
      useProvisioningGate({ op: "invest", network: "polygon", enabled: true }),
    );
    await waitFor(() => expect(result.current.context).not.toBeNull());

    let gated = false;
    act(() => {
      gated = result.current.evaluate(1);
    });

    expect(result.current.status).toBe("ready");
    expect(gated).toBe(true);
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

  it("[POO-1048 R1] reports the gate firing, with the operation, its chain and the shortfall", async () => {
    window.dataLayer = [];
    const { result } = renderHook(() =>
      useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }),
    );
    await waitFor(() => expect(result.current.context).not.toBeNull());
    act(() => {
      result.current.evaluate(100);
    });

    const gated = (window.dataLayer ?? []).filter(
      (entry) => entry.event === "funding_gate_triggered",
    );
    expect(gated).toHaveLength(1);
    expect(gated[0]).toMatchObject({ flow: "invest", chain_id: ARBITRUM, currency: "USD" });
    // The magnitude is what is MISSING, not what the operation is worth: the wallet holds $800 on
    // Polygon and the operation needs $100 on Arbitrum, so the gap is the $100 plus the gas.
    expect(Number(gated[0]?.value)).toBeGreaterThan(0);
  });

  it("[POO-1048 R1] stays silent when the gate decides the operation can just sign", async () => {
    // A funnel that records entries nobody made is worse than no funnel: `evaluate` returning false
    // is the operation proceeding untouched, and it must look like that in the data too.
    window.dataLayer = [];
    getProvisioningContextAction.mockResolvedValue({
      ok: true,
      context: {
        ...LIVE_CONTEXT,
        // Funded on the operation's own chain: gas covered, USDC covered, nothing to provision.
        // POO-1149: "covered" has to be stated in the ROUTABLE inventory as well as in the raw
        // balances, because that is what the gate now measures against.
        sources: [routable(ARBITRUM, 500)],
        balancesByChain: { [ARBITRUM]: { nativeUsd: 20, tokenUsd: 500 } },
      },
    });
    const { result } = renderHook(() =>
      useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }),
    );
    await waitFor(() => expect(result.current.context).not.toBeNull());
    act(() => {
      result.current.evaluate(100);
    });

    expect((window.dataLayer ?? []).filter((e) => e.event === "funding_gate_triggered")).toEqual(
      [],
    );
  });

  /**
   * The context's LIFETIME, which is what made the second open of a modal behave unlike the first.
   *
   * `evaluate` collapses "no context" into `false`, and for a short wallet the host reads `false` as
   * `router.push("/deposit")`. So every close that nulled the context reopened a window in which a
   * user holding funds on another chain was sent to buy fiat. It is not a thin race in practice: a
   * closed-midway funding run has just spent the shared per-API-key throttle bucket, so the refetch
   * is precisely the one likely to come back `ok: false`.
   */
  it("keeps the context across a close, so a reopen still has an answer", async () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useProvisioningGate({ op: "invest", network: "arbitrum", enabled: open }),
      { initialProps: { open: true } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ open: false });

    // Closed: the read stops, the ANSWER stays. A stale context can only ever over-offer
    // provisioning (the panel re-derives the plan from a fresh server read); a null one silently
    // sends a fundable user to /deposit.
    expect(result.current.context).toEqual(LIVE_CONTEXT);
    let gated = false;
    act(() => {
      gated = result.current.evaluate(100);
    });
    expect(gated).toBe(true);
  });

  it("keeps the last good context when the refresh fails, and still says the read failed", async () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useProvisioningGate({ op: "invest", network: "arbitrum", enabled: open }),
      { initialProps: { open: true } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ open: false });

    // The reopen's read is throttled away. [R6] is about not gating on information we do not have —
    // and we DO have it, from a moment ago. `status` still reports the failure honestly.
    getProvisioningContextAction.mockResolvedValue({
      ok: false,
      code: "PROVISIONING_BALANCES_UNAVAILABLE",
      message: "throttled",
    });
    rerender({ open: true });
    await waitFor(() => expect(result.current.status).toBe("unavailable"));

    expect(result.current.context).toEqual(LIVE_CONTEXT);
    let gated = false;
    act(() => {
      gated = result.current.evaluate(100);
    });
    expect(gated).toBe(true);
  });

  it("[R2] drops a held context the moment the operation's chain changes", async () => {
    const { result, rerender } = renderHook(
      ({ network }: { network: string }) =>
        useProvisioningGate({ op: "invest", network, enabled: true }),
      { initialProps: { network: "arbitrum" } },
    );
    await waitFor(() => expect(result.current.context).toEqual(LIVE_CONTEXT));

    // A different operation's chain: the held answer describes another wallet slice, and [R2] is
    // that the gate never decides one chain on another's balances. Retention is per-chain or it is
    // a correctness bug, not a convenience.
    getProvisioningContextAction.mockImplementation(() => new Promise(() => {}));
    rerender({ network: "base" });

    await waitFor(() => expect(result.current.context).toBeNull());
    expect(result.current.status).toBe("loading");
  });

  it("never retains anything once the flag goes off", async () => {
    const { result, rerender } = renderHook(
      () => useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }),
      {},
    );
    await waitFor(() => expect(result.current.context).toEqual(LIVE_CONTEXT));

    flagOn = false;
    rerender();

    // A dark-launched feature turning off must leave nothing behind that could still gate.
    await waitFor(() => expect(result.current.context).toBeNull());
    expect(result.current.status).toBe("inert");
  });

  /**
   * POO-1749 [R1]: the 2026-08-24 incident, end to end through the hook. The context arrives with
   * the Arbitrum USDC missing from `sources` (POO-1750: any ~$10k+ stable balance is rendered in
   * scientific notation and rejected by the funding context's base-unit parse, on every read)
   * while the raw balances still carry it; without the host's own read, `evaluate` fired the multi
   * funnel at a wallet the host had just verified as funded.
   */
  it("[POO-1749 R1] the host's direct USDC read stops the gate contradicting the host", async () => {
    const incident = {
      targetChainId: ARBITRUM,
      sources: [
        {
          address: "0x0000000000000000000000000000000000000000",
          chainId: ARBITRUM,
          symbol: "ETH",
          decimals: 18,
          amount: "1897000000000000",
          usd: 4.71,
          reachableChainIds: [],
          isNative: true,
          logoUrl: "",
        },
      ],
      gasByChain: {},
      balancesByChain: { [ARBITRUM]: { nativeUsd: 4.71, tokenUsd: 10_885.73 } },
      gasEstimateUsd: 0.07,
    };
    getProvisioningContextAction.mockResolvedValue({ ok: true, context: incident });

    // Without the host's figure the gate still fires: the projection alone reads the wallet as empty.
    const bare = renderHook(() =>
      useProvisioningGate({ op: "invest", network: "arbitrum", enabled: true }),
    );
    await waitFor(() => expect(bare.result.current.context).not.toBeNull());
    let gatedWithout = false;
    act(() => {
      gatedWithout = bare.result.current.evaluate(10_800);
    });
    expect(gatedWithout).toBe(true);

    // With it, the gate stands aside and the invest signs directly.
    const { result } = renderHook(() =>
      useProvisioningGate({
        op: "invest",
        network: "arbitrum",
        enabled: true,
        targetUsdcBalanceUsd: 10_885.73,
      }),
    );
    await waitFor(() => expect(result.current.context).not.toBeNull());
    let gated = true;
    act(() => {
      gated = result.current.evaluate(10_800);
    });
    expect(gated).toBe(false);
    expect(result.current.input).toBeNull();
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
