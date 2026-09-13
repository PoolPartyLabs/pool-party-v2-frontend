/**
 * @id PP-CORE-CMP-046 (POO-1503)
 * @name ProvisioningPanel — the Confirm step is gone
 * @implements-rules-version v20 (POO-1503 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1503 rules v1, epic POO-1498):
 *   [R3]  the flow is `1 Where from` -> `2 Choose tokens` -> `7 Running`, with NO Confirm step.
 *   [R18] the step plan and the `You pay` block live behind `See details` ON step 2, which is where
 *         the Confirm screen's contents went.
 *   [R19] step 2's CTA signs and starts the run (D2: `Confirm and start`).
 *   [R34] no gas amount picker is reachable from anywhere in the flow.
 *
 * The one thing that may still stand between the last choice and the signature is the POO-1047
 * funds-at-risk acknowledgement, and the test for it is the load-bearing one in this file: the gate was
 * mounted in the deleted `plan` phase and nowhere else, so a screen deletion that forgot it would have
 * made the funding path the way around the control added after a poisoned thin-pool route turned $40
 * into $3. It is asserted twice, once for each route shape that can reach it.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type {
  GasFeasibility,
  ProvisioningNeedInput,
  ProvisioningPlan,
  ProvisioningStep,
} from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
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
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const { planHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: (_input: unknown, _gas: unknown, options: { enabled?: boolean } = {}) => ({
    plan: options.enabled === false ? null : planHolder.current,
    loading: false,
    error: null,
    refresh: () => {},
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

/** One spendable holding, on the operation's own chain, so step 2 opens with it pre-selected. */
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

function context(): ProvisioningGateContext {
  return {
    targetChainId: BASE,
    sources: [usdcOnBase()],
    gasByChain: { [BASE]: verdict(BASE) },
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

/** The priced fixture, optionally carrying a price impact on its first AMM leg. */
function planWithImpact(impactPct?: number): ProvisioningPlan {
  const plan = realProvisioningPlan();
  if (impactPct === undefined) return plan;
  const steps = plan.steps.map((step): ProvisioningStep => {
    if (!step.leg || step.leg.kind === "bridge") return step;
    return { ...step, leg: { ...step.leg, priceImpactPct: impactPct } };
  });
  return { ...plan, steps };
}

function renderPanel(over: { onDone?: () => void; onCancel?: () => void } = {}) {
  return renderWithProviders(
    <ProvisioningPanel
      input={INPUT}
      context={context()}
      opLabel="Invest in Stable Yield"
      onDone={over.onDone ?? noop}
      onCancel={over.onCancel ?? noop}
      buildPlanSteps={() => [{ key: "hang", run: () => new Promise<never>(() => {}) }]}
    />,
  );
}

beforeEach(() => {
  planHolder.current = planWithImpact();
});

describe("ProvisioningPanel — no Confirm step (POO-1503)", () => {
  // @rule POO-1503 R19 / D2 — the CTA that used to say `Continue` and open a Confirm now signs, so it
  // names the irreversible act. One press, and the panel is running.
  it("[R19] step 2's CTA starts the run, with no Confirm in between", async () => {
    renderPanel();

    const cta = await screen.findByRole("button", { name: "Confirm and start" });
    fireEvent.click(cta);

    await waitFor(() => {
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending");
    });
    // The execution surface, reached directly. `Almost there` was the Confirm's heading.
    expect(screen.getByText("Working on it")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Almost there" })).not.toBeInTheDocument();
  });

  // @rule POO-1503 R3 — the deleted screen's copy must not come back by accident on any surface a real
  // route can reach. `Fees included.` and the `{count} steps, then your ${amount} goes in` line were
  // both the Confirm's, and both are `provisioning.plan.*` keys that stay in the locales because
  // `plan.title` is the DialogTitle of six modals outside this flow.
  it("[R3] renders none of the Confirm screen's copy on a real route", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm and start" });

    expect(screen.queryByText("Fees included.")).not.toBeInTheDocument();
    expect(screen.queryByText(/then your \$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  // @rule POO-1503 R18 — the plan did not disappear with the screen: it is behind `See details`, and
  // what the disclosure hides is only the HOW. The coverage total stays visible while it is collapsed.
  it("[R18] puts the plan behind See details on step 2, with the total still visible", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm and start" });

    const disclosure = screen.getByRole("button", { name: "See details" });
    // The `how much` is not behind it.
    expect(screen.getByText(/ of \$/)).toBeInTheDocument();

    fireEvent.click(disclosure);

    // The step plan and the itemised `You pay` block, which is where the Confirm's contents went.
    expect(screen.getByTestId("provisioning-cost-breakdown")).toHaveTextContent("You pay");
  });

  // @rule POO-1503 — the quote's deadline moved to the top of step 2 rather than going behind the
  // disclosure with the rest: a price with a deadline the user cannot see is a price they will be
  // surprised by.
  it("shows the quote's refresh countdown on step 2, not behind the disclosure", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm and start" });

    expect(screen.getByText(/Refreshes in/)).toBeInTheDocument();
  });

  // @rule POO-1503 R34 — no gas picker anywhere in the flow. The fixture route carries a swap-gas leg,
  // which is exactly the plan that used to render one.
  it("[R34] reaches no gas amount picker from step 2, disclosure open or shut", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm and start" });

    expect(screen.queryByRole("group", { name: /gas amount/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See details" }));
    expect(screen.queryByRole("group", { name: /gas amount/i })).not.toBeInTheDocument();
  });

  /**
   * @rule POO-1503 R3 + POO-1047 R1 — THE test in this file.
   *
   * The price-impact gate was mounted in the `plan` phase and nowhere else. Deleting that phase
   * without re-homing it would have left the funding path as the one AMM route in the product with no
   * acknowledgement, silently, with every other test still green. It renders as a blocking alert now
   * rather than a step: absent in the ordinary case, unavoidable in the catastrophic one.
   */
  it("[R3] a catastrophic quote still cannot start without an acknowledgement", async () => {
    planHolder.current = planWithImpact(12);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));

    // Not running: the alert stands between the click and the signature.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("12.00%");
    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "impact");
    expect(screen.getByTestId("provisioning-confirm")).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("provisioning-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending");
    });
  });

  // @rule POO-1503 R3 — and refusing is always possible. Acknowledging is never the only way forward,
  // so the alert's ghost returns to step 2 and withdraws the start request rather than looping back in.
  it("[R3] the funds-at-risk alert can be refused, back to step 2", async () => {
    planHolder.current = planWithImpact(12);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "sources");
    });
    expect(screen.getByRole("button", { name: "Confirm and start" })).toBeInTheDocument();
  });

  // @rule POO-1503 R3 — an ordinary quote never sees the alert at all, which is what makes it an
  // exception rather than the Confirm screen under another name.
  it("[R3] an ordinary quote goes straight from step 2 to the run", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));

    await waitFor(() => {
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
