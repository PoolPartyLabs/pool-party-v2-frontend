/**
 * @id PP-CORE-CMP-046 (POO-1048, POO-1541)
 * @name ProvisioningPanel — funding funnel analytics tests
 * @implements-rules-version v27 (POO-1541 rules v1) · v8 (POO-1048 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The funnel wired to the surface that owns it. `provisioningFunnel.test.ts` proves the emitters obey
 * their rules; this proves the PANEL calls them at the right moments, which is where the equivalent
 * deposit instrumentation went wrong:
 *
 *   [R3] `funding_plan_completed` must not exist yet at the instant the run STARTS (step 2's CTA in
 *        real mode; the seeded mock start since POO-1503 deleted the mock Confirm). Firing it there
 *        is exactly what `deposit_completed` does today (`DepositScreen.tsx:266`, fired synchronously
 *        inside `confirmFiat`), and it is why the deposit conversion rate counts intent as revenue.
 *   [R4] `funding_plan_failed` must actually fire when a leg fails, unlike the declared-and-never-
 *        emitted `deposit_failed`.
 *
 * Assertions read `window.dataLayer` rather than a mocked `track`, so what is asserted is what GTM
 * would really receive, sanitizer included.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import type { GasFeasibility } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { TransactionError } from "@/lib/tx/sendTransaction";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ProvisioningPanel } from "./ProvisioningPanel";

// The cost breakdown's buy-crypto peer option renders the locale-aware Link, whose factory reaches
// for app-router navigation at import time. Stubbed as in every sibling suite.
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

const POLYGON = 137;
const ARBITRUM = 42161;

function noop() {}

interface StubPlan {
  steps: { type: string; key: string }[];
}

/** Steps that settle immediately, so the flow reaches success without the 900 ms mock delay. */
const immediateSteps = (plan: StubPlan) =>
  plan.steps
    .filter((step) => step.type !== "op")
    .map((step) => ({ key: step.key, run: async () => ({ txHash: `0x${step.key}` }) }));

/** A leg that fails terminally, the way a rejected signature or a reverted swap does. */
const failingSteps = (plan: StubPlan) =>
  plan.steps
    .filter((step) => step.type !== "op")
    .map((step) => ({
      key: step.key,
      run: async (): Promise<{ txHash: string }> => {
        throw new TransactionError("User rejected the request", { code: "USER_REJECTED" });
      },
    }));

function fundingSource(over: Partial<FundingSource> = {}): FundingSource {
  return {
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    chainId: POLYGON,
    symbol: "WETH",
    decimals: 18,
    amount: "400000000000000000",
    usd: 1_200,
    reachableChainIds: [POLYGON, ARBITRUM],
    isNative: false,
    logoUrl: "",
    ...over,
  } as FundingSource;
}

function verdict(chainId: number): GasFeasibility {
  return {
    chainId,
    verdict: "OK",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0,
    surplusUsd: 1,
    reasonKey: "provisioning.gasVerdict.ok",
  };
}

