/**
 * @id PP-CORE-CMP-046 (POO-1505, POO-1527)
 * @name ProvisioningPanel — the buy step expands in place
 * @implements-rules-version v3 (POO-1527 rules v1) · v2 (POO-1505 rules v3)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Spec §4/§5 [R30] and [R32] (business-rules-clarification, 2026-08-11): when the plan reaches a
 * buy, the step list collapses to a one-line mini summary and the vendor checkout takes the space
 * that frees up, the modal resizes with no remount, and the iframe mounts only once the expansion
 * has settled. The close-attempt question the spec once answered here as [R33] is superseded
 * (rules v3, 2026-08-12) by POO-1564's exit semantics — full teardown, close proceeds — which
 * `ProvisioningPanel.onRamp.test.tsx`'s [R13] suite pins; this suite deliberately re-tests none of it.
 *
 * POO-1527 [M4.3]/[M4.4] add the two mobile-only deltas at the bottom of this file. Everything
 * [M4.1]/[M4.2] ask for is already what the [R30]/[R32] suite above pins, so they get no second
 * copy here; the sheet's own fixed bottom edge is asserted where it lives, in
 * `provisioningSheet.test.tsx`, and the host wiring of [M4.4] in `provisioningBuyActiveSheet.test.tsx`.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningOrder, ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import { REAL_STEPS, realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { planRailSteps } from "../lib/buildPlanSteps";
import type { PlanRailReporters } from "./ProvisioningPanel";
import {
  BUY_EXPAND_MS,
  ProvisioningPanel,
  type ProvisioningPanelHandle,
} from "./ProvisioningPanel";

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

vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));

const onRamp = vi.hoisted(() => ({
  getMethods: vi.fn(),
  getQuote: vi.fn(),
}));
vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: onRamp.getMethods,
  getOnRampQuoteAction: onRamp.getQuote,
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

// POO-1578: the mint's optional tail is an OPTIONS object, not a positional `confirmResume`. This
// double still declared the old positional shape and only compiled because the parameter is unused
// and `vi.mock`'s factory return type is never checked against the module it replaces. Matches the
// sibling in `ProvisioningPanel.onRamp.test.tsx`, which models what the PANEL actually sends.
const rail = vi.hoisted(() => ({
  mintOnRampRequest: vi.fn(
    async (
      _order: unknown,
      _options: {
        confirmResume: (intent: {
          requestId: string;
          startedAt: number;
          paid: boolean;
        }) => Promise<"resume" | "new">;
        paymentMethod?: string;
      },
    ) => ({ requestId: "req-1", wallet: "0xC3673ADc0000000000000000000000000000BEEF" }),
  ),
}));
vi.mock("../hooks/useProvisioningRail", () => ({
  useProvisioningRail: () => ({
    buildSteps: undefined,
    openJournal: () => {},
    closeJournal: () => {},
    mintOnRampRequest: rail.mintOnRampRequest,
  }),
}));

/**
 * The frame, as a single button that reports settlement — same shape as `ProvisioningPanel.onRamp.
 * test.tsx`'s stub, minimal to what this suite needs (whether it mounted, and forcing it to settle to
 * exercise the collapse-back half of [R30]).
 */
vi.mock("./provisioning/PaybisWidgetFrame", () => ({
  PaybisWidgetFrame: ({
    requestId,
    onSettled,
  }: {
    requestId: string;
    onSettled?: (deltas: unknown[]) => void;
  }) => (
    <div data-testid="paybis-frame" data-request-id={requestId}>
      <button type="button" onClick={() => onSettled?.([])}>
        widget settled
      </button>
    </div>
  ),
}));

const ORDER: ProvisioningOrder = {
  currencyCode: "USDC-BASE",
  fiatAmount: "120.00",
  fiatCurrency: "USD",
};

const BUY_STEP: ProvisioningStep = {
  type: "buy",
  key: "buy",
  labelKey: "provisioning.steps.buy",
  fromToken: "USD",
  toToken: "USDC",
  toChainId: 8453,
  amountUsd: 120,
  poweredBy: "paybis",
  order: ORDER,
};

