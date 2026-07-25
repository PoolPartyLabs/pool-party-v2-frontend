/**
 * @id PP-CORE-CMP-046 (POO-1048)
 * @name ProvisioningPanel — funding funnel analytics tests
 * @implements-rules-version v8 (POO-1048 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The funnel wired to the surface that owns it. `provisioningFunnel.test.ts` proves the emitters obey
 * their rules; this proves the PANEL calls them at the right moments, which is where the equivalent
 * deposit instrumentation went wrong:
 *
 *   [R3] `funding_plan_completed` must not exist yet at the instant the user presses Confirm. That
 *        is exactly what `deposit_completed` does today (`DepositScreen.tsx:266`, fired synchronously
 *        inside `confirmFiat`), and it is why the deposit conversion rate counts intent as revenue.
 *   [R4] `funding_plan_failed` must actually fire when a leg fails, unlike the declared-and-never-
 *        emitted `deposit_failed`.
 *
 * Assertions read `window.dataLayer` rather than a mocked `track`, so what is asserted is what GTM
 * would really receive, sanitizer included.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
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
    await screen.findByRole("button", { name: "Confirm & continue" });

    const quoted = funnelEvents("funding_plan_quoted");
    expect(quoted).toHaveLength(1);
    expect(quoted[0]).toMatchObject({ route_shape: "cross-chain", leg_count: 1, currency: "USD" });
  });

  it("[R3] has not reported a completion at the instant the user confirms", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));

    // The click starts the route. Nothing has settled, so nothing may say it has.
    expect(funnelEvents("funding_plan_started")).toHaveLength(1);
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
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));
    await waitFor(() => expect(funnelEvents("funding_plan_failed")).toHaveLength(1));

    expect(funnelEvents("funding_plan_failed")[0]).toMatchObject({
      error_code: "USER_REJECTED",
      route_shape: "cross-chain",
      leg_kind: "bridge",
    });
    expect(funnelEvents("funding_plan_completed")).toHaveLength(0);
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
    await screen.findByRole("button", { name: "Confirm & continue" });
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
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(funnelEvents("funding_sources_selected")).toHaveLength(1));
    expect(funnelEvents("funding_sources_selected")[0]).toMatchObject({
      source_count: 1,
      value: 1_200,
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
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));
    await waitFor(() => expect(funnelEvents("funding_plan_completed")).toHaveLength(1));
    unmount();

    // The steps really do settle `0x…` hashes and the sources really do carry token addresses.
    // Neither may appear: nothing hex-shaped belongs in an analytics payload.
    expect(JSON.stringify(funnelEvents())).not.toMatch(/0x[a-fA-F0-9]+/);
  });
});