function liveContext(): ProvisioningGateContext {
  return {
    targetChainId: ARBITRUM,
    sources: [fundingSource()],
    gasByChain: { [POLYGON]: verdict(POLYGON), [ARBITRUM]: verdict(ARBITRUM) },
    balancesByChain: {
      [POLYGON]: { nativeUsd: 5, tokenUsd: 1_200 },
      [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
    },
    gasEstimateUsd: 0.075,
  };
}

function funnelEvents(name?: string): Record<string, unknown>[] {
  const all = (window.dataLayer ?? []) as Record<string, unknown>[];
  return all.filter((entry) =>
    name ? entry.event === name : String(entry.event).startsWith("funding_"),
  );
}

beforeEach(() => {
  window.dataLayer = [];
});

/**
 * POO-1504 [R27]: the run no longer hands the operation back on its own. The bottom button IS the
 * state, so `Done` becomes enabled once every leg has settled and pressing it is what resumes the
 * original operation. The completion EVENT is unmoved: it still fires on settlement (premise 11), and
 * only the handoff waits for this press.
 */
async function pressDone(): Promise<void> {
  const done = await screen.findByTestId("provisioning-exec-state", undefined, { timeout: 3000 });
  await waitFor(() => expect(done).toBeEnabled(), { timeout: 3000 });
  fireEvent.click(done);
}

describe("ProvisioningPanel — funding funnel (POO-1048)", () => {
  it("[R1]/[R2] reports the quoted route with its shape, length and price", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );
    // POO-1503: no Confirm screen to wait on; the quote event itself marks the plan landing.
    await waitFor(() => expect(funnelEvents("funding_plan_quoted")).toHaveLength(1));

    const quoted = funnelEvents("funding_plan_quoted");
    expect(quoted[0]).toMatchObject({ route_shape: "cross-chain", leg_count: 1, currency: "USD" });
  });

  it("[R3] has not reported a completion at the instant the run starts", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        // A leg that never settles, so the started instant can be inspected without racing the
        // immediate-settle completion.
        buildPlanSteps={() => [{ key: "hang", run: () => new Promise<never>(() => {}) }]}
      />,
    );
    // POO-1503: mock mode's seeded start is the same instant the Confirm click used to be.
    await waitFor(() => expect(funnelEvents("funding_plan_started")).toHaveLength(1));

    // The route started. Nothing has settled, so nothing may say it has.
    expect(funnelEvents("funding_plan_completed")).toHaveLength(0);
    expect(funnelEvents("funding_leg_settled")).toHaveLength(0);
  });

  it("[R1]/[R3] reports each leg as it settles, then exactly one completion", async () => {
    const onDone = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
        onDone={onDone}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );
    // POO-1503: the seeded mock start runs the route; settlement is what the test observes.
    // POO-1504 [R27]: `onDone` waits for the state button's press, so the press is part of the walk.
    await pressDone();
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    // Every executable step reports, in execution order. The `op` anchor is a label for the
    // operation the route funds, settles nothing, and must not appear.
    expect(funnelEvents("funding_leg_settled").map((entry) => entry.leg_kind)).toEqual([
      "buy-usdc",
      "bridge",
      "swap-gas",
    ]);
    expect(funnelEvents("funding_plan_completed")).toHaveLength(1);
    expect(funnelEvents("funding_plan_abandoned")).toHaveLength(0);
  });

  it("[R4] reports a terminal failure with its typed code, and no completion", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={failingSteps}
      />,
    );
    // POO-1503: the seeded mock start reaches the failing leg on its own.
    await waitFor(() => expect(funnelEvents("funding_plan_failed")).toHaveLength(1));

    expect(funnelEvents("funding_plan_failed")[0]).toMatchObject({
      error_code: "USER_REJECTED",
      route_shape: "cross-chain",
      leg_kind: "bridge",
    });
    expect(funnelEvents("funding_plan_completed")).toHaveLength(0);
  });

  it("[POO-1508 R43 rules v2] reports a buffer-exceeded refusal on the failed series, without concluding the run", async () => {
    // The buffer trip is NOT terminal (the run waits behind Try again / Cancel), but it is a refusal
    // to move the user's money, and the old per-leg decline it replaced reported on this exact
    // series (`PROVISIONING_REQUOTE_REJECTED`). Without this row, how often the 5% cap trips in
    // production is unmeasurable.
    const { unmount } = renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={(plan) =>
          plan.steps
            .filter((step) => step.type !== "op")
            .map((step) => ({
              key: step.key,
              run: async (): Promise<{ txHash: string }> => {
                throw new TransactionError("nothing was sent and your money did not move", {
                  code: "PROVISIONING_BUFFER_EXCEEDED",
                });
              },
            }))
        }
      />,
    );
    await waitFor(() => expect(funnelEvents("funding_plan_failed")).toHaveLength(1));

    expect(funnelEvents("funding_plan_failed")[0]).toMatchObject({
      error_code: "PROVISIONING_BUFFER_EXCEEDED",
      route_shape: "cross-chain",
    });
    // The run is waiting on the prompt's decision, not concluded: no completion, and the session
    // must not ALSO report the same exit as a bare `pending` abandonment on the way out.
    expect(funnelEvents("funding_plan_completed")).toHaveLength(0);
    unmount();
    expect(funnelEvents("funding_plan_abandoned")).toHaveLength(0);
  });

  it("[R4] reports where a session was left when it concluded neither way", async () => {
    const { unmount } = renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );
    // POO-1503: leave BEFORE the fixture plan has resolved, i.e. before the seeded start has
    // anything to run. The exit label stays `plan` deliberately: relabelling the mock pre-start
    // moment would move a live series for no behaviour change.
    unmount();

    expect(funnelEvents("funding_plan_abandoned")[0]).toMatchObject({ funding_exit: "plan" });
  });

  it("[R1] reports the funding sources the user is offered, then the ones they commit to", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={liveContext()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );

    expect(funnelEvents("funding_sources_listed")[0]).toMatchObject({
      source_count: 1,
      value: 1_200,
      currency: "USD",
    });

    fireEvent.click(screen.getByRole("option"));
    fireEvent.click(screen.getByRole("button", { name: /confirm and start/i }));

    await waitFor(() => expect(funnelEvents("funding_sources_selected")).toHaveLength(1));
    expect(funnelEvents("funding_sources_selected")[0]).toMatchObject({
      source_count: 1,
      value: 1_200,
    });
  });

  it("[POO-1145] counts a reachable-but-gas-BLOCKED holding, pinning today's reachability rule", () => {
    // The panel's list is `reachableSources` (reachability only), DELIBERATELY looser than the
    // exported `spendableSources` (fundingSelection.ts:119), which also drops gas-BLOCKED chains. A
    // wallet whose only holding sits on a chain it cannot pay gas on is still counted here, because
    // that is what today's LIVE `funding_sources_listed` series has always measured. Reconciling the
    // emitter to spendability would turn this 1 into 0; this locks the number so that change can only
    // ever be a deliberate one (POO-1145, see docs/ANALYTICS_EVENTS.md). The gated reads that sum
    // money sum over SELECTED keys only, and a BLOCKED row cannot be selected, so they are unaffected.
    const context: ProvisioningGateContext = {
      ...liveContext(),
      gasByChain: {
        [POLYGON]: { ...verdict(POLYGON), verdict: "BLOCKED" },
        [ARBITRUM]: verdict(ARBITRUM),
      },
    };
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );

    expect(funnelEvents("funding_sources_listed")[0]).toMatchObject({
      source_count: 1,
      value: 1_200,
      currency: "USD",
    });
  });

  it("[R2] puts no address and no transaction hash in any funnel payload", async () => {
    const { unmount } = renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridgeGas}
        context={liveContext()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );
    fireEvent.click(screen.getByRole("option"));
    // @rule POO-1503 R19 — one press, not two. Step 2's CTA signs, so the Confirm screen it used to
    // open is gone and the run starts from here.
    fireEvent.click(screen.getByRole("button", { name: /confirm and start/i }));
    await waitFor(() => expect(funnelEvents("funding_plan_completed")).toHaveLength(1));
    unmount();

    // The steps really do settle `0x…` hashes and the sources really do carry token addresses.
    // Neither may appear: nothing hex-shaped belongs in an analytics payload.
    expect(JSON.stringify(funnelEvents())).not.toMatch(/0x[a-fA-F0-9]+/);
  });
});

