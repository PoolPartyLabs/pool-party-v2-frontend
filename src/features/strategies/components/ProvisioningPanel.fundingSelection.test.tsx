/**
 * @id PP-CORE-CMP-046 (POO-1155)
 * @name ProvisioningPanel — funding-selection fixes
 * @implements-rules-version v14 (POO-1155 / POO-1129 rules v3)
 *
 * The three panel-level behaviours POO-1155 adds to the "Choose tokens" screen:
 *   - TARGET-CHAIN holdings arrive already selected and counted (the reported bug: 17.54 USDC on the
 *     strategy's own chain, greyed out), while the native coin is NOT preselected;
 *   - Continue proceeds while SHORT when the on-ramp can buy the remainder (`allowShortfall`);
 *   - the deposit-from-external-wallet route hands off to the launched `/deposit` surface.
 *
 * The pure reachability/reserve math and the selector's own row behaviour are proven in
 * `fundingSelection.test.ts` and `FundingSourceSelector.test.tsx`; this suite is what the PANEL wires.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import type { GasFeasibility, ProvisioningPlan } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ProvisioningPanel } from "./ProvisioningPanel";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
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
  useRouter: () => ({ push }),
}));

const { planHolder, quotedForHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
  quotedForHolder: { current: null as readonly string[] | null },
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: (
    _input: unknown,
    _gas: unknown,
    options: { selection?: readonly string[]; enabled?: boolean } = {},
  ) => {
    quotedForHolder.current = options.enabled === false ? null : (options.selection ?? []);
    return { plan: planHolder.current, loading: false, error: null, refresh: () => {} };
  },
}));

const BASE = 8453;
const ARBITRUM = 42161;
const POLYGON = 137;
const NATIVE = "0x0000000000000000000000000000000000000000";

function noop() {}

function fundingSource(over: Partial<FundingSource> & Pick<FundingSource, "chainId">) {
  return {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    decimals: 6,
    amount: "50000000",
    usd: 50,
    reachableChainIds: [ARBITRUM, POLYGON],
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

/** A Base-target context whose only holding is 50 USDC on Base (the operation's own chain). */
function context(over: Partial<ProvisioningGateContext> = {}): ProvisioningGateContext {
  return {
    targetChainId: BASE,
    sources: [fundingSource({ chainId: BASE })],
    gasByChain: { [BASE]: verdict(BASE) },
    balancesByChain: { [BASE]: { nativeUsd: 5, tokenUsd: 50 } },
    gasEstimateUsd: 0.075,
    ...over,
  };
}

const input = { ...SCENARIOS.usdcBridge, targetChainId: BASE, opRequiredUsdc: 100 };

beforeEach(() => {
  planHolder.current = realProvisioningPlan();
  quotedForHolder.current = null;
  push.mockClear();
  __resetDevOverridesForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetDevOverridesForTests();
});

describe("ProvisioningPanel — funding selection (POO-1155)", () => {
  // @rule POO-1503 R18 — OVERTURNS the second half of this test. POO-1042 [R7] suspended the planner
  // until a selection was CONFIRMED, so that "no plan is quoted for a route nobody asked for". Two of
  // step 2's rules cannot hold under that suspension: [R18] puts the step plan and the `You pay` block
  // behind `See details` ON step 2, both plan-derived, and [R19] makes step 2's CTA sign, which cannot
  // happen against a plan that does not exist yet. So the plan is quoted for the LIVE selection.
  // [R7]'s substance survives: the fan-out runs for what the user has picked, not for a route nobody
  // asked for, and it stays suspended entirely while step 1's route question is open.
  it("pre-selects and counts the target-chain holding, and quotes for what is selected", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={input}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    // The 50 USDC on Base arrives already selected, so the header counts it rather than greying it.
    const row = screen.getByRole("option", { name: /USDC on Base/ });
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/ of \$/)).toHaveTextContent("$50.00 of");

    // The quote is for exactly what is selected, and for nothing else: the pre-selected on-target
    // holding, which is what `See details` will itemise and what the CTA will start.
    expect(quotedForHolder.current).toEqual([`${BASE}:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`]);
  });

  it("does NOT pre-select the native coin, even above the reserve", () => {
    const eth = fundingSource({
      chainId: BASE,
      address: NATIVE,
      symbol: "ETH",
      decimals: 18,
      isNative: true,
      amount: "5500000000000000", // 0.0055 ETH, above the 0.001 floor
      usd: 18,
      reachableChainIds: [ARBITRUM],
    });
    renderWithProviders(
      <ProvisioningPanel
        input={input}
        context={context({ sources: [eth] })}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    // Pre-spending someone's gas is not a safe default: the native coin stays selectable but unselected.
    const row = screen.getByRole("option", { name: /ETH on Base/ });
    expect(row).toHaveAttribute("aria-selected", "false");
    expect(row).not.toHaveAttribute("aria-disabled");
  });

  it("proceeds from a short selection when the on-ramp can buy the remainder", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
    renderWithProviders(
      <ProvisioningPanel
        input={input}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    // The "Where from" screen leads with the on-ramp on; choosing the token route opens the selector.
    // POO-1501 [R5]: the row reads `Use {available} + buy {shortfall}`, matched on shape not figures.
    fireEvent.click(await screen.findByRole("button", { name: /^use \$[\d,.]+ \+ buy \$/i }));

    // The pre-selected 50 USDC is SHORT of the 100 requirement, yet Continue is enabled and advances:
    // the plan buys the remainder rather than the row being a dead end.
    const cta = await screen.findByRole("button", { name: "Confirm and start" });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);

    // Continue proceeded rather than being blocked by the shortfall: the planner ran on the short
    // selection, and `buildPlan` sizes the remainder + fees into a buy leg (proven in
    // `planActions.test.ts` / `buildPlan.test.ts`). Before this fix a short selection could not confirm.
    await waitFor(() =>
      expect(quotedForHolder.current).toEqual(["8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"]),
    );
  });

  it("hands the deposit route off to the /deposit surface without assembling a plan", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
    renderWithProviders(
      <ProvisioningPanel
        input={input}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /deposit from external wallet/i }));

    expect(push).toHaveBeenCalledWith("/deposit");
  });
});
