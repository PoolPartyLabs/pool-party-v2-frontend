/**
 * @id PP-STR-CMP-022
 * @name ProvisioningPanel price-impact gate tests
 * @implements-rules-version v3 (POO-1047 rules v1) · v2 (POO-1011 rules v2)
 * @hackathon POO-1022 (Universal Funding)
 *
 * POO-1047: a funding route is a swap like any other. The gate that POO-1011 put in front of every
 * operation swap (after a poisoned thin-pool route turned $40 into $3) is applied to the plan the
 * user approves here, so a catastrophic route cannot enter through the funding path instead.
 *
 * Rules under test (POO-1047 rules v1):
 *   [R1] every provisioning swap leg is subject to the same >=10% acknowledgement gate
 *   [R2] the worsen-reset semantics are the shipped ones, unchanged
 *   [R3] a missing or malformed impact figure means NO gate: it must not fail closed
 *   [R4] the gate is PER-PLAN, not per-step: one acknowledgement for the route being approved
 *   [R5] bridge legs carry no AMM price impact and are EXCLUDED, not treated as 0% and passed
 *
 * Kept apart from `ProvisioningPanel.test.tsx` deliberately: these cases need the plan seam stubbed
 * with hand-built REAL plans (a mock-mode fixture plan carries no legs, so it can never gate), and a
 * module mock is file-scoped.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProvisioningLeg,
  ProvisioningNeedInput,
  ProvisioningPlan,
  ProvisioningStep,
} from "@/lib/provisioning";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ProvisioningPanel } from "./ProvisioningPanel";

// The cost breakdown's buy-crypto peer is a locale-aware Link; the repository convention is to stub
// it, because next-intl's navigation factory reaches for `next/navigation` at import time.
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

// The ONE plan seam (POO-1023). Stubbed so each case can hand the panel a real, leg-bearing plan.
const computePlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/provisioning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provisioning")>()),
  computePlan,
}));

const ARBITRUM = 42161;
const POLYGON = 137;
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";

const usdc = (chainId: number, address: string) => ({
  address,
  symbol: "USDC",
  decimals: 6,
  chainId,
});
const weth = (chainId: number, address: string) => ({
  address,
  symbol: "WETH",
  decimals: 18,
  chainId,
});

const INPUT: ProvisioningNeedInput = {
  nativeBalanceUsd: 5,
  usdcBalanceUsd: 0,
  currentChainId: POLYGON,
  targetChainId: ARBITRUM,
  opRequiredUsdc: 100,
  gasEstimateUsd: 0.5,
};

/** One AMM leg: WETH on Polygon buys USDC on Polygon. `impactPct` is the quote's own figure. */
function swapStep(impactPct: number | undefined, key = "swap-0"): ProvisioningStep {
  const leg: ProvisioningLeg = {
    index: 0,
    kind: "swap-token",
    chainId: POLYGON,
    tokenIn: weth(POLYGON, WETH_POLYGON),
    tokenOut: usdc(POLYGON, USDC_POLYGON),
    amountIn: "40000000000000000",
    amountOutQuoted: "100000000",
    minAmountOut: "98000000",
    routing: "CLASSIC",
    gasUsd: 0.02,
    ...(impactPct === undefined ? {} : { priceImpactPct: impactPct }),
    requoteAtExecution: false,
  };
  return {
    type: "swap-token",
    key,
    labelKey: "provisioning.steps.swapToken",
    fromToken: "WETH",
    toToken: "USDC",
    fromChainId: POLYGON,
    toChainId: POLYGON,
    chainId: POLYGON,
    amountUsd: 100.4,
    method: "SEND_TX",
    leg,
  };
}

/**
 * One bridge leg, carrying an impact figure it has no business carrying.
 *
 * Across quotes a bridge and `quote.priceImpact` is an AMM figure, so this is the shape [R5] is
 * about: the planner copies whatever the quote reports onto the leg, and a stray figure here must
 * not be able to gate (nor, treated as 0%, to mask one).
 */