/**
 * A rail derived from `planRailSteps` itself, exactly as `ProvisioningPanel.stopConfirm.test.tsx`'s
 * `railSettlingEverything` is, so this mock's keys can never drift from what the VIEW independently
 * derives (`ProvisioningPanel.tsx`'s `view` reads `planRailSteps(plan)` directly, never the
 * `buildPlanSteps` prop — a hand-rolled key list here would silently mismatch the rail's own
 * approval-expansion for an ERC-20 leg). Every step resolves immediately except `buy`, which awaits
 * the widget exactly as the real rail does.
 */
function buyThenBridgeRail(plan: ProvisioningPlan, reporters: PlanRailReporters) {
  return planRailSteps(plan).map((step) => ({
    key: step.key,
    run: async () => {
      if (step.key === "buy") {
        await reporters.runOnRampBuy?.({ order: ORDER, expectedToken: "USDC-BASE" });
        return {};
      }
      return { txHash: `0x${step.key}` } as const;
    },
  }));
}

function noop() {}

/**
 * POO-1576: the buy step ASKS before it mints, so every path to the checkout crosses "Choose how to
 * pay" first. The on-ramp actions are not stubbed in this suite, so the step shows its informational
 * state and Continue proceeds on the rail's own prefill, which is what these layout rules were
 * written against.
 */
async function continuePastMethodStep() {
  fireEvent.click(await screen.findByTestId("provisioning-method-continue"));
  await act(async () => {});
}

