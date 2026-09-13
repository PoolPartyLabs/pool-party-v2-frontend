/**
 * @id PP-CORE-CMP-046 (POO-1044, POO-1085)
 * @name ProvisioningPanel — gas top-up surface tests
 * @implements-rules-version v7 (POO-1085 rules v1) · v6 (POO-1044 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The panel's half of the gas top-up.
 *
 * Rules under test (POO-1044 rules v1):
 *   [R1] a gas-only shortfall goes straight to the one-step plan; there is nothing to pick, because
 *        the gas SOURCE is the classifier's, not the user's
 *   [R3] a BLOCKED operation chain is never rendered as a runnable plan: the panel says what is
 *        wrong, in the user's language, and offers the buy-crypto escape instead of a retry that
 *        cannot change the verdict
 *
 * POO-1085 rules v1 REVERSES [R6] of the above, which held that the inline gas selector must be
 * absent in real mode because the amount it set was not the amount that executed. The v2 design
 * (POO-1082 D2) restores the control, and the contradiction is resolved by changing what it means:
 *   [F2-R5] the selector renders wherever a gas step exists, in BOTH modes, because it no longer
 *        SIZES the top-up. The plan takes `max(classifier, choice)`, so a larger ask is honoured and
 *        a smaller one is ignored rather than turned into a leg that reverts.
 *   [R6 of POO-1082] the presets and the floor follow the funding SOURCE: $5/$10 swapping a holding
 *        the wallet already has, $10/$25 buying with a card, where the $10 is the Paybis fiat floor.
 * [R1] is untouched: which HOLDING the gas comes out of is still never the user's choice.
 *
 * The multi-source picker is asserted to still open for a funding shortfall, so this change cannot
 * quietly bypass POO-1042's whole flow.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type {
  GasFeasibility,
  ProvisioningLeg,
  ProvisioningNeedInput,
  ProvisioningPlan,
} from "@/lib/provisioning";
import { NATIVE_TOKEN_ADDRESS, SCENARIOS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { TransactionError } from "@/lib/tx/sendTransaction";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { ProvisioningPanel } from "./ProvisioningPanel";

// The locale-aware Link resolves Next's app-router navigation, which does not exist under jsdom.
// Same stand-in the cost-breakdown suite uses; the assertion is on the href, which survives it.
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

const { planHolder, errorHolder, enabledHolder, loadingHolder, gasHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
  errorHolder: { current: null as Error | null },
  /** Whether the panel asked for a plan at all: `enabled: false` means it is still picking. */
  enabledHolder: { current: null as boolean | null },
  /** Simulates a re-quote in flight: the previous plan stays mounted while `loading` is true. */
  loadingHolder: { current: false },
  /** The gas choice the panel handed the planner, i.e. what the next quote is sized with. */
  gasHolder: { current: undefined as unknown },
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: (
    _input: unknown,
    gas: unknown,
    options: { selection?: readonly string[]; enabled?: boolean } = {},
  ) => {
    enabledHolder.current = options.enabled ?? true;
    gasHolder.current = gas;
    return {
      plan: errorHolder.current ? null : planHolder.current,
      loading: loadingHolder.current,
      error: errorHolder.current,
    };
  },
}));

function noop() {}

function fundingSource(
  over: Partial<FundingSource> & Pick<FundingSource, "chainId">,
): FundingSource {
  return {
    address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    symbol: "WETH",
    decimals: 18,
    amount: "400000000000000000",
    usd: 1_200,
    reachableChainIds: [POLYGON, ARBITRUM],
    isNative: false,
    logoUrl: "",
    ...over,
  };
}

function verdict(chainId: number, over: Partial<GasFeasibility> = {}): GasFeasibility {
  return {
    chainId,
    verdict: "OK",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0,
    surplusUsd: 1,
    reasonKey: "provisioning.gasVerdict.ok",
    ...over,
  };
}

