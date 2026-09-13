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
 *
 * The last two cases cover the branch this gate shares with POO-1044's gas-only skip, which landed
 * on a separate branch: a gas-only requirement reaches its confirm with NO funding picker, so it is
 * the one real-mode route that never passes through `phase === "sources"`, and its `swap-gas` leg is
 * a CLASSIC swap that has to be gated like any other.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type {
  GasFeasibility,
  ProvisioningLeg,
  ProvisioningNeedInput,
  ProvisioningPlan,
  ProvisioningStep,
} from "@/lib/provisioning";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
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
  useRouter: () => ({ push: vi.fn() }),
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

/**
 * POO-1503: with the mock Confirm screen deleted, the seeded mock start runs ungated routes
 * directly, and a `>=10%` quote renders the funds-at-risk ALERT screen instead; its CTA carries the
 * `provisioning-confirm` testid the old Confirm's CTA carried. "Not gated" is therefore asserted as
 * "the run started, with no alert", which is the same rule one surface later.
 */
const impactCta = () => screen.getByTestId("provisioning-confirm");
const expectStartedUngated = async () => {
  await waitFor(() => {
    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending");
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
};
/**
 * POO-1509 [R4]: the gas-only branch's CTA. It is a different screen from the plan phase now (the
 * auxiliary `Not enough gas`), and the gate has to survive that move: a swap-gas leg reaches the same
 * AMMs as any other, so it is the one funding route that must not become the way around POO-1047.
 */
const gasTopUpCta = () => screen.getByTestId("gas-topup-confirm");

/* ---- the real-mode gas-only branch (POO-1044 [R1]), which skips the picker ---- */

const WETH_ARBITRUM = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";

/** A gas-only requirement on the operation's own chain: token in hand, native coin missing. */
const GAS_ONLY_INPUT: ProvisioningNeedInput = {
  balancesByChain: { [ARBITRUM]: { nativeUsd: 0.01, tokenUsd: 1_200 } },
  currentChainId: ARBITRUM,
  targetChainId: ARBITRUM,
  opRequiredUsdc: 0,
  gasEstimateUsd: 0.075,
};

function gasOnlyContext(): ProvisioningGateContext {
  const source: FundingSource = {
    address: WETH_ARBITRUM,
    symbol: "WETH",
    decimals: 18,
    amount: "400000000000000000",
    usd: 1_200,
    reachableChainIds: [ARBITRUM],
    isNative: false,
    logoUrl: "",
    chainId: ARBITRUM,
  };
  const gas: GasFeasibility = {
    chainId: ARBITRUM,
    verdict: "TOP_UP",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0.065,
    surplusUsd: 0,
    reasonKey: "provisioning.gasVerdict.topUp",
  };
  return {
    targetChainId: ARBITRUM,
    sources: [source],
    gasByChain: { [ARBITRUM]: gas },
    balancesByChain: { [ARBITRUM]: { nativeUsd: 0.01, tokenUsd: 1_200 } },
    gasEstimateUsd: 0.075,
  };
}

/**
 * The one-step plan the real planner returns for {@link GAS_ONLY_INPUT}: a slice of the wallet's
 * WETH swapped into the chain's native coin. `swap-gas` is a CLASSIC leg on the same AMMs as any
 * other, so the quote reports an impact for it and the cost model counts it.
 */
function gasOnlyPlanWithImpact(impactPct: number | undefined): ProvisioningPlan {
  const leg: ProvisioningLeg = {
    index: 0,
    kind: "swap-gas",
    chainId: ARBITRUM,
    tokenIn: weth(ARBITRUM, WETH_ARBITRUM),
    tokenOut: { address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", decimals: 18, chainId: ARBITRUM },
    amountIn: "32000000000000",
    amountOutQuoted: "32000000000000",
    minAmountOut: "31360000000000",
    routing: "CLASSIC",
    gasUsd: 0.02,
    ...(impactPct === undefined ? {} : { priceImpactPct: impactPct }),
    requoteAtExecution: false,
  };
  return {
    needed: true,
    reason: ["gas"],
    variant: "gas-only",
    steps: [
      {
        type: "swap-gas",
        key: "swap-gas-0",
        labelKey: "provisioning.steps.swapGas",
        fromToken: "WETH",
        toToken: "ETH",
        fromChainId: ARBITRUM,
        toChainId: ARBITRUM,
        chainId: ARBITRUM,
        amountUsd: 0.08,
        amountToken: "0.000032",
        method: "SEND_TX",
        leg,
      },
      { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 0 },
    ],
    quote: {
      shortfallUsd: 0,
      bufferUsd: 0.08,
      feesUsd: 0,
      totalPayUsd: 0.08,
      quotedAt: "2026-07-25T12:00:00.000Z",
      ttlMs: 600_000,
    },
    gas: { presetUsd: null, amountUsd: 0.08 },
    slippagePct: 2,
  };
}

function renderRealModePanel() {
  return renderWithProviders(
    <ProvisioningPanel
      input={GAS_ONLY_INPUT}
      context={gasOnlyContext()}
      opLabel="Collect fees"
      onDone={noop}
      onCancel={noop}
      buildPlanSteps={() => []}
    />,
  );
}

afterEach(() => {
  computePlan.mockReset();
});

describe("ProvisioningPanel — the price-impact gate (POO-1047)", () => {
  it("[R1] does not gate a route whose worst leg is under the threshold", async () => {
    computePlan.mockResolvedValue(planOf([swapStep(4.5)]));
    renderPanel();

    await expectStartedUngated();
  });

  it("[R1][R4] gates AT the threshold and blocks the start until the route is acknowledged", async () => {
    // Two AMM legs, one catastrophic: the user acknowledges the ROUTE, so there is exactly one
    // acknowledgement and it names the worst figure on it.
    computePlan.mockResolvedValue(planOf([swapStep(10), swapStep(2.5, "swap-1")]));
    renderPanel();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("10.00%");
    expect(impactCta()).toBeDisabled();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(impactCta()).toBeEnabled();
  });

  it("[R2] a re-quote that worsens past the margin clears the acknowledgement", async () => {
    computePlan.mockResolvedValueOnce(planOf([swapStep(12)]));
    // The second quote is the poisoned one. A changed requirement re-plans through the same seam the
    // TTL countdown re-quotes through, so this exercises the panel's real re-plan path.
    computePlan.mockResolvedValue(planOf([swapStep(92.41)]));
    const { rerender } = renderPanel();

    fireEvent.click(await screen.findByRole("checkbox"));
    expect(impactCta()).toBeEnabled();

    rerender(
      <ProvisioningPanel
        input={{ ...INPUT, opRequiredUsdc: 101 }}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("92.41%"));
    // The CTA's `disabled` is a plain value derived from `worsened` every render (never gated on an
    // effect having fired), so it is already correct on the SAME commit as the alert text above —
    // asserted synchronously on purpose, as the thing that actually stops a worse trade going through.
    expect(impactCta()).toBeDisabled();
    // The checkbox, by contrast, is COSMETIC: it un-checks from `usePriceImpactGate`'s own reset
    // effect, which fires on a LATER commit than the one that made the alert visible. Asserting it
    // synchronously right after the `waitFor` above raced that effect — an unrelated extra `useEffect`
    // anywhere earlier in this component's hook order was enough to flip it from "usually wins the
    // race" to "reliably loses it" (POO-1527 found this while adding one; unaffected by CTA safety,
    // since `blocked` never depended on this effect having run). Needs its own `waitFor`.
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
  });

  it("[R3] a route whose quote reported no impact is NOT gated", async () => {
    computePlan.mockResolvedValue(planOf([swapStep(undefined)]));
    renderPanel();

    await expectStartedUngated();
  });

  it("[R3] a malformed impact figure is NOT gated (never fail closed)", async () => {
    computePlan.mockResolvedValue(planOf([swapStep(Number.NaN)]));
    renderPanel();

    await expectStartedUngated();
  });

  it("[R5] a bridge-only plan is not gated by a figure Across never quoted", async () => {
    computePlan.mockResolvedValue(planOf([bridgeStep(92.41)]));
    renderPanel();

    await expectStartedUngated();
  });

  /**
   * The one branch where this gate and POO-1044's gas-only skip meet.
   *
   * POO-1044 [R1] sends a gas-only requirement STRAIGHT to the plan with no funding picker, which is
   * the only real-mode path that reaches the confirm without passing through `phase === "sources"`.
   * The two landed on separate branches, so this is the case neither one's own suite could cover: a
   * gas top-up is a CLASSIC swap on the same AMMs as any other leg, and if the picker skip had taken
   * the gate's "is the route on screen" flag with it, the one funding route that needs no
   * acknowledgement to reach its confirm would be a swap.
   */
  it("[R1] gates the gas-only real-mode plan, which reaches its CTA with no picker", async () => {
    computePlan.mockResolvedValue(gasOnlyPlanWithImpact(12));
    renderRealModePanel();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("12.00%");
    // The picker really was skipped: this is the auxiliary gas screen, reached directly.
    expect(screen.queryByRole("listbox", { name: /your funds/i })).not.toBeInTheDocument();
    expect(gasTopUpCta()).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(gasTopUpCta()).toBeEnabled();
  });

  it("[R3] leaves the gas-only real-mode plan ungated when its quote reported no impact", async () => {
    computePlan.mockResolvedValue(gasOnlyPlanWithImpact(undefined));
    renderRealModePanel();

    await waitFor(() => expect(gasTopUpCta()).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/**
 * POO-1525 [M3.3]: this file already owns the two mocks (`computePlan`, the gas-only real-mode
 * context) both scenarios need, so the pinned-footer wiring assertion lives here rather than
 * duplicating that setup in a file scoped to the sticky footer instead.
 */
describe("ProvisioningPanel — the terminal CTA stays pinned (POO-1525)", () => {
  it("[impact] pins the price-impact alert's Confirm", async () => {
    computePlan.mockResolvedValue(planOf([swapStep(10), swapStep(2.5, "swap-1")]));
    renderPanel();
    await screen.findByRole("alert");

    const footer = screen.getByTestId("provisioning-sticky-footer");
    expect(footer).toContainElement(impactCta());
  });

  it("[gas] pins GasTopUpBody's Confirm", async () => {
    computePlan.mockResolvedValue(gasOnlyPlanWithImpact(undefined));
    renderRealModePanel();
    await waitFor(() => expect(gasTopUpCta()).toBeEnabled());

    const footer = screen.getByTestId("provisioning-sticky-footer");
    expect(footer).toContainElement(gasTopUpCta());
  });
});
