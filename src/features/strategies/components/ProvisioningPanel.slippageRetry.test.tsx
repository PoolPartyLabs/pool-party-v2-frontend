/**
 * @id PP-CORE-CMP-046 (POO-1506)
 * @name ProvisioningPanel — the shared slippage auto-retry, wired
 * @implements-rules-version v1 (POO-1506 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Screens `8a` (retrying, `7373:766`) and `8b` (raise the limit?, `7373:817`), spec §4b + §4e,
 * rules R37-R42 + R54.
 *
 * `PP-STR-HOK-001` (`useSlippageAutoRetry`) is ALREADY shipped and tested for the six transactional
 * modals — its own one-shot / second-failure bookkeeping is not re-proven here. What these tests
 * cover is specific to THIS panel: that a slippage failure never reaches the generic failure screen
 * ([R37], stronger than the six modals, which reuse their shared error view with swapped copy), that
 * the panel renders `8a`/`8b` instead, and that `8b`'s `Raise to {pct}% and retry` genuinely causes a
 * NEW build attempt (proving the `rail` dependency this issue added to `flowSteps`'s memo works) —
 * not merely that the UI updates.
 *
 * A real plan, deliberately: the rail order (approve → swap → approve → bridge) is what makes a
 * mid-route slippage failure and its retry legible.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningPlan } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { planRailSteps } from "../lib/buildPlanSteps";
import { ProvisioningPanel } from "./ProvisioningPanel";

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

const SLIPPAGE_ERROR = Object.assign(new Error("execution reverted: price slippage check"), {
  code: "SLIPPAGE_EXCEEDED",
});

/**
 * A rail whose SECOND step (the swap, the one carrying slippage) fails on its first `failCount`
 * attempts with a slippage-classified error, then succeeds. Every other step always succeeds. The
 * attempt count is read from a mutable holder so a test can assert on it directly.
 */
function railFailingSlippageAt(step: number, failCount: number, attempts: { count: number }) {
  return (plan: ProvisioningPlan) =>
    planRailSteps(plan).map((railStep, index) => ({
      key: railStep.key,
      run: async () => {
        if (index !== step) return { txHash: `0x${railStep.key}` };
        attempts.count += 1;
        if (attempts.count <= failCount) throw SLIPPAGE_ERROR;
        return { txHash: `0x${railStep.key}` };
      },
    }));
}

async function reachFirstSlippageFailure(failCount: number, attempts: { count: number }) {
  renderWithProviders(
    <ProvisioningPanel
      input={SCENARIOS.usdcBridge}
      opLabel="Invest in Stable Yield"
      onDone={noop}
      onCancel={noop}
      buildPlanSteps={railFailingSlippageAt(1, failCount, attempts)}
    />,
  );
  // Post-POO-1503/#835: with no `context` the panel seeds the start itself; no Confirm exists.
  await screen.findByTestId("provisioning-exec-window");
}