function context(over: Partial<ProvisioningGateContext> = {}): ProvisioningGateContext {
  return {
    targetChainId: ARBITRUM,
    sources: [fundingSource({ chainId: ARBITRUM })],
    gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
    balancesByChain: { [ARBITRUM]: { nativeUsd: 0.01, tokenUsd: 1_200 } },
    gasEstimateUsd: 0.075,
    ...over,
  };
}

/**
 * A gas-only requirement on the operation's own chain: the wallet holds plenty of token there and
 * needs no USDC, so the ONLY thing missing is the native coin.
 */
const GAS_ONLY_INPUT: ProvisioningNeedInput = {
  balancesByChain: { [ARBITRUM]: { nativeUsd: 0.01, tokenUsd: 1_200 } },
  currentChainId: ARBITRUM,
  targetChainId: ARBITRUM,
  opRequiredUsdc: 0,
  gasEstimateUsd: 0.075,
};

/**
 * The one-step plan the real planner returns for {@link GAS_ONLY_INPUT}: a slice of the wallet's
 * WETH swapped into the chain's native coin, then the operation.
 *
 * Shaped exactly as `buildPlan` assembles it, leg and all, because the panel's gas branch reads
 * `step.type` and the plan card reads the leg. The native coin is the ZERO address, never WETH.
 */
function gasOnlyPlan(): ProvisioningPlan {
  const leg: ProvisioningLeg = {
    index: 0,
    kind: "swap-gas",
    chainId: ARBITRUM,
    tokenIn: {
      address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      symbol: "WETH",
      decimals: 18,
      chainId: ARBITRUM,
    },
    tokenOut: { address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", decimals: 18, chainId: ARBITRUM },
    amountIn: "32000000000000",
    amountOutQuoted: "32000000000000",
    minAmountOut: "31360000000000",
    routing: "CLASSIC",
    gasUsd: 0.02,
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
      ttlMs: 30_000,
    },
    gas: { presetUsd: null, amountUsd: 0.08 },
    slippagePct: 2,
  };
}

beforeEach(() => {
  planHolder.current = gasOnlyPlan();
  errorHolder.current = null;
  enabledHolder.current = null;
  loadingHolder.current = false;
  gasHolder.current = undefined;
});

