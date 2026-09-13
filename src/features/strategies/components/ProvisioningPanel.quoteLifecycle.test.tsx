/**
 * @id PP-CORE-CMP-046 (POO-1503)
 * @name ProvisioningPanel — step 2's quote lifecycle
 * @implements-rules-version v20 (POO-1503 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Two regressions the Confirm-step deletion (PR #835 review) introduced, locked here so neither can
 * return:
 *
 * 1. **The freshness loop must not depend on the disclosure.** On main the plan screen always
 *    mounted `QuoteStatus`, whose countdown fired `requotePlan` every TTL. POO-1503 moved that
 *    countdown behind step 2's `See details`, which is CLOSED by default, so nothing kept the quote
 *    fresh and the header printed a static `Refreshes in {n}s` that never ticked: a user could sit
 *    on step 2 for minutes, then sign an arbitrarily stale price. The loop is now hosted by the
 *    panel (`QuoteFreshnessLoop`), and these tests drive the TTL with the disclosure shut.
 *
 * 2. **A changed selection must not execute the old selection's route.** `useProvisioningPlan`
 *    keeps the PREVIOUS plan mounted while a re-quote is in flight, so without a `planLoading`
 *    guard the start effect could see the stale plan, pass its coverage re-check, and hand the rail
 *    a route quoted for sources the user just deselected. On main this was structurally impossible
 *    (`confirmedSelection` pinned the quoted selection and `onSelectedChange` invalidated it); these
 *    tests restore that semantics as explicit assertions. The sibling suites mock the plan hook with
 *    a hard-coded `loading: false`, which is exactly why they could not catch it: this file's mock
 *    drives the loading state.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { GasFeasibility, ProvisioningNeedInput, ProvisioningPlan } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
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

const BASE = 8453;
const ARBITRUM = 42161;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

/**
 * The controllable seam this file exists for: `plan` and `loading` are DRIVEN by each test, so a
 * re-quote in flight (previous plan mounted, `loading: true`) is representable. `refresh` is the
 * spy the hosted countdown must fire on TTL expiry.
 */
const { planState, requoteSpy } = vi.hoisted(() => ({
  planState: {
    current: { plan: null as ProvisioningPlan | null, loading: false },
  },
  requoteSpy: vi.fn(),
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: (_input: unknown, _gas: unknown, options: { enabled?: boolean } = {}) => ({
    plan: options.enabled === false ? null : planState.current.plan,
    loading: planState.current.loading,
    error: null,
    refresh: requoteSpy,
  }),
}));

function noop() {}

function verdict(chainId: number): GasFeasibility {
  return {
    chainId,
    verdict: "OK",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0,
    surplusUsd: 5,
    reasonKey: "provisioning.gasVerdict.ok",
  };
}

/** The pre-selected target-chain holding (selection A). */
function usdcOnBase(): FundingSource {
  return {
    chainId: BASE,
    address: USDC_BASE,
    symbol: "USDC",
    decimals: 6,
    amount: "500000000",
    usd: 500,
    reachableChainIds: [BASE],
    isNative: false,
    logoUrl: "",
  };
}

/** A second, cross-chain holding, so a test can CHANGE the selection (A -> B). */
function usdcOnArbitrum(): FundingSource {
  return {
    chainId: ARBITRUM,
    address: USDC_ARBITRUM,
    symbol: "USDC",
    decimals: 6,
    amount: "250000000",
    usd: 250,
    reachableChainIds: [ARBITRUM, BASE],
    isNative: false,
    logoUrl: "",
  };
}

function context(): ProvisioningGateContext {
  return {
    targetChainId: BASE,
    sources: [usdcOnBase(), usdcOnArbitrum()],
    gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: verdict(ARBITRUM) },
    balancesByChain: { [BASE]: { nativeUsd: 5, tokenUsd: 500 } },
    gasEstimateUsd: 0.075,
  };
}

const INPUT: ProvisioningNeedInput = {
  balancesByChain: { [BASE]: { nativeUsd: 5, tokenUsd: 500 } },
  currentChainId: BASE,
  targetChainId: BASE,
  opRequiredUsdc: 100,
  gasEstimateUsd: 0.075,
};

const ARBITRUM_ROW = `funding-source-${ARBITRUM}-${USDC_ARBITRUM.toLowerCase()}`;

/**
 * The rail seam: one hanging step whose `run` records WHICH plan is executing. Deliberately captured
 * in `run` and not in the builder itself, because `flowSteps` rebuilds the steps on every plan
 * change while only `startRun` ever runs them.
 */
function panelElement(executed: ProvisioningPlan[]) {
  return (
    <ProvisioningPanel
      input={INPUT}
      context={context()}
      opLabel="Invest in Stable Yield"
      onDone={noop}
      onCancel={noop}
      buildPlanSteps={(plan) => [
        {
          key: "hang",
          run: () => {
            executed.push(plan);
            return new Promise<never>(() => {});
          },
        },
      ]}
    />
  );
}