beforeEach(() => {
  planHolder.current = realProvisioningPlan({
    steps: [BUY_STEP, REAL_STEPS[1] as ProvisioningStep, REAL_STEPS[2] as ProvisioningStep],
  });
  rail.mintOnRampRequest.mockClear();
  localStorage.clear();
  // Default: no reduced-motion preference, so the expand delay applies exactly as production sees it
  // for the overwhelming majority of users.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

async function renderToMiniSummary(
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
      buildPlanSteps={buyThenBridgeRail}
      {...extraProps}
    />,
  );
  await continuePastMethodStep();
  const summary = await screen.findByTestId("provisioning-buy-mini-summary");
  await act(async () => {});
  return { ref, summary };
}

describe("ProvisioningPanel — the buy step expands in place (POO-1505)", () => {
  // @rule R30 — the step list collapses to the mini summary the instant the buy step opens.
  it("[R30] replaces the step carousel with the mini summary while the buy step is active", async () => {
    await renderToMiniSummary();

    expect(screen.queryByTestId("provisioning-exec-window")).not.toBeInTheDocument();
    expect(screen.getByTestId("provisioning-buy-mini-summary")).toBeInTheDocument();
  });

  // @rule R30/R32 — the mini summary carries the step, the amount, and Step N of M on one line.
  //
  // "Step 1 of 3", not 2: `planRailSteps` expands the bridge leg into its own approval step first
  // (the SAME expansion `provisioningView.ts` documents), so the buy plus a bridge is three rail
  // steps, not two. Asserting the real total rather than a rounder-looking number is the point: a
  // fixture chosen to make the assertion prettier would stop proving what the rail actually runs.
  it("[R32] carries the step title, the amount, and Step N of M in the summary", async () => {
    const { summary } = await renderToMiniSummary();

    expect(summary).toHaveTextContent(/Buying USDC/);
    expect(summary).toHaveTextContent("$120.00");
    expect(summary).toHaveTextContent("Step 1 of 3");
  });

  // @rule R32 — the provider iframe mounts only once the expansion has settled, so it never reflows
  // mid-load. A pure mount defer: nothing animates, the wait exists so the in-place resize gets its
  // own frame(s) before the vendor checkout starts loading. Asserted on ORDER (absent, then present),
  // not on the exact millisecond: real timers, so a machine under load still proves the gate without
  // pinning a flaky boundary.
  it("[R32] defers the checkout iframe until the in-place expand settles", async () => {
    await renderToMiniSummary();

    expect(screen.queryByTestId("paybis-frame")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("paybis-frame")).toBeInTheDocument());
  });

  // @rule R32 — reduced motion skips the wait: the defer shields the iframe load from layout motion,
  // and this user asked for no motion to be shielded from.
  it("[R32] mounts the iframe immediately under prefers-reduced-motion", async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    const ref = createRef<ProvisioningPanelHandle>();
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={buyThenBridgeRail}
      />,
    );

    await continuePastMethodStep();
    // No `waitFor` needed: under reduced motion the frame is expected on the SAME settle the mini
    // summary itself resolves on. A `findBy*` still tolerates the async plan/mint chain either way.
    await screen.findByTestId("paybis-frame");
  });

  // @rule R30 — collapses back to the normal running layout once the provider flow finishes.
  //
  // The rest of the mock rail resolves near-instantly once `buy` does (real approvals/bridges do
  // not), so this pins the shape R30 actually asks for — the mini summary is gone and the ordinary
  // multi-step carousel is back — rather than a step position the fast-resolving mock races past.
  it("[R30] collapses back to the step carousel once the buy step settles", async () => {
    await renderToMiniSummary();
    await waitFor(() => expect(screen.getByTestId("paybis-frame")).toBeInTheDocument());

    act(() => {
      screen.getByRole("button", { name: "widget settled" }).click();
    });

    await waitFor(() =>
      expect(screen.queryByTestId("provisioning-buy-mini-summary")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("paybis-frame")).not.toBeInTheDocument();
    expect(screen.getByTestId("provisioning-exec-window")).toBeInTheDocument();
  });

  // @rule R30, a11y — the collapse UNMOUNTS the carousel, whose `aria-expanded` disclosure button is
  // keyboard-reachable. Removing the focused element drops focus to `body` with no event fired, so a
  // keyboard or screen-reader user mid-flow would be stranded at the top of the document. The panel
  // samples where focus is the instant before the collapse and lands it on the mini summary instead.
  it("[R30] moves focus to the mini summary when the collapse fires while the carousel holds it", async () => {
    // Buy SECOND, so the carousel is on screen (running the swap) long enough to receive focus, and
    // the swap gated on a promise this test resolves, so the collapse fires at a chosen moment.
    planHolder.current = realProvisioningPlan({
      steps: [REAL_STEPS[0] as ProvisioningStep, BUY_STEP, REAL_STEPS[2] as ProvisioningStep],
    });
    let releaseGate: () => void = noop;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={(plan, reporters) =>
          planRailSteps(plan).map((step) => ({
            key: step.key,
            run: async () => {
              if (step.key === "buy") {
                await reporters.runOnRampBuy?.({ order: ORDER, expectedToken: "USDC-BASE" });
                return {};
              }
              await gate;
              return { txHash: `0x${step.key}` } as const;
            },
          }))
        }
      />,
    );
    await screen.findByTestId("provisioning-exec-window");
    await act(async () => {});

    // The window sits INSIDE the [R21] disclosure button, so the closest button IS the toggle.
    const toggle = screen
      .getByTestId("provisioning-exec-window")
      .closest("button") as HTMLButtonElement;
    expect(toggle).toHaveAttribute("aria-expanded");
    act(() => {
      toggle.focus();
    });
    expect(toggle).toHaveFocus();

    act(() => {
      releaseGate();
    });
    await continuePastMethodStep();
    const summary = await screen.findByTestId("provisioning-buy-mini-summary");
    await act(async () => {});

    expect(summary).toHaveFocus();
  });

  // @rule R30, a11y mutation check — focus is RESTORED, never stolen: a collapse that fires while
  // focus is elsewhere (here: never inside the carousel at all) must leave focus alone.
  it("[R30] does not steal focus when the carousel never held it", async () => {
    const { summary } = await renderToMiniSummary();

    expect(summary).not.toHaveFocus();
  });
});

