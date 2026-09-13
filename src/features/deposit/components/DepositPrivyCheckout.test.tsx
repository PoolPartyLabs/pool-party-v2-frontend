/**
 * @id PP-DEP-CMP-007 (POO-1807), spec
 * @name DepositPrivyCheckout, spec
 * @implements-rules-version v1 (POO-1807 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * A component suite, so it mocks OUR modules and never `@privy-io/react-auth`: only the adapter's
 * own suite does that. What is pinned here is the handoff, phase by phase, and the one rule that
 * decides whether a screen may look like a failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivyOnRampOutcome } from "@/lib/onramp/usePrivyOnRamp";
import { renderWithProviders, screen, waitFor } from "../../../../tests/utils/renderWithProviders";
import { DepositPrivyCheckout } from "./DepositPrivyCheckout";

const watch = vi.hoisted(() => ({ visible: vi.fn(), resume: vi.fn() }));

vi.mock("@/lib/onramp/awaitOnRampSettlement", () => ({
  watchOnRampSettlementVisible: watch.visible,
  resumeOnRampObservation: watch.resume,
}));

const ADDRESS = "0x1111111111111111111111111111111111111111";

function outcome(over: Partial<PrivyOnRampOutcome> = {}): PrivyOnRampOutcome {
  return { attemptId: "attempt-1", moved: "confirmed", reason: "provider_confirmed", ...over };
}

function props(over: Record<string, unknown> = {}) {
  return {
    pending: Promise.resolve(outcome()),
    baseline: BigInt(25_000_000),
    address: ADDRESS,
    receiveUsd: 100,
    readBalance: vi.fn(async () => BigInt(25_000_000)),
    onSettled: vi.fn(),
    onSettling: vi.fn(),
    onUnverified: vi.fn(),
    onFailed: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  watch.visible.mockReset();
  watch.resume.mockReset();
  watch.visible.mockResolvedValue({ outcome: "unverified" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("DepositPrivyCheckout, the opening phase (POO-1807 [R9])", () => {
  it("shows the provider-neutral opening copy while the checkout promise is pending", () => {
    // A promise that never settles: the component must render its own waiting state, not nothing.
    const p = props({ pending: new Promise<PrivyOnRampOutcome>(() => {}) });
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    expect(screen.getByText("Opening the secure checkout")).toBeInTheDocument();
  });

  // Handoff rejection 14: the provider is never named on screen.
  it("never names the provider", () => {
    const p = props({ pending: new Promise<PrivyOnRampOutcome>(() => {}) });
    const { container } = renderWithProviders(<DepositPrivyCheckout {...p} />);

    expect(container.textContent ?? "").not.toMatch(/privy/i);
  });
});

describe("DepositPrivyCheckout, the outcome handoff (POO-1807 [R9], ADR-0006)", () => {
  // @rule R9 -- the ONLY path that may read like a failure.
  it("a hard `no` is the only path that reports a failure, and carries the reason", async () => {
    const p = props({
      pending: Promise.resolve(outcome({ moved: "no", reason: "popup_blocked" })),
    });
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    await waitFor(() => expect(p.onFailed).toHaveBeenCalledWith("popup_blocked"));
    expect(watch.visible).not.toHaveBeenCalled();
    expect(p.onSettling).not.toHaveBeenCalled();
  });

  // @rule R9 -- a provider claim enters the visible window.
  it("a `confirmed` claim enters the settling window", async () => {
    const p = props();
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    await waitFor(() => expect(p.onSettling).toHaveBeenCalled());
    expect(watch.visible).toHaveBeenCalledTimes(1);
    expect(p.onFailed).not.toHaveBeenCalled();
  });

  // @rule R9 -- and so does an inconclusive exit. This is ADR-0006's whole point: `maybe` must not
  // be rendered as a cancellation, so it takes the same path a paid purchase does.
  it("a `maybe` exit enters the SAME settling window, never a failure", async () => {
    const p = props({
      pending: Promise.resolve(outcome({ moved: "maybe", reason: "user_exited" })),
    });
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    await waitFor(() => expect(p.onSettling).toHaveBeenCalled());
    expect(p.onFailed).not.toHaveBeenCalled();
    expect(watch.visible).toHaveBeenCalledWith(
      expect.objectContaining({ moved: "maybe" }),
      expect.anything(),
    );
  });

  it("passes the pre-read baseline and the destination scope to the watcher", async () => {
    const p = props();
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    await waitFor(() => expect(watch.visible).toHaveBeenCalled());
    const [input, deps] = watch.visible.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(input.baseline).toBe(BigInt(25_000_000));
    expect(input.address).toBe(ADDRESS);
    expect(input.attemptId).toBe("attempt-1");
    expect(deps.readBalance).toBe(p.readBalance);
  });
});

describe("DepositPrivyCheckout, what the watcher decides (POO-1807 [R9], ADR-0004)", () => {
  // @rule R9 -- the receipt figure comes from the DELTA, never from the typed amount.
  it("reports the OBSERVED delivered figure on settlement, not the typed amount", async () => {
    watch.visible.mockResolvedValue({
      outcome: "settled",
      delivered: { amount: "96.4", asset: "0xusdc", chain: "eip155:8453", observedAt: 1 },
    });
    const p = props({ receiveUsd: 100 });
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    // POO-1813 [R4]: OUR attempt id rides up with the delta, so the host's `funding_buy_settled`
    // joins to the three rows the adapter already pushed for this same purchase. Passed up rather
    // than emitted here: this component deliberately counts nothing.
    await waitFor(() => expect(p.onSettled).toHaveBeenCalledWith(96.4, "attempt-1"));
    expect(p.onSettled).not.toHaveBeenCalledWith(100, expect.anything());
  });

  // @rule R9
  it("reports `unverified` at the ceiling with no claim", async () => {
    watch.visible.mockResolvedValue({ outcome: "unverified" });
    const p = props({ pending: Promise.resolve(outcome({ moved: "maybe" })) });
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    await waitFor(() => expect(p.onUnverified).toHaveBeenCalled());
    expect(p.onSettled).not.toHaveBeenCalled();
    expect(p.onFailed).not.toHaveBeenCalled();
  });

  // @rule R9 -- `settling` at the ceiling RELEASES the screen and reports nothing new: the host is
  // already on the settling copy, and there is nothing to correct.
  it("reports nothing further when the ceiling is `settling`", async () => {
    watch.visible.mockResolvedValue({ outcome: "settling" });
    const p = props();
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    await waitFor(() => expect(p.onSettling).toHaveBeenCalled());
    await Promise.resolve();
    expect(p.onSettled).not.toHaveBeenCalled();
    expect(p.onUnverified).not.toHaveBeenCalled();
    expect(p.onFailed).not.toHaveBeenCalled();
  });
});

describe("DepositPrivyCheckout, the stay-mounted contract (POO-1807 review F1)", () => {
  // The component may not keep its own opening copy on screen after it has told the host the window
  // is open: the host renders the settling copy from that moment, and two waiting screens would
  // stack. Rendering null is what lets the host keep this mounted, which is the other half of F1.
  it("renders nothing once it has reported settling, so the host owns the screen", async () => {
    const p = props();
    const { container } = renderWithProviders(<DepositPrivyCheckout {...p} />);
    expect(screen.getByText("Opening the secure checkout")).toBeInTheDocument();

    await waitFor(() => expect(p.onSettling).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  // The regression itself: the window must survive the report that opens it. Before the fix the
  // host unmounted this component on `onSettling()`, the cleanup set `live = false`, and the
  // settlement below was dropped, so no Privy purchase could ever complete.
  it("still reports the settlement it observes AFTER it has reported settling", async () => {
    let finish: (result: unknown) => void = () => {};
    watch.visible.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const p = props();
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    await waitFor(() => expect(p.onSettling).toHaveBeenCalled());
    finish({
      outcome: "settled",
      delivered: { amount: "96.4", asset: "0xusdc", chain: "eip155:8453", observedAt: 1 },
    });

    await waitFor(() => expect(p.onSettled).toHaveBeenCalledWith(96.4, "attempt-1"));
  });
});

describe("DepositPrivyCheckout, safety (POO-1807)", () => {
  it("starts the checkout exactly once, however often it re-renders", async () => {
    const p = props();
    const { rerender } = renderWithProviders(<DepositPrivyCheckout {...p} />);
    rerender(<DepositPrivyCheckout {...p} />);
    rerender(<DepositPrivyCheckout {...p} />);

    await waitFor(() => expect(watch.visible).toHaveBeenCalled());
    expect(watch.visible).toHaveBeenCalledTimes(1);
  });

  it("reports nothing after unmount", async () => {
    let settle: (o: PrivyOnRampOutcome) => void = () => {};
    const pending = new Promise<PrivyOnRampOutcome>((resolve) => {
      settle = resolve;
    });
    const p = props({ pending });
    const { unmount } = renderWithProviders(<DepositPrivyCheckout {...p} />);
    unmount();
    settle(outcome());
    await Promise.resolve();
    await Promise.resolve();

    expect(p.onSettling).not.toHaveBeenCalled();
    expect(watch.visible).not.toHaveBeenCalled();
  });

  // A refusal minted no intent, so there is nothing to watch and nothing to report but the failure.
  it("treats a null attemptId as a failure rather than watching nothing", async () => {
    const p = props({
      pending: Promise.resolve(
        outcome({ attemptId: null, moved: "no", reason: "missing_default_asset" }),
      ),
    });
    renderWithProviders(<DepositPrivyCheckout {...p} />);

    await waitFor(() => expect(p.onFailed).toHaveBeenCalledWith("missing_default_asset"));
    expect(watch.visible).not.toHaveBeenCalled();
  });
});