beforeEach(() => {
  planState.current = { plan: realProvisioningPlan(), loading: false };
  requoteSpy.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ProvisioningPanel — the quote-freshness loop (POO-1503 fix)", () => {
  // The regression this locks: the countdown lived inside the disclosure, the disclosure is closed
  // by default, so the quote NEVER refreshed on the flow's default path and the header's figure was
  // a static TTL that lied about it.
  it("re-quotes on TTL expiry while See details stays CLOSED, with a header that really ticks", () => {
    vi.useFakeTimers();
    renderWithProviders(panelElement([]));

    // Step 2 is up and the disclosure is shut: the cost card (old home of the countdown) is not
    // mounted at all.
    expect(screen.getByRole("button", { name: "See details" })).toBeInTheDocument();
    expect(screen.queryByTestId("provisioning-cost-breakdown")).not.toBeInTheDocument();

    // The header's figure is a live countdown (fixture TTL 30s), not a static promise.
    expect(screen.getByText("Refreshes in 30s")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("Refreshes in 27s")).toBeInTheDocument();

    // The window elapses with the disclosure still closed: the plan re-quotes anyway.
    act(() => {
      vi.advanceTimersByTime(27_000);
    });
    expect(requoteSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("provisioning-cost-breakdown")).not.toBeInTheDocument();
  });

  // The counterpart hazard: with the disclosure OPEN there used to be two countdowns for one quote
  // (the static header plus the card's own loop), which could disagree and double-fire. Both labels
  // now display the ONE hosted countdown, so they always agree and one window fires one re-quote.
  it("runs ONE countdown with the disclosure open: both labels agree, one re-quote per window", () => {
    vi.useFakeTimers();
    renderWithProviders(panelElement([]));

    fireEvent.click(screen.getByRole("button", { name: "See details" }));
    expect(screen.getByTestId("provisioning-cost-breakdown")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    // Header and the card's status line: the same figure, twice, from the same hosted loop.
    expect(screen.getAllByText("Refreshes in 25s")).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(25_000);
    });
    // One window, one re-quote. Two live countdowns would have fired twice.
    expect(requoteSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ProvisioningPanel — a superseded selection cannot execute (POO-1503 fix)", () => {
  // The serious one. `useProvisioningPlan` keeps the previous plan non-null while re-planning, so
  // between "the user toggled a source" and "the new quote landed" the mounted plan describes the
  // route for the selection the user ABANDONED. The always-enabled CTA pressed in that window must
  // wait for the current ask's plan, never start the stale one: on main `confirmedSelection` made
  // this structurally impossible, and this test is that guarantee restated for the confirm-less flow.
  it("does not start the stale plan while the changed selection is re-quoting", async () => {
    const executed: ProvisioningPlan[] = [];
    const planA = realProvisioningPlan();
    const planB = realProvisioningPlan({
      quote: { ...planA.quote, quotedAt: "2026-07-25T12:00:31.000Z", totalPayUsd: 133.41 },
    });
    planState.current = { plan: planA, loading: false };
    const { rerender } = renderWithProviders(panelElement(executed));
    await screen.findByRole("button", { name: "Confirm and start" });

    // The user toggles a second source: the re-quote for the NEW selection goes out while the OLD
    // selection's plan stays mounted (the hook keeps it so the screen does not blank).
    planState.current = { plan: planA, loading: true };
    fireEvent.click(screen.getByTestId(ARBITRUM_ROW));
    expect(screen.getByTestId(ARBITRUM_ROW)).toHaveAttribute("data-selected", "true");

    // The CTA is pressed while that re-quote is still in flight.
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));

    // Nothing runs. Without the `planLoading` guard this is where the panel started planA: the
    // route quoted for the selection the user just changed, approving and swapping the wrong sources.
    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "sources");
    expect(executed).toHaveLength(0);

    // The fresh quote lands: the start the user asked for proceeds, against the plan that answers
    // the CURRENT selection.
    planState.current = { plan: planB, loading: false };
    rerender(panelElement(executed));
    await waitFor(() => {
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending");
    });
    await waitFor(() => {
      expect(executed).toEqual([planB]);
    });
  });

  // Main's other half: `onSelectedChange` invalidated the pending consent. A press of the CTA is a
  // yes to a SPECIFIC selection's route; changing the selection afterwards withdraws it, and the run
  // must wait for a new press rather than auto-starting when the new quote lands.
  it("a selection change withdraws a pending start request", async () => {
    const executed: ProvisioningPlan[] = [];
    const planA = realProvisioningPlan();
    const planB = realProvisioningPlan({
      quote: { ...planA.quote, quotedAt: "2026-07-25T12:00:31.000Z" },
    });
    // A re-quote is in flight when the user presses the CTA, so the panel is WAITING to start...
    planState.current = { plan: planA, loading: true };
    const { rerender } = renderWithProviders(panelElement(executed));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));

    // ...and then they change what to spend while it waits.
    fireEvent.click(screen.getByTestId(ARBITRUM_ROW));

    // The fresh quote lands. Nothing starts: the consent was given for a selection that no longer
    // exists.
    planState.current = { plan: planB, loading: false };
    rerender(panelElement(executed));
    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "sources");
    expect(executed).toHaveLength(0);

    // Confirming again is what starts it.
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));
    await waitFor(() => {
      expect(executed).toEqual([planB]);
    });
  });
});