describe("ProvisioningPanel — gas top-up (POO-1044, POO-1509)", () => {
  // @rule POO-1509 R4 — OVERTURNS the SCREEN half of POO-1044 [R1], not its reasoning. There is
  // still nothing to pick (the classifier chooses the holding), but the branch no longer renders a
  // plan card titled "One step": `Not enough gas` is auxiliary, so it is its own screen with its own
  // subject. The assertion on the absent picker is kept verbatim, because that rule is untouched.
  it("[R4] opens the auxiliary Not enough gas screen when only gas is missing", () => {
    planHolder.current = gasOnlyPlan();

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    // No picker: the gas source is chosen by the classifier from what the chain already holds, so
    // there is nothing for the user to select and a picker would be a decision that does not exist.
    expect(screen.queryByRole("listbox", { name: /your funds/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /not enough gas/i })).toBeInTheDocument();
    expect(screen.queryByText(/one step/i)).not.toBeInTheDocument();
    expect(enabledHolder.current).toBe(true);
  });

  // @rule POO-1509 R35 — the presets survive POO-1085 [F2-R5] and POO-1082 [R6] unchanged; what
  // changed is that this is the ONLY screen that carries them. This wallet holds $1,200 of routable
  // token on the operation's chain, so the gas is swapped out of it: $5 / $10, floor $5. The $10 /
  // $25 pair is the PAYBIS FIAT minimum and does not apply to a swap.
  it("[R35] offers the on-chain presets when there is something to convert", () => {
    planHolder.current = gasOnlyPlan();

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByRole("group", { name: /gas amount/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$5.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$25.00" })).not.toBeInTheDocument();
  });

  // @rule POO-1509 R36 — the screen says where the money comes from. It is the whole disclosure of
  // how a top-up is paid for, and the reason no card is mentioned anywhere on it.
  it("[R36] says the top-up converts a holding and involves no card", () => {
    planHolder.current = gasOnlyPlan();

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByText(/convert a small part of what you already hold/i)).toBeInTheDocument();
  });

  // @rule POO-1082 R6 — nothing to convert means the gas has to be BOUGHT, and the fiat floor is
  // real: $10 / $25.
  it("[R35] falls back to the fiat presets when there is nothing to convert", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={{ ...SCENARIOS.gasOnly, usdcBalanceUsd: 0 }}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$25.00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$5.00" })).not.toBeInTheDocument();
  });

  // @rule POO-1509 R4 — mock mode reaches the auxiliary screen too. The `gasOnly` branch used to
  // require a live context, which was harmless while both modes rendered the same plan card and is
  // not any more: it would make the preview the design is reviewed on the one place this screen never
  // appears.
  it("[R4] reaches the auxiliary screen in mock mode, with the on-chain presets", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.gasOnly}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByRole("heading", { name: /not enough gas/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /gas amount/i })).toBeInTheDocument();
    // This wallet holds $1,000 of USDC, so the gas comes out of it.
    expect(screen.getByRole("button", { name: "$5.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
  });

  // @rule POO-1509 R4 — "it returns the user to wherever they were". The dismiss is the auxiliary
  // screen's exit, and it is the host's `onCancel`, which is what hands the operation modal back its
  // own confirm view.
  it("[R4] returns the user to the operation they came from", async () => {
    const onCancel = vi.fn();
    planHolder.current = gasOnlyPlan();

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={onCancel}
        buildPlanSteps={() => []}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /not now/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // @rule M5.2 (POO-1526) — its own full-width row; the explicit 44pt is a min-height, not a
  // bigger font.
  it("[M5.2] Not now carries an explicit 44pt touch target", () => {
    planHolder.current = gasOnlyPlan();

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByRole("button", { name: /not now/i })).toHaveClass("min-h-11");
  });

  /**
   * @rule POO-1526 [M5.1] / POO-1528 — this gear was deferred to POO-1528 on the assumption the
   * shared `TransactionModalHeader` would replace it. It does not: the header's gear is scoped to
   * the `sources` step and this screen is auxiliary (it is not in the flow), so the gear stays here
   * and takes the house invisible hit area instead, 24px + 2x10px = the 44pt floor.
   */
  it("[M5.1] the auxiliary screen's gear carries a 44pt hit area", () => {
    planHolder.current = gasOnlyPlan();

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
        onOpenSettings={noop}
      />,
    );

    expect(screen.getByRole("button", { name: "Transaction settings" })).toHaveClass(
      "after:-inset-2.5",
    );
  });

  // @rule POO-1509 R4 — auxiliary does not mean ungated. A swap-gas leg reaches the same AMMs as any
  // other, so the POO-1047 price-impact gate has to survive the move off the plan phase; it was
  // mounted there and nowhere else. This is the assertion that would have caught losing it.
  it("[R4] keeps the price-impact gate on the auxiliary screen", () => {
    const plan = gasOnlyPlan();
    const [gasStep] = plan.steps;
    if (!gasStep?.leg) throw new Error("fixture has no gas leg");
    // The quote's own figure on the swap-gas leg, above the POO-1011 acknowledgement threshold. It
    // reaches `planPriceImpactPct` through the cost model's worst-AMM-leg aggregate.
    gasStep.leg = { ...gasStep.leg, priceImpactPct: 12.5 };
    planHolder.current = plan;

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.getByTestId("gas-topup-confirm")).toBeDisabled();
  });

  // @rule POO-1509 R4: the CTA states what will actually happen (review of #833). Only an explicit
  // VALID choice resizes the plan (`effectiveGas`), so the untouched $10 default preset is display
  // seeding while the rail runs the plan's sized swap-gas leg, here the classifier's $0.08. Printing
  // the preset made the consent surface name an amount 125x the one about to execute.
  it("[R4] prints the plan's executed gas figure on the CTA, not the default preset", () => {
    planHolder.current = gasOnlyPlan();

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    // Untouched default: no explicit choice was made, so nothing was passed to the planner and the
    // executed leg is the classifier-sized $0.08, which is what the CTA must say.
    expect(gasHolder.current).toBeUndefined();
    expect(screen.getByTestId("gas-topup-confirm")).toHaveTextContent("Add $0.08 gas");
    expect(screen.queryByRole("button", { name: /add \$10\.00 gas/i })).not.toBeInTheDocument();
  });

  // @rule POO-1509 R4: an explicit choice above the classifier figure IS honoured by the plan
  // (`raiseTopUpToUsd` raises the slice), so once the re-quote lands the CTA follows it: the choice
  // is then what executes.
  it("[R4] follows an explicit choice that exceeds the classifier figure, once requoted", async () => {
    planHolder.current = gasOnlyPlan();

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );
    expect(screen.getByTestId("gas-topup-confirm")).toHaveTextContent("Add $0.08 gas");

    // The re-quote the tap triggers resolves with the raise honoured, exactly as the real planner
    // sizes it: max(classifier $0.08, choice $10) = $10.
    const raised = gasOnlyPlan();
    raised.gas = { presetUsd: 10, amountUsd: 10 };
    planHolder.current = raised;
    await userEvent.setup().click(screen.getByRole("button", { name: "$10.00" }));

    // The choice reached the planner (it is what the next quote is sized with), and the CTA states
    // the requoted plan's figure, which is now the user's own $10.
    expect(gasHolder.current).toEqual({ presetUsd: 10, amountUsd: 10 });
    expect(screen.getByTestId("gas-topup-confirm")).toHaveTextContent("Add $10.00 gas");
  });

  // @rule POO-1509 R4: while the re-quote a tap triggered is still resolving, the previous plan
  // stays mounted (the panel deliberately never unmounts on `loading`), and its stale figure is not
  // the honest one: the user's in-flight choice is. The CTA falls back to it exactly then.
  it("[R4] shows the in-flight choice while its re-quote is still resolving", async () => {
    planHolder.current = gasOnlyPlan();

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    // The tap starts a re-quote that has not resolved: the plan on screen still says $0.08.
    loadingHolder.current = true;
    await userEvent.setup().click(screen.getByRole("button", { name: "$10.00" }));

    expect(screen.getByTestId("gas-topup-confirm")).toHaveTextContent("Add $10.00 gas");
  });

  it("[R1] still opens on the picker when the operation is short of funds, not just gas", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context({ sources: [fundingSource({ chainId: POLYGON })] })}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByRole("listbox", { name: /your funds/i })).toBeInTheDocument();
  });

  it("[R3] explains a blocked operation chain instead of showing a generic failure", () => {
    errorHolder.current = new TransactionError("Chain 42161 cannot pay for its own transactions.", {
      code: "PROVISIONING_GAS_BLOCKED",
      targetChainId: ARBITRUM,
    });

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context({
          gasByChain: {
            [ARBITRUM]: verdict(ARBITRUM, {
              verdict: "BLOCKED",
              reasonKey: "provisioning.gasVerdict.noNative",
            }),
          },
        })}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    // Actionable and network-named, never the generic "didn't go through" body.
    expect(screen.getByText(/Arbitrum/)).toBeInTheDocument();
    expect(screen.queryByText(/didn't go through/i)).not.toBeInTheDocument();
  });

  it("[R3] offers the buy-crypto escape and no retry, because a retry cannot change the verdict", () => {
    errorHolder.current = new TransactionError("Chain 42161 cannot pay for its own transactions.", {
      code: "PROVISIONING_GAS_BLOCKED",
      targetChainId: ARBITRUM,
    });

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByRole("link", { name: /buy crypto/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/deposit"),
    );
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("[R3] keeps the ordinary retry for a planner failure that is not a gas block", () => {
    errorHolder.current = new TransactionError("upstream unavailable", {
      code: "SYSTEM_INTERNAL",
    });

    renderWithProviders(
      <ProvisioningPanel
        input={GAS_ONLY_INPUT}
        context={context()}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /buy crypto/i })).not.toBeInTheDocument();
  });
});
