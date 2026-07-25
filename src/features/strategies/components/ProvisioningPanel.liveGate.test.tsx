/**
 * @id PP-CORE-CMP-046 (POO-1042)
 * @name ProvisioningPanel — live funding-source gate tests
 * @implements-rules-version v5 (POO-1042 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The real branch of the panel: when the host hands down a LIVE gate context, the user first picks
 * what to spend and only then sees a priced plan.
 *
 * Rules under test (POO-1042 rules v1):
 *   [R7]  the CTA is seeded from the bare shortfall plus a conservative buffer, and coverage is
 *         RE-CHECKED against the quoted plan. The CTA may never flip enabled → disabled; a plan
 *         that comes back short lands in an explicit "add another source" state.
 *   [R8]  a source that cannot route to the operation's chain is not offerable.
 *   [R9]  every source chain carries a verdict, so the selector's no-verdict fallback is dead code.
 *   [R10] the real rail runs, never the 900 ms mock settle.
 *
 * Mock mode is unaffected by construction: with no context prop the panel behaves exactly as it did
 * (`ProvisioningPanel.test.tsx` remains the proof of that).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
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

// POO-1044 [R3]: the panel's buy-crypto escape renders the locale-aware Link, which resolves Next's
// app-router navigation. It does not exist under jsdom, so it is stood in for, as in every other
// suite in this folder that mounts a navigating component.
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

// The plan seam is async and would resolve the mock planner; this pins what the planner returns so
// the re-check after quoting [R7] is exercisable.
const { planHolder, quotedForHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
  /** What the planner was actually asked for: null while it is suspended. */
  quotedForHolder: { current: null as readonly string[] | null },
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: (
    _input: unknown,
    _gas: unknown,
    options: { selection?: readonly string[]; enabled?: boolean } = {},
  ) => {
    quotedForHolder.current = options.enabled === false ? null : (options.selection ?? []);
    return { plan: planHolder.current, loading: false, error: null };
  },
}));

function noop() {}

function fundingSource(over: Partial<FundingSource> & Pick<FundingSource, "chainId">) {
  return {
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
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
    sources: [fundingSource({ chainId: POLYGON })],
    gasByChain: { [POLYGON]: verdict(POLYGON), [ARBITRUM]: verdict(ARBITRUM) },
    balancesByChain: {
      [POLYGON]: { nativeUsd: 5, tokenUsd: 1_200 },
      [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
    },
    gasEstimateUsd: 0.075,
    ...over,
  };
}

beforeEach(() => {
  planHolder.current = realProvisioningPlan();
  quotedForHolder.current = null;
});

describe("ProvisioningPanel — live gate (POO-1042)", () => {
  it("[R7] opens on the funding-source picker, not on a plan the user never chose", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    expect(screen.getByRole("listbox", { name: /your funds/i })).toBeInTheDocument();
  });

  it("[R7] does not quote a plan until a source is picked", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    // Null, not empty: the planner is SUSPENDED, so its per-chain quote fan-out never runs for a
    // route nobody asked for. An empty selection would still be a request.
    expect(quotedForHolder.current).toBeNull();
  });

  it("[R7] the picker's requirement exceeds the bare shortfall (a conservative seed)", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={{ ...SCENARIOS.usdcBridge, opRequiredUsdc: 100 }}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    // "Needed: $x" — seeded above the $100 shortfall so the quoted plan lands under it.
    const needed = screen.getByText(/needed:/i).textContent ?? "";
    const seeded = Number(needed.replace(/[^0-9.]/g, ""));
    expect(seeded).toBeGreaterThan(100);
  });

  it("[R8] a source that cannot reach the operation's chain is not selectable", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context({
          sources: [fundingSource({ chainId: POLYGON, reachableChainIds: [POLYGON] })],
        })}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    const row = screen.getByRole("option");
    fireEvent.click(row);

    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveAttribute("aria-selected", "false");
  });

  it("[R8] a reachable source is selectable and becomes route step 1", () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    fireEvent.click(screen.getByRole("option"));

    expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "true");
  });

  it("[R7] confirming a covering selection quotes the plan for exactly those sources", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    fireEvent.click(screen.getByRole("option"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(quotedForHolder.current).toEqual([
        `${POLYGON}:0x7ceb23fd6bc0add59e62ac25578270cff1b9f619`,
      ]),
    );
  });

  it("[R7] a quoted plan that costs MORE than the selection covers asks for another source", async () => {
    // The seeded requirement was met, the quoted one is not: the honest figure is only known after
    // the route is priced. The user must be told, never silently handed a plan that strands.
    planHolder.current = realProvisioningPlan({
      quote: {
        shortfallUsd: 1_200,
        bufferUsd: 60,
        feesUsd: 5,
        totalPayUsd: 5_000,
        quotedAt: "2026-07-25T12:00:00.000Z",
        ttlMs: 30_000,
      },
    });

    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    fireEvent.click(screen.getByRole("option"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // Back on the picker, with the real number stated, rather than on a plan card whose confirm the
    // user would be pressing against a route that strands. This IS the explicit "add another source"
    // state the rule asks for: the CTA did not go dead under them on the screen they were on, they
    // were moved to one that says what is missing.
    expect(await screen.findByRole("listbox", { name: /your funds/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/pick one more source/i);
    // And the requirement on screen is now the QUOTED total, not the seed it was opened with.
    expect(screen.getByText(/needed:/i)).toHaveTextContent("5,000");
  });

  it("[R10] runs the rail, not the 900 ms mock settle", async () => {
    const buildPlanSteps = vi.fn(() => [{ key: "swap-token-0", run: async () => ({}) }]);

    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        context={context()}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={buildPlanSteps}
      />,
    );

    fireEvent.click(screen.getByRole("option"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(buildPlanSteps).toHaveBeenCalled());
  });
});