/**
 * POO-1541: the wiring assertion the issue's step 4 asks for. `provisioningFunnel.test.ts` proves the
 * emitters' payload shapes; this proves the PANEL actually calls them from screen 1, which is where the
 * gap lived: `FundingRoutePicker` used to call `useAnalytics()` itself, and reading `window.dataLayer`
 * here is what would have caught it, the same way the rest of this file catches the funnel's own
 * defects. `context` is under-funded on purpose (a $50 wallet against a $205 requirement, on-ramp on),
 * so `shouldPickRoute` sees a genuine choice and step 1 leads.
 */
describe("ProvisioningPanel — screen 1's route events join the shared funnel (POO-1541)", () => {
  const context: ProvisioningGateContext = {
    targetChainId: ARBITRUM,
    sources: [fundingSource({ usd: 50 })],
    gasByChain: { [POLYGON]: verdict(POLYGON), [ARBITRUM]: verdict(ARBITRUM) },
    balancesByChain: {
      [POLYGON]: { nativeUsd: 5, tokenUsd: 50 },
      [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
    },
    gasEstimateUsd: 0.075,
  };
  const partialInput = {
    currentChainId: ARBITRUM,
    targetChainId: ARBITRUM,
    opRequiredUsdc: 200,
    gasEstimateUsd: 0.075,
  };

  // The flag is read through `useFeatureFlags`, whose client snapshot is memoised for the module's
  // lifetime, same caveat as `ProvisioningPanel.onRamp.test.tsx`'s `renderRoutes`.
  beforeEach(() => __resetDevOverridesForTests());
  afterEach(() => {
    __resetDevOverridesForTests();
    vi.unstubAllEnvs();
  });

  async function renderRoutes(contextOverride: ProvisioningGateContext = context) {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
    renderWithProviders(
      <ProvisioningPanel
        input={partialInput}
        context={contextOverride}
        operation={{ kind: "invest" }}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );
    expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute("data-phase", "routes");
  }

  it("reports the view once, carrying the shared flow/chain_id params", async () => {
    await renderRoutes();

    await waitFor(() => expect(funnelEvents("funding_route_viewed")).toHaveLength(1));
    expect(funnelEvents("funding_route_viewed")[0]).toMatchObject({
      flow: "invest",
      chain_id: ARBITRUM,
    });
  });

  // POO-1541: per ENTRY to screen 1, never per panel session. The [R20] back chevron (and the buy
  // route's impact-gate ghost) return to screen 1 mid-session; each return used to be a fresh
  // per-mount `funding_route_viewed`, and swallowing it would let chosen/viewed and abandoned/viewed
  // exceed 1, which reads as a broken funnel. A single visit still reports exactly once.
  it("reports a fresh view when the [R20] back returns to screen 1, and exactly one per entry", async () => {
    await renderRoutes();
    await waitFor(() => expect(funnelEvents("funding_route_viewed")).toHaveLength(1));

    // Choose the token route: screen 1 yields to step 2 (sources), which renders the [R20] back.
    fireEvent.click(await screen.findByRole("button", { name: /Use \$50\.00 \+ buy/ }));
    expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute(
      "data-phase",
      "sources",
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute("data-phase", "routes");

    // Exactly two: the re-entry emitted again, and the re-renders inside each entry did not.
    await waitFor(() => expect(funnelEvents("funding_route_viewed")).toHaveLength(2));
    expect(funnelEvents("funding_route_viewed")[1]).toMatchObject({
      flow: "invest",
      chain_id: ARBITRUM,
    });
  });

  // Restored from the deleted `FundingRoutePicker.analytics.test.tsx`. @rule R6 (POO-1501) —
  // `"none"` is a real value, not a gap: the `1d` empty wallet renders one card (`buy`) plus the
  // deposit ghost, which is not a card, so the screen deliberately carries no `Recommended` chip.
  it("reports no recommendation when a single card is on screen", async () => {
    await renderRoutes({
      ...context,
      sources: [],
      balancesByChain: {
        [POLYGON]: { nativeUsd: 0, tokenUsd: 0 },
        [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
      },
    });

    await waitFor(() => expect(funnelEvents("funding_route_viewed")).toHaveLength(1));
    expect(funnelEvents("funding_route_viewed")[0]).toMatchObject({
      funding_route_count: 1,
      funding_route_recommended: "none",
    });
  });

  it("reports the chosen route when a card is tapped, carrying the shared params", async () => {
    await renderRoutes();

    const buyRow = await screen.findByRole("button", { name: /^Buy \$/ });
    fireEvent.click(buyRow);

    expect(funnelEvents("funding_route_chosen")).toHaveLength(1);
    expect(funnelEvents("funding_route_chosen")[0]).toMatchObject({
      flow: "invest",
      chain_id: ARBITRUM,
      funding_route: "buy",
    });
  });

  // Restored from the deleted `FundingRoutePicker.analytics.test.tsx`. @rule R7 (POO-1501) — the
  // ghost link is still a route the user took, so it reports as one, and it can never be the
  // recommended one. This is the one choice that fires and then leaves the panel entirely
  // (`router.push` to the deposit surface), so without this case that branch has no coverage.
  it("reports the deposit ghost link as a chosen route that never follows the recommendation", async () => {
    await renderRoutes();

    fireEvent.click(await screen.findByRole("button", { name: /deposit from external wallet/i }));

    expect(funnelEvents("funding_route_chosen")).toHaveLength(1);
    expect(funnelEvents("funding_route_chosen")[0]).toMatchObject({
      flow: "invest",
      chain_id: ARBITRUM,
      funding_route: "deposit",
      funding_route_recommended: "buy",
      funding_route_followed_recommendation: false,
    });
  });

  it("reports the abandonment when the user cancels, carrying the shared params", async () => {
    await renderRoutes();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(funnelEvents("funding_route_abandoned")).toHaveLength(1);
    expect(funnelEvents("funding_route_abandoned")[0]).toMatchObject({
      flow: "invest",
      chain_id: ARBITRUM,
    });
  });
});
