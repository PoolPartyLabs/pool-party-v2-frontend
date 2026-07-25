/**
 * @id PP-CORE-CMP-046 (POO-1044)
 * @name ProvisioningPanel — gas top-up surface tests
 * @implements-rules-version v6 (POO-1044 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The panel's half of the gas top-up.
 *
 * Rules under test (POO-1044 rules v1):
 *   [R1] a gas-only shortfall goes straight to the one-step plan; there is nothing to pick, because
 *        the gas source is the classifier's, not the user's
 *   [R3] a BLOCKED operation chain is never rendered as a runnable plan: the panel says what is
 *        wrong, in the user's language, and offers the buy-crypto escape instead of a retry that
 *        cannot change the verdict
 *   [R6] no control that turns nothing: the inline gas selector is absent wherever the amount it
 *        would set is not the amount that executes
 *
 * The multi-source picker is asserted to still open for a funding shortfall, so this change cannot
 * quietly bypass POO-1042's whole flow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { GasFeasibility, ProvisioningNeedInput, ProvisioningPlan } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { TransactionError } from "@/lib/tx/sendTransaction";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { ProvisioningPanel } from "./ProvisioningPanel";

const POLYGON = 137;
const ARBITRUM = 42161;

const { planHolder, errorHolder, enabledHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
  errorHolder: { current: null as Error | null },
  /** Whether the panel asked for a plan at all: `enabled: false` means it is still picking. */
  enabledHolder: { current: null as boolean | null },
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: (
    _input: unknown,
    _gas: unknown,
    options: { selection?: readonly string[]; enabled?: boolean } = {},
  ) => {
    enabledHolder.current = options.enabled ?? true;
    return {
      plan: errorHolder.current ? null : planHolder.current,
      loading: false,
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

/** The one-step plan the real planner returns for {@link GAS_ONLY_INPUT}. */
function gasOnlyPlan(): ProvisioningPlan {
  const full = realProvisioningPlan();
  const gasStep = full.steps.find((step) => step.type === "swap-gas");
  const opStep = full.steps.find((step) => step.type === "op");
  if (!gasStep || !opStep) throw new Error("the real plan fixture lost its gas or op step");
  return {
    ...full,
    reason: ["gas"],
    variant: "gas-only",
    steps: [gasStep, opStep],
  };
}

beforeEach(() => {
  planHolder.current = realProvisioningPlan();
  errorHolder.current = null;
  enabledHolder.current = null;
});

describe("ProvisioningPanel — gas top-up (POO-1044)", () => {
  it("[R1] opens straight on the one-step plan when only gas is missing", () => {
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
    expect(screen.getByText(/one quick step/i)).toBeInTheDocument();
    expect(enabledHolder.current).toBe(true);
  });

  it("[R6] renders no gas amount selector on the real gas-only plan", () => {
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

    expect(screen.queryByRole("group", { name: /gas amount/i })).not.toBeInTheDocument();
  });

  it("[R6] keeps the mock-mode gas selector, with its presets, exactly as it was", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.gasOnly}
        opLabel="Collect fees"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    const selector = screen.getByRole("group", { name: /gas amount/i });
    expect(selector).toBeInTheDocument();
    // [R7] The shipped $10 / $25 / Custom control, unchanged.
    expect(screen.getByRole("button", { name: "$10.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$25.00" })).toBeInTheDocument();
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