/** POO-1505 [R32]: the constant itself is part of the contract these tests pin. */
describe("BUY_EXPAND_MS", () => {
  it("is exported and positive, so the delay can never silently become 0 by accident", () => {
    expect(BUY_EXPAND_MS).toBeGreaterThan(0);
  });
});

describe("ProvisioningPanel — the buy step on a mobile sheet (POO-1527)", () => {
  // @rule M4.3 — the checkout owns the one primary action a screen may have, so the WHOLE pinned
  // footer goes, not only its "Keep this open" line. It must come back the instant the buy ends,
  // because the run continues into the next leg and the state button IS that run's state ([R27]).
  it("[M4.3] removes the pinned CTA while the buy step is active, and it returns once it ends", async () => {
    await renderToMiniSummary();

    expect(screen.queryByTestId("provisioning-sticky-footer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provisioning-exec-state")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId("paybis-frame")).toBeInTheDocument());
    act(() => {
      screen.getByRole("button", { name: "widget settled" }).click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("provisioning-sticky-footer")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("provisioning-exec-state")).toBeInTheDocument();
  });

  // @rule M4.3 mutation check — the footer's absence must be caused by the BUY, not by the panel
  // simply having no footer in `pending`. Same rail, sampled before the buy step opens.
  it("[M4.3] still renders the pinned CTA in the same phase when no buy is active", async () => {
    // Buy SECOND, and gate the first leg, so the panel sits in `pending` with the buy not yet open.
    planHolder.current = realProvisioningPlan({
      steps: [REAL_STEPS[0] as ProvisioningStep, BUY_STEP, REAL_STEPS[2] as ProvisioningStep],
    });
    let releaseGate: () => void = noop;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={(plan, reporters) =>
          planRailSteps(plan).map((step) => ({
            key: step.key,
            run: async () => {
              if (step.key === "buy") {
                await reporters.runOnRampBuy?.({ order: ORDER, expectedToken: "USDC-BASE" });
                return {};
              }
              await gate;
              return { txHash: `0x${step.key}` } as const;
            },
          }))
        }
      />,
    );
    await screen.findByTestId("provisioning-exec-window");
    await act(async () => {});

    expect(screen.getByTestId("provisioning-sticky-footer")).toBeInTheDocument();
    expect(screen.getByTestId("provisioning-exec-state")).toBeInTheDocument();

    act(() => {
      releaseGate();
    });
    await continuePastMethodStep();
    await screen.findByTestId("provisioning-buy-mini-summary");
    await act(async () => {});

    expect(screen.queryByTestId("provisioning-sticky-footer")).not.toBeInTheDocument();
  });

  // @rule M4.4 — the signal a mobile host uses to disable swipe-to-dismiss and hide the sheet's grab
  // handle for the checkout's DURATION. The host wiring itself is proven in
  // `provisioningBuyActiveSheet.test.tsx`; this pins only that the panel reports both edges.
  it("[M4.4] reports onBuyActiveChange(true) once the buy step starts, and (false) once it ends", async () => {
    const onBuyActiveChange = vi.fn();
    await renderToMiniSummary({ onBuyActiveChange });

    expect(onBuyActiveChange).toHaveBeenLastCalledWith(true);

    await waitFor(() => expect(screen.getByTestId("paybis-frame")).toBeInTheDocument());
    act(() => {
      screen.getByRole("button", { name: "widget settled" }).click();
    });

    await waitFor(() => expect(onBuyActiveChange).toHaveBeenLastCalledWith(false));
  });

  // @rule M4.4 mutation check — the signal must be DISTINCT from `onLockChange`, which [R13]/POO-1384
  // deliberately keeps `false` throughout a buy. A single fused callback would pass the test above
  // and silently re-lock dismissal on the exact step that rule exempts.
  it("[M4.4] does not lock the host while the buy step is active", async () => {
    const onLockChange = vi.fn();
    const onBuyActiveChange = vi.fn();
    await renderToMiniSummary({ onLockChange, onBuyActiveChange });

    expect(onBuyActiveChange).toHaveBeenLastCalledWith(true);
    expect(onLockChange).toHaveBeenLastCalledWith(false);
  });
});