function bridgeStep(impactPct: number | undefined, key = "bridge-0"): ProvisioningStep {
  const leg: ProvisioningLeg = {
    index: 1,
    kind: "bridge",
    chainId: POLYGON,
    tokenIn: usdc(POLYGON, USDC_POLYGON),
    tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
    amountIn: "100000000",
    amountOutQuoted: "99900000",
    minAmountOut: "99900000",
    routing: "BRIDGE",
    gasUsd: 0.03,
    ...(impactPct === undefined ? {} : { priceImpactPct: impactPct }),
    requoteAtExecution: true,
  };
  return {
    type: "bridge",
    key,
    labelKey: "provisioning.steps.bridge",
    fromToken: "USDC",
    toToken: "USDC",
    fromChainId: POLYGON,
    toChainId: ARBITRUM,
    chainId: POLYGON,
    amountUsd: 100,
    method: "SEND_TX",
    leg,
  };
}

const opStep: ProvisioningStep = {
  type: "op",
  key: "op",
  labelKey: "provisioning.steps.op",
  amountUsd: 100,
};

/** A real-shaped plan over the given legs. Its quote figures are irrelevant to the gate. */
function planOf(steps: ProvisioningStep[]): ProvisioningPlan {
  return {
    needed: true,
    reason: ["usdc"],
    variant: "multi",
    steps: [...steps, opStep],
    quote: {
      shortfallUsd: 100,
      bufferUsd: 2,
      feesUsd: 0.1,
      totalPayUsd: 102.1,
      quotedAt: "2026-07-25T12:00:00.000Z",
      // Long enough that no countdown fires mid-test: the re-quote below is driven explicitly.
      ttlMs: 600_000,
    },
    slippagePct: 2,
  };
}

function noop() {}

function renderPanel(input: ProvisioningNeedInput = INPUT) {
  return renderWithProviders(
    <ProvisioningPanel
      input={input}
      opLabel="Invest in Stable Yield"
      onDone={noop}
      onCancel={noop}
    />,
  );
}

const confirmCta = () => screen.getByRole("button", { name: "Confirm & continue" });

afterEach(() => {
  computePlan.mockReset();
});

describe("ProvisioningPanel — the price-impact gate (POO-1047)", () => {
  it("[R1] does not gate a route whose worst leg is under the threshold", async () => {
    computePlan.mockResolvedValue(planOf([swapStep(4.5)]));
    renderPanel();

    await waitFor(() => expect(confirmCta()).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[R1][R4] gates AT the threshold and blocks the confirm until the route is acknowledged", async () => {
    // Two AMM legs, one catastrophic: the user acknowledges the ROUTE, so there is exactly one
    // acknowledgement and it names the worst figure on it.
    computePlan.mockResolvedValue(planOf([swapStep(10), swapStep(2.5, "swap-1")]));
    renderPanel();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("10.00%");
    expect(confirmCta()).toBeDisabled();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirmCta()).toBeEnabled();
  });

  it("[R2] a re-quote that worsens past the margin clears the acknowledgement", async () => {
    computePlan.mockResolvedValueOnce(planOf([swapStep(12)]));
    // The second quote is the poisoned one. A changed requirement re-plans through the same seam the
    // TTL countdown re-quotes through, so this exercises the panel's real re-plan path.
    computePlan.mockResolvedValue(planOf([swapStep(92.41)]));
    const { rerender } = renderPanel();

    fireEvent.click(await screen.findByRole("checkbox"));
    expect(confirmCta()).toBeEnabled();

    rerender(
      <ProvisioningPanel
        input={{ ...INPUT, opRequiredUsdc: 101 }}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("92.41%"));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(confirmCta()).toBeDisabled();
  });

  it("[R3] a route whose quote reported no impact is NOT gated", async () => {
    computePlan.mockResolvedValue(planOf([swapStep(undefined)]));
    renderPanel();

    await waitFor(() => expect(confirmCta()).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[R3] a malformed impact figure is NOT gated (never fail closed)", async () => {
    computePlan.mockResolvedValue(planOf([swapStep(Number.NaN)]));
    renderPanel();

    await waitFor(() => expect(confirmCta()).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[R5] a bridge-only plan is not gated by a figure Across never quoted", async () => {
    computePlan.mockResolvedValue(planOf([bridgeStep(92.41)]));
    renderPanel();

    await waitFor(() => expect(confirmCta()).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