describe("ProvisioningPanel — slippage auto-retry, wired (POO-1506)", () => {
  beforeEach(() => {
    planHolder.current = realProvisioningPlan();
  });

  it("[R37] a slippage failure never reaches the generic failure screen, even on the second attempt", async () => {
    const attempts = { count: 0 };
    // Fails twice: the auto-retry consumes the first, the second is what 8b responds to.
    await reachFirstSlippageFailure(2, attempts);

    await waitFor(() => expect(attempts.count).toBeGreaterThanOrEqual(2));
    await screen.findByTestId("provisioning-slippage-raise");
    expect(screen.queryByTestId("provisioning-error")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("[R38] the first failure auto-retries once and shows the pending notice, not an error view", async () => {
    const attempts = { count: 0 };
    // Fails once: the auto-retry's second attempt succeeds, so 8b never appears.
    await reachFirstSlippageFailure(1, attempts);

    await screen.findByText(
      "The price moved beyond your max slippage (2%). Retrying at the current price.",
    );
    // Still inside the pending phase (the carousel window survives underneath the notice).
    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending");

    await waitFor(() => expect(attempts.count).toBe(2));
    await waitFor(() =>
      expect(
        screen.queryByText(
          "The price moved beyond your max slippage (2%). Retrying at the current price.",
        ),
      ).not.toBeInTheDocument(),
    );
  });

  it("[R39] the second failure shows 8b, naming the tolerance that just failed again", async () => {
    const attempts = { count: 0 };
    await reachFirstSlippageFailure(2, attempts);

    await screen.findByText("Price moved too much");
    // Reuses the SHARED `flow.slippage.errorBody` key verbatim (never rewritten here — POO-1510 was
    // Agent B's, per the epic's own "reuse conflict" decision, and landed as #852 @rules-v2). That
    // rewrite reached this screen automatically, exactly as planned: this is the post-#852 text,
    // the same one the six modals show.
    expect(
      screen.getByText(
        "The price moved beyond your max slippage (2%) again. The transaction was not sent.",
      ),
    ).toBeInTheDocument();
  });

  it("[R40] the primary CTA targets one step above the tolerance that failed, and states the cost", async () => {
    const attempts = { count: 0 };
    await reachFirstSlippageFailure(2, attempts);
    await screen.findByTestId("provisioning-slippage-raise");

    expect(screen.getByRole("button", { name: "Raise to 3% and retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop here" })).toBeInTheDocument();
    // [M5.2, POO-1526] Both exits are their own full-width rows; the explicit 44pt is a
    // min-height, not a bigger font.
    expect(screen.getByRole("button", { name: "Raise to 3% and retry" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Stop here" })).toHaveClass("min-h-11");
    // The cost line names the raise's real scope: `effectiveSlippagePct` feeds every remaining AMM
    // leg of the run (`useProvisioningRail({ slippagePct })`), never just the step that failed.
    expect(
      screen.getByText(
        "A higher limit lets every remaining conversion, not just this step, go through at a worse price. Raise it only if you want them to complete.",
      ),
    ).toBeInTheDocument();
  });

  it("[R40] the pills print the true tolerances at one decimal, so a fractional failure never lies", async () => {
    // A custom 2.5% tolerance that failed twice: the CTA applies 3.5, so the pills must read
    // 1.5% / 2.5% / 3.5% — never a rounded 2% / 3% / 4% beside a CTA that raises to 3.5.
    const attempts = { count: 0 };
    renderWithProviders(
      <ProvisioningPanel
        input={{ ...SCENARIOS.usdcBridge, slippagePct: 2.5 }}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={railFailingSlippageAt(1, 2, attempts)}
      />,
    );
    await screen.findByTestId("provisioning-slippage-raise");

    expect(screen.getByText("1.5%")).toBeInTheDocument();
    expect(screen.getByText("2.5%")).toBeInTheDocument();
    expect(screen.getByText("3.5%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raise to 3.5% and retry" })).toBeInTheDocument();
  });

  it("[R40] Raise and retry rebuilds the steps, rather than re-running the SAME failed closure", async () => {
    // Distinguishes "retryFrom re-invoked the existing closure" from "a raise made `flowSteps`
    // rebuild": the swap step throws on EVERY call made against the FIRST build generation (which
    // covers both the original attempt and the auto-retry, since neither one rebuilds), and only a
    // call against a REBUILT closure succeeds. If a raise failed to trigger a rebuild, `retryFrom`
    // would just re-invoke the same permanently-failing closure and this run would never complete.
    const buildCalls = { count: 0 };
    const buildPlanSteps = (plan: ProvisioningPlan) => {
      buildCalls.count += 1;
      const isFirstBuild = buildCalls.count === 1;
      return planRailSteps(plan).map((railStep, index) => ({
        key: railStep.key,
        run: async () => {
          if (index !== 1) return { txHash: `0x${railStep.key}` };
          if (isFirstBuild) throw SLIPPAGE_ERROR;
          return { txHash: `0x${railStep.key}` };
        },
      }));
    };
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={buildPlanSteps}
      />,
    );
    await screen.findByTestId("provisioning-slippage-raise");
    expect(buildCalls.count).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Raise to 3% and retry" }));

    // A second BUILD GENERATION exists — proving `flowSteps` actually recomputed against the raised
    // tolerance, not merely that `retryFrom` was called again against the old one.
    await waitFor(() => expect(buildCalls.count).toBe(2));
    // And it is the one that runs: the failure this generation is built to never repeat does not.
    await waitFor(() =>
      expect(screen.queryByTestId("provisioning-slippage-raise")).not.toBeInTheDocument(),
    );
    await screen.findByTestId("provisioning-exec-window");
  });

  it("[R40] the Custom pill opens the host's settings dialog, and is absent when no host wired one", async () => {
    const attempts = { count: 0 };
    const onOpenSettings = vi.fn();
    const { rerender } = renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={railFailingSlippageAt(1, 2, attempts)}
        onOpenSettings={onOpenSettings}
        slippagePct={2}
      />,
    );
    await screen.findByTestId("provisioning-slippage-raise");

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    // [M5.1, POO-1526] The pill matches 3 non-interactive sibling pills of the same visual height,
    // so the 44pt target is an invisible expanded hit area (POO-840 R2), not a taller box.
    expect(screen.getByRole("button", { name: "Custom" })).toHaveClass("after:-inset-3.5");

    // Without `onOpenSettings` there is nothing for the pill to open: it must not render as a
    // button that does nothing.
    rerender(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={railFailingSlippageAt(1, 2, attempts)}
        slippagePct={2}
      />,
    );
    expect(screen.queryByRole("button", { name: "Custom" })).not.toBeInTheDocument();
  });

  it("[R42] a non-slippage failure is unaffected: it still reaches the generic failure screen", async () => {
    const attempts = { count: 0 };
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={(plan) =>
          planRailSteps(plan).map((step, index) => ({
            key: step.key,
            run: async () => {
              if (index === 3) {
                attempts.count += 1;
                throw new Error("execution reverted: price impact too high");
              }
              return { txHash: `0x${step.key}` };
            },
          }))
        }
      />,
    );
    await screen.findByRole("button", { name: "Try again" });
    expect(screen.queryByTestId("provisioning-slippage-raise")).not.toBeInTheDocument();
    // Exactly one attempt: no auto-retry for a kind that never classified as slippage.
    expect(attempts.count).toBe(1);
  });
});

describe("ProvisioningPanel — 8b's Custom pill, wired (POO-1506 [R40])", () => {
  beforeEach(() => {
    planHolder.current = realProvisioningPlan();
  });

  /**
   * A rail whose swap step (index 1) slippage-fails on every call made against a build GENERATION
   * listed in `failingGenerations` and succeeds on any other, so a test can prove which generation
   * — and therefore which tolerance — a retry actually ran.
   */
  function railFailingForGenerations(buildCalls: { count: number }, failingGenerations: number[]) {
    return (plan: ProvisioningPlan) => {
      buildCalls.count += 1;
      const generation = buildCalls.count;
      return planRailSteps(plan).map((railStep, index) => ({
        key: railStep.key,
        run: async () => {
          if (index === 1 && failingGenerations.includes(generation)) throw SLIPPAGE_ERROR;
          return { txHash: `0x${railStep.key}` };
        },
      }));
    };
  }

  function panelWithHostSlippage(
    rail: Parameters<typeof ProvisioningPanel>[0]["buildPlanSteps"],
    hostSlippagePct: number,
  ) {
    return (
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={rail}
        onOpenSettings={noop}
        slippagePct={hostSlippagePct}
      />
    );
  }

  it("a value committed in the settings dialog re-targets the CTA, and the retry really runs at it", async () => {
    const buildCalls = { count: 0 };
    // Generation 1 (tolerance 2%) always slippage-fails; generation 2 (the custom 10%) fails once
    // more, so `8b` reopens NAMING the tolerance that generation actually carried.
    const rail = railFailingForGenerations(buildCalls, [1, 2]);
    const { rerender } = renderWithProviders(panelWithHostSlippage(rail, 2));
    await screen.findByTestId("provisioning-slippage-raise");
    expect(screen.getByRole("button", { name: "Raise to 3% and retry" })).toBeInTheDocument();

    // The user commits 10% in the host's settings dialog (the host re-renders the panel with its
    // live gear state — exactly what `slippagePct={slippage}` does in all six host modals).
    rerender(panelWithHostSlippage(rail, 10));

    // The CTA and the highlighted pill now offer the committed value, not old+1 — and never the
    // word "Raise"-to-old+1 alongside it.
    const raise = screen.getByTestId("provisioning-slippage-raise");
    expect(within(raise).getByText("10.0%")).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: "Retry with 10% slippage" });
    expect(screen.queryByRole("button", { name: "Raise to 3% and retry" })).not.toBeInTheDocument();

    fireEvent.click(cta);

    // A second build generation exists (the tolerance the closures bake in changed) …
    await waitFor(() => expect(buildCalls.count).toBe(2));
    // … and the tolerance that generation FAILED with is the committed one: `8b` reopens naming
    // 10%, which is only possible if `effectiveSlippagePct` genuinely became 10.
    await screen.findByText(
      "The price moved beyond your max slippage (10%) again. The transaction was not sent.",
    );
  });

  it("a committed value BELOW the failed tolerance is offered honestly and really runs", async () => {
    const buildCalls = { count: 0 };
    const rail = railFailingForGenerations(buildCalls, [1]);
    const { rerender } = renderWithProviders(panelWithHostSlippage(rail, 2));
    await screen.findByTestId("provisioning-slippage-raise");

    rerender(panelWithHostSlippage(rail, 1));

    // Never "Raise to 1%": the copy must not claim a raise for a lower target.
    const cta = screen.getByRole("button", { name: "Retry with 1% slippage" });
    expect(screen.queryByRole("button", { name: /Raise to/ })).not.toBeInTheDocument();

    fireEvent.click(cta);
    // Generation 2 runs (and succeeds): the lower tolerance was applied, not silently ignored.
    await waitFor(() => expect(buildCalls.count).toBe(2));
    await waitFor(() =>
      expect(screen.queryByTestId("provisioning-slippage-raise")).not.toBeInTheDocument(),
    );
    await screen.findByTestId("provisioning-exec-window");
  });

  it("host gear drift from BEFORE the prompt opened never masquerades as a commit", async () => {
    // The host's gear can already disagree with the running tolerance when `8b` opens (it never
    // learns of `8b`'s own raises, and a step-2 gear edit after `evaluate()` never reached
    // `input`). Only a change made WHILE `8b` is up — a commit through the Custom pill's dialog —
    // may re-target the CTA.
    const buildCalls = { count: 0 };
    const rail = railFailingForGenerations(buildCalls, [1, 2]);
    renderWithProviders(panelWithHostSlippage(rail, 5));
    await screen.findByTestId("provisioning-slippage-raise");

    // Stale drift (gear 5 vs failed 2) is ignored: the CTA still offers the one-step raise.
    expect(screen.getByRole("button", { name: "Raise to 3% and retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry with/ })).not.toBeInTheDocument();
  });

  it("closing the dialog without committing keeps the one-step raise", async () => {
    const buildCalls = { count: 0 };
    const rail = railFailingForGenerations(buildCalls, [1, 2]);
    const { rerender } = renderWithProviders(panelWithHostSlippage(rail, 2));
    await screen.findByTestId("provisioning-slippage-raise");

    // Open + dismiss with no commit: the host state never changed, so neither does the ask.
    rerender(panelWithHostSlippage(rail, 2));
    expect(screen.getByRole("button", { name: "Raise to 3% and retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry with/ })).not.toBeInTheDocument();
  });
});

/**
 * POO-1525 [M3.3]: `8b` is the one CTA site this file already reaches correctly (the real-plan +
 * `useProvisioningPlan` mock the pinned-footer suite deliberately does not duplicate). See
 * `ProvisioningPanel.stickyFooter.test.tsx` for the other sites and why each lives where it does.
 */
describe("ProvisioningPanel — the terminal CTA stays pinned (POO-1525)", () => {
  beforeEach(() => {
    planHolder.current = realProvisioningPlan();
  });

  it("[pending, 8b] pins the Raise-to-X%-and-retry / Stop-here pair", async () => {
    const attempts = { count: 0 };
    await reachFirstSlippageFailure(2, attempts);
    await screen.findByTestId("provisioning-slippage-raise");

    const footer = screen.getByTestId("provisioning-sticky-footer");
    expect(footer).toContainElement(screen.getByRole("button", { name: "Raise to 3% and retry" }));
    expect(footer).toContainElement(screen.getByRole("button", { name: "Stop here" }));
    // Containment alone cannot prove the pin is EFFECTIVE: `position: sticky` never escapes its
    // containing block, so a footer nested inside the ~350px `8b` card would pass the two
    // assertions above while only ever pinning within that card. The footer must be a direct
    // child of the phase root, sibling of the card, like the panel's other pinned sites.
    expect(footer.parentElement).toBe(screen.getByTestId("provisioning-panel"));
    expect(screen.getByTestId("provisioning-slippage-raise")).not.toContainElement(footer);
  });
});

/**
 * POO-1812 [R4]: a mid-run raise moves the copy and the NEXT run's seed, never the budget an
 * in-flight run is already being held to.
 *
 * The ledger's budget is what decides whether a worse re-quote is absorbed or refused. Had it grown
 * when the buyer raised slippage, the run would be measured against a number it was never sized
 * against, and a decision the panel had already shown could change underneath it. That is exactly
 * what POO-1499 [R7] forbids and what POO-1812 [R2] restates. The rate IN FORCE still rides along,
 * as `rate_bps`, so the divergence is legible rather than invisible.
 */
describe("ProvisioningPanel, the buffer budget is pinned to the seeded rate (POO-1812 [R4])", () => {
  beforeEach(() => {
    planHolder.current = realProvisioningPlan();
    window.dataLayer = [];
  });

  function bufferRows(): Record<string, unknown>[] {
    return ((window.dataLayer ?? []) as Record<string, unknown>[]).filter(
      (entry) => entry.event === "funding_buffer_consumed",
    );
  }

  it("[R4] a raise moves the reported rate and leaves the budget where the run seeded it", async () => {
    const attempts = { count: 0 };
    let consume: ((worseBps: number) => boolean) | undefined;
    renderWithProviders(
      <ProvisioningPanel
        // 5% seeds a 6% buffer (600 bps) and the CTA below raises the tolerance to 6%, whose rate is
        // 7% (700 bps). Two different numbers, so a budget that followed the raise would show.
        input={{ ...SCENARIOS.usdcBridge, slippagePct: 5 }}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={(plan, rail) => {
          consume = rail.consumeBuffer;
          return railFailingSlippageAt(1, 2, attempts)(plan);
        }}
      />,
    );
    await screen.findByTestId("provisioning-slippage-raise");

    act(() => {
      consume?.(50);
    });
    expect(bufferRows().at(-1)).toMatchObject({
      buffer_budget_bps: 600,
      rate_bps: 600,
      slippage_pct: 5,
    });

    fireEvent.click(screen.getByRole("button", { name: "Raise to 6% and retry" }));
    await waitFor(() =>
      expect(screen.queryByTestId("provisioning-slippage-raise")).not.toBeInTheDocument(),
    );

    act(() => {
      consume?.(50);
    });
    const latest = bufferRows().at(-1);
    // The tolerance in force moved, and the rate with it. The budget did not.
    expect(latest).toMatchObject({ slippage_pct: 6, rate_bps: 700, buffer_budget_bps: 600 });
    // The running total is still spent against the SAME budget, so the headroom is readable.
    expect(latest).toMatchObject({ buffer_cumulative_bps: 100, buffer_headroom_bps: 500 });
    // And the raise did not push the run back to a gate: step 2 never re-opens underneath it, which
    // is the shape a re-closed CTA would take here.
    expect(screen.getByTestId("provisioning-panel")).not.toHaveAttribute("data-phase", "sources");
  });
});
