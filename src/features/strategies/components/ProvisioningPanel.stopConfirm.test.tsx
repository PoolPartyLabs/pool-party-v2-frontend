/**
 * @id PP-CORE-CMP-046 (POO-1507)
 * @name ProvisioningPanel — the mid-run stop confirmation
 * @implements-rules-version v1 (POO-1507 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Screen `7g` (`7366:766`), spec §4 [R29], decisions D5/D6.
 *
 * A real plan, deliberately: a mock plan carries no legs, so there is no "already settled" figure
 * and no "Step N of M" to interpolate, and every fact this screen names would be untestable.
 *
 * The host never renders this directly — it calls `requestClose()` on the panel's imperative handle
 * from its own `handleOpenChange` (ESC / overlay / native X all route through Radix's
 * `onOpenChange`), which is exactly what these tests do instead of simulating a Dialog around the
 * panel a second time.
 */

import type { AnchorHTMLAttributes, ReactNode, RefObject } from "react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningPlan } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { planRailSteps } from "../lib/buildPlanSteps";
import type { PlanRailReporters } from "./ProvisioningPanel";
import { ProvisioningPanel, type ProvisioningPanelHandle } from "./ProvisioningPanel";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));

const { planHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: () => ({
    plan: planHolder.current,
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

function noop() {}

/**
 * A rail that settles the first `settledCount` steps and then hangs forever on the next one — the
 * usdcBridge fixture's real shape (approve, swap $120.40, approve, bridge "Move to Arbitrum"), so a
 * genuinely mid-run panel with something already safe is reachable without a fake timer racing the
 * wallet-sign flow's own internal state machine.
 *
 * The hanging step deliberately reports NO broadcast: it is the awaiting-a-signature shape, where
 * nothing has reached the chain and nothing finishes on its own. {@link railStallingBroadcastAfter}
 * is the other shape.
 */
function railStallingAfter(settledCount: number) {
  return (plan: ProvisioningPlan) =>
    planRailSteps(plan).map((step, index) => ({
      key: step.key,
      run: async () =>
        index < settledCount
          ? ({ txHash: `0x${step.key}` } as const)
          : new Promise<never>(() => {}),
    }));
}

/**
 * A rail whose hanging step has BROADCAST: it reports its hash through `onLegBroadcast` exactly as
 * the real rail does the instant a leg has one (`buildPlanSteps.ts` §3.4), then hangs on the
 * settlement that never comes — a bridge mid-flight. Only a `leg` step can report (approvals get no
 * in-flight hash from the rail), so `settledCount` must land the stall on one.
 */
function railStallingBroadcastAfter(settledCount: number) {
  return (plan: ProvisioningPlan, reporters: PlanRailReporters) =>
    planRailSteps(plan).map((step, index) => ({
      key: step.key,
      run: async () => {
        if (index < settledCount) return { txHash: `0x${step.key}` } as const;
        if (step.kind === "leg" && step.leg) {
          reporters.onLegBroadcast({ leg: step.leg, txHash: `0x${step.key}`, at: Date.now() });
        }
        return new Promise<never>(() => {});
      },
    }));
}

/** A rail whose every step resolves immediately, so the run reaches `runFinished`. */
function railSettlingEverything(plan: ProvisioningPlan) {
  return planRailSteps(plan).map((step) => ({
    key: step.key,
    run: async () => ({ txHash: `0x${step.key}` }) as const,
  }));
}

async function reachStalledRun(
  settledCount: number,
  extraProps: Partial<Parameters<typeof ProvisioningPanel>[0]> = {},
) {
  const ref = createRef<ProvisioningPanelHandle>();
  renderWithProviders(
    <ProvisioningPanel
      ref={ref}
      input={SCENARIOS.usdcBridge}
      opLabel="Invest in Stable Yield"
      onDone={noop}
      onCancel={noop}
      buildPlanSteps={railStallingAfter(settledCount)}
      {...extraProps}
    />,
  );
  // POO-1503: there is no mock Confirm any more; the seeded start runs the rail the moment the plan
  // resolves. The window renders the step in flight; waiting for it is waiting for the rail to
  // actually be mid-run rather than still resolving the plan. The `act` settles React to quiescence
  // (POO-1545: `findBy*` resolves at COMMIT, one macrotask before passive effects under load).
  await screen.findByTestId("provisioning-exec-window");
  await act(async () => {});
  return ref;
}

/**
 * `requestClose` is called the way a real host calls it: directly on the imperative handle, outside
 * any `fireEvent`. `act` is what flushes the `setStopConfirmOpen` it triggers before the assertion
 * runs, exactly as React's own testing guidance asks for any state update not already wrapped by
 * Testing Library's own event helpers.
 */
function requestClose(ref: RefObject<ProvisioningPanelHandle | null>): boolean | undefined {
  let proceed: boolean | undefined;
  act(() => {
    proceed = ref.current?.requestClose();
  });
  return proceed;
}

describe("ProvisioningPanel — Stop here? (POO-1507 [R29])", () => {
  beforeEach(() => {
    planHolder.current = realProvisioningPlan();
    window.dataLayer = [];
  });

  it("[R29] a close attempt mid-run opens the confirmation instead of closing", async () => {
    const ref = await reachStalledRun(2);

    const proceed = requestClose(ref);

    expect(proceed).toBe(false);
    expect(screen.getByText("Stop here?")).toBeInTheDocument();
  });

  it("[R29] names what already settled, with the plan's own figure", async () => {
    const ref = await reachStalledRun(2);
    requestClose(ref);

    // Index 1 of the usdcBridge fixture's rail is the swap, worth $120.40 (the same figure the
    // step-failed screen's settled line asserts). The two approvals move nothing.
    expect(screen.getByText("$120.40 already went through and is safe.")).toBeInTheDocument();
  });

  it("[R29] never invents a settled figure when nothing has settled yet", async () => {
    const ref = await reachStalledRun(0);
    requestClose(ref);

    expect(screen.queryByText(/already went through/)).not.toBeInTheDocument();
  });

  it("[R29] a step with NOTHING broadcast is never promised to 'finish on its own'", async () => {
    const ref = await reachStalledRun(2);
    requestClose(ref);

    // Rail index 2 (the second approval) is running: `Step 3 of 4` in the carousel. It has no hash,
    // so nothing has reached the chain: the body says so, and tells the user what to do with a
    // signature request their wallet may still be showing. One step (the bridge, index 3) is left,
    // so `{rest}` is a single number, not a range.
    expect(
      screen.getByText(
        "Step 3 of 4 has not moved any funds yet. If your wallet is asking for a signature, decline it. Step 4 will not start, and your funds stay where they are.",
      ),
    ).toBeInTheDocument();
    // Same numbers the collapsed carousel window is showing, not a second count that could drift.
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
    // The broadcast wording must not leak into the signature-pending state: nothing finishes on its
    // own when nothing was sent.
    expect(screen.queryByText(/will finish on its own/)).not.toBeInTheDocument();
  });

  it("[R29] a step that HAS broadcast is the one told it will finish on its own", async () => {
    const ref = createRef<ProvisioningPanelHandle>();
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        // Stall on rail index 1 (the swap leg) AFTER it reports its broadcast, the way the real rail
        // does the instant a leg has a hash: mid-settlement, the one state that truly finishes on
        // its own.
        buildPlanSteps={railStallingBroadcastAfter(1)}
      />,
    );
    await screen.findByTestId("provisioning-exec-window");
    await act(async () => {});
    requestClose(ref);

    expect(
      screen.getByText(
        "Step 2 of 4 is running and will finish on its own. Steps 3-4 will not start, and your funds stay where they land.",
      ),
    ).toBeInTheDocument();
  });

  it("[R29] the running step being the LAST one names no step that 'will not start'", async () => {
    const ref = await reachStalledRun(3);
    requestClose(ref);

    // The bridge leg is stalled BEFORE broadcasting (awaiting its signature), so the body is the
    // nothing-sent one; last step, so no step is named as not starting.
    expect(
      screen.getByText(
        "Step 4 of 4 has not moved any funds yet. If your wallet is asking for a signature, decline it. Your funds stay where they are.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/will not start/)).not.toBeInTheDocument();
  });

  it("[R29] the LAST step broadcast and mid-settlement reads as finishing on its own", async () => {
    const ref = createRef<ProvisioningPanelHandle>();
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={railStallingBroadcastAfter(3)}
      />,
    );
    await screen.findByTestId("provisioning-exec-window");
    await act(async () => {});
    requestClose(ref);

    expect(
      screen.getByText(
        "Step 4 of 4 is running and will finish on its own. Your funds stay where they land.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/will not start/)).not.toBeInTheDocument();
  });

  it("[R29] Keep going is the primary, Stop anyway is a ghost, and they are the only two exits", async () => {
    const ref = await reachStalledRun(2);
    requestClose(ref);

    const dialog = screen.getByRole("alertdialog");
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Keep going", "Stop anyway"]);
    // [D6] No third exit inside the confirmation itself.
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  // @rule M5.2 (POO-1526) — the ghost exit is its own full-width row; the explicit 44pt is a
  // min-height, not a bigger font.
  it("[M5.2] Stop anyway carries an explicit 44pt touch target", async () => {
    const ref = await reachStalledRun(2);
    requestClose(ref);

    expect(screen.getByRole("button", { name: "Stop anyway" })).toHaveClass("min-h-11");
  });

  it("[D6] Keep going closes the confirmation and the run keeps going", async () => {
    const ref = await reachStalledRun(2);
    requestClose(ref);

    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));

    expect(screen.queryByText("Stop here?")).not.toBeInTheDocument();
    // The run is exactly where it was: still on the same step, not reset or restarted.
    expect(screen.getByTestId("provisioning-exec-window")).toBeInTheDocument();
  });

  it("[D6] a second close attempt while the confirmation is open maps to Keep going", async () => {
    const ref = await reachStalledRun(2);
    requestClose(ref);
    expect(screen.getByText("Stop here?")).toBeInTheDocument();

    const proceed = requestClose(ref);

    expect(proceed).toBe(false);
    expect(screen.queryByText("Stop here?")).not.toBeInTheDocument();
  });

  it("[R29] Stop anyway calls onStopRun, not onCancel, when the host provides it", async () => {
    const onStopRun = vi.fn();
    const onCancel = vi.fn();
    const ref = await reachStalledRun(2, { onCancel, onStopRun });
    requestClose(ref);

    fireEvent.click(screen.getByRole("button", { name: "Stop anyway" }));

    expect(onStopRun).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByText("Stop here?")).not.toBeInTheDocument();
  });

  it("[R29] Stop anyway falls back to onCancel for a host not yet threaded", async () => {
    const onCancel = vi.fn();
    const ref = await reachStalledRun(2, { onCancel });
    requestClose(ref);

    fireEvent.click(screen.getByRole("button", { name: "Stop anyway" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("[D5] Stop anyway pings the app-wide recovery banner to recheck immediately", async () => {
    const heard = vi.fn();
    window.addEventListener("pp:funding-recovery-recheck", heard);
    try {
      const ref = await reachStalledRun(2);
      requestClose(ref);

      fireEvent.click(screen.getByRole("button", { name: "Stop anyway" }));

      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("pp:funding-recovery-recheck", heard);
    }
  });

  /**
   * [R29] The line "Steps {rest} will not start" is ENFORCED, not narrated: `stopAnyway` resets the
   * panel's OWN sign flow, so the run loop that is executing the legs is cancelled. The hosts'
   * `onStopRun` resets THEIR op flow, which never touched this loop — without the panel-side reset,
   * the loop advanced when the in-flight leg settled and invoked the NEXT leg's `run()`, which in
   * real mode is a server build, a wallet signature request and a broadcast, minutes after the user
   * was told nothing more would start.
   */
  function railStallingOnSwap() {
    let settleInFlight: () => void = () => {};
    // Rail indexes 2 and 3 (the second approval, then the bridge): everything after the stall.
    const laterLegRuns = vi.fn(() => new Promise<never>(() => {}));
    const rail = (plan: ProvisioningPlan) =>
      planRailSteps(plan).map((step, index) => ({
        key: step.key,
        run:
          index === 0
            ? async () => ({ txHash: `0x${step.key}` }) as const
            : index === 1
              ? () =>
                  new Promise<{ txHash: string }>((resolve) => {
                    settleInFlight = () => resolve({ txHash: `0x${step.key}` });
                  })
              : laterLegRuns,
      }));
    return { rail, settleInFlight: () => settleInFlight(), laterLegRuns };
  }

  it("[R29] Stop anyway cancels the panel's own run: the in-flight leg settling never starts the next leg", async () => {
    const { rail, settleInFlight, laterLegRuns } = railStallingOnSwap();
    const ref = createRef<ProvisioningPanelHandle>();
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        onStopRun={noop}
        buildPlanSteps={rail}
      />,
    );
    await screen.findByTestId("provisioning-exec-window");
    await act(async () => {});
    requestClose(ref);
    fireEvent.click(screen.getByRole("button", { name: "Stop anyway" }));

    // The swap's broadcast was already out, so it settles regardless of the stop — which is exactly
    // what the dialog said would happen. What must NOT happen is the orphaned loop advancing.
    await act(async () => {
      settleInFlight();
    });
    await act(async () => {});

    expect(laterLegRuns).not.toHaveBeenCalled();
  });

  it("[D6] Keep going cancels nothing: the same settle advances into the next leg", async () => {
    // The control for the cancellation above: with the confirmation dismissed the other way, the
    // identical settle MUST reach the next leg's `run()`, proving this harness would catch the
    // orphaned-loop regression rather than passing vacuously.
    const { rail, settleInFlight, laterLegRuns } = railStallingOnSwap();
    const ref = createRef<ProvisioningPanelHandle>();
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        onStopRun={noop}
        buildPlanSteps={rail}
      />,
    );
    await screen.findByTestId("provisioning-exec-window");
    await act(async () => {});
    requestClose(ref);
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));

    await act(async () => {
      settleInFlight();
    });
    await act(async () => {});

    expect(laterLegRuns).toHaveBeenCalledTimes(1);
  });

  it("[R29] funding_run_stop_blocked fires at the interception, never on how it resolves", async () => {
    const events = () =>
      ((window.dataLayer ?? []) as Record<string, unknown>[]).filter(
        (entry) => entry.event === "funding_run_stop_blocked",
      );
    const ref = await reachStalledRun(2);
    expect(events()).toHaveLength(0);

    requestClose(ref);

    // The instant the attempt is intercepted, before either button exists to be pressed — with the
    // same numbers the dialog prints.
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ leg_index: 3, leg_count: 4 });

    // Resolving the question adds nothing, in either direction; a NEW attempt is a new blocked
    // intent and counts again.
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(events()).toHaveLength(1);
    requestClose(ref);
    expect(events()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Stop anyway" }));
    expect(events()).toHaveLength(2);
  });

  it("[R29] does not appear once the run has finished", async () => {
    const ref = createRef<ProvisioningPanelHandle>();
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={railSettlingEverything}
      />,
    );
    // POO-1503: the seeded start runs the rail; `Done` is the run finishing.
    await screen.findByRole("button", { name: "Done" });
    await act(async () => {});

    const proceed = requestClose(ref);

    expect(proceed).toBe(true);
    expect(screen.queryByText("Stop here?")).not.toBeInTheDocument();
  });

  it("[R29] does not appear once the run has failed", async () => {
    const ref = createRef<ProvisioningPanelHandle>();
    const failing = (plan: ProvisioningPlan) =>
      planRailSteps(plan).map((step, index) => ({
        key: step.key,
        run: async () => {
          // POO-1506 [R37]: a slippage-classified failure no longer reaches the failed screen at all
          // (auto-retry, then `8b`), so reaching it here needs a NON-slippage revert.
          if (index === 3) throw new Error("execution reverted: transfer amount exceeds balance");
          return { txHash: `0x${step.key}` } as const;
        },
      }));
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={failing}
      />,
    );
    // POO-1503: the seeded start runs the rail; the failed screen is where it stops.
    await screen.findByRole("button", { name: "Try again" });
    await act(async () => {});

    const proceed = requestClose(ref);

    expect(proceed).toBe(true);
    expect(screen.queryByText("Stop here?")).not.toBeInTheDocument();
  });

  it("POO-1506: a close attempt during the auto-retry notice (8a) is silently absorbed", async () => {
    const ref = createRef<ProvisioningPanelHandle>();
    const attempts = { count: 0 };
    // The swap slippage-fails once (arming the automatic retry), then HANGS on the retry's own
    // attempt, so the `8a` notice is stably on screen when the close arrives.
    const slippageThenHang = (plan: ProvisioningPlan) =>
      planRailSteps(plan).map((step, index) => ({
        key: step.key,
        run: async () => {
          if (index !== 1) return { txHash: `0x${step.key}` } as const;
          attempts.count += 1;
          if (attempts.count === 1) {
            throw Object.assign(new Error("execution reverted: price slippage check"), {
              code: "SLIPPAGE_EXCEEDED",
            });
          }
          return new Promise<never>(() => {});
        },
      }));
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={slippageThenHang}
      />,
    );
    await screen.findByText(
      "The price moved beyond your max slippage (2%). Retrying at the current price.",
    );
    await act(async () => {});

    const proceed = requestClose(ref);

    // Same class as `resumePrompt`/`requote`: absorbed, no `Stop here?` stacked over the notice.
    expect(proceed).toBe(false);
    expect(screen.queryByText("Stop here?")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "The price moved beyond your max slippage (2%). Retrying at the current price.",
      ),
    ).toBeInTheDocument();
  });

  it("POO-1506: a close attempt while 8b asks its question is absorbed, never a second stacked ask", async () => {
    const ref = createRef<ProvisioningPanelHandle>();
    // The swap slippage-fails on every attempt: the auto-retry consumes one, the second raises `8b`.
    const alwaysSlippage = (plan: ProvisioningPlan) =>
      planRailSteps(plan).map((step, index) => ({
        key: step.key,
        run: async () => {
          if (index === 1) {
            throw Object.assign(new Error("execution reverted: price slippage check"), {
              code: "SLIPPAGE_EXCEEDED",
            });
          }
          return { txHash: `0x${step.key}` } as const;
        },
      }));
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={alwaysSlippage}
      />,
    );
    await screen.findByTestId("provisioning-slippage-raise");
    await act(async () => {});

    const proceed = requestClose(ref);

    // `8b` already asks "raise or stop"; opening `Stop here?` on top would face the user with two
    // competing stop decisions at once. Absorbed instead, and `8b` keeps its question.
    expect(proceed).toBe(false);
    expect(screen.queryByText("Stop here?")).not.toBeInTheDocument();
    expect(screen.getByTestId("provisioning-slippage-raise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop here" })).toBeInTheDocument();
  });
});
