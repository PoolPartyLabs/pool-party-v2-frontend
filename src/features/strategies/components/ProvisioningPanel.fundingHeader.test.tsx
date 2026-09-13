/**
 * @id PP-CORE-CMP-046 (POO-1166)
 * @name ProvisioningPanel — Choose tokens header denominator
 * @implements-rules-version v15 (POO-1166 / POO-1129 rules v3)
 *
 * POO-1166: the "Choose tokens" header counted the on-target holding TWICE. Its denominator was seeded
 * from `need.usdcShortfallUsd` — a figure already net of the wallet's holdings — while POO-1155 then
 * ALSO counted those same holdings as covering sources. The same money was subtracted once from the
 * requirement and added once as coverage, so the header showed a number that reconciled with neither
 * the invest modal nor the plan card ("$19.08 of $75.65" for a $100 deposit that buys $73.91).
 *
 * The fix: the header denominator is the operation's FULL requirement — the liquidity amount the user
 * asked for (`input.opRequiredUsdc`) — stable as the selection changes, with every selected source
 * (the on-target holding included) counting TOWARD it rather than being netted OUT of it. This is the
 * same figure the server plans against (`planActions.ts` `requiredUsd = input.opRequiredUsdc`), so the
 * three surfaces reconcile.
 *
 * The reported wallet, verbatim: $100 invest on Arbitrum, holding 17.54 USDC (Arbitrum, the target),
 * 8.56 USDC (Base), 0.0055 ETH (Base) and 0.0007 ETH (Arbitrum, correctly held back for gas).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import type { GasFeasibility, ProvisioningNeedInput, ProvisioningPlan } from "@/lib/provisioning";
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

const { planHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: (
    _input: unknown,
    _gas: unknown,
    options: { selection?: readonly string[]; enabled?: boolean } = {},
  ) => {
    void options;
    return { plan: planHolder.current, loading: false, error: null, refresh: () => {} };
  },
}));

const BASE = 8453;
const ARBITRUM = 42161;
const NATIVE = "0x0000000000000000000000000000000000000000";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function noop() {}

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

/** The reported wallet: 17.54 USDC (Arbitrum, target), 8.56 USDC (Base), plus native on both chains. */
const arbUsdc: FundingSource = {
  address: USDC_ARBITRUM,
  chainId: ARBITRUM,
  symbol: "USDC",
  decimals: 6,
  amount: "17540000",
  usd: 17.54,
  reachableChainIds: [BASE], // bridge destinations exclude the own chain, as live on dev
  isNative: false,
  logoUrl: "",
};
const baseUsdc: FundingSource = {
  address: USDC_BASE,
  chainId: BASE,
  symbol: "USDC",
  decimals: 6,
  amount: "8560000",
  usd: 8.56,
  reachableChainIds: [ARBITRUM],
  isNative: false,
  logoUrl: "",
};
const baseEth: FundingSource = {
  address: NATIVE,
  chainId: BASE,
  symbol: "ETH",
  decimals: 18,
  amount: "5500000000000000", // 0.0055 ETH, above the 0.001 signing floor
  usd: 18,
  reachableChainIds: [ARBITRUM],
  isNative: true,
  logoUrl: "",
};
const arbEth: FundingSource = {
  address: NATIVE,
  chainId: ARBITRUM,
  symbol: "ETH",
  decimals: 18,
  amount: "700000000000000", // 0.0007 ETH, below the floor: kept for gas, unselectable
  usd: 2.29,
  reachableChainIds: [BASE],
  isNative: true,
  logoUrl: "",
};

const context: ProvisioningGateContext = {
  targetChainId: ARBITRUM,
  sources: [arbUsdc, baseUsdc, baseEth, arbEth],
  gasByChain: { [ARBITRUM]: verdict(ARBITRUM), [BASE]: verdict(BASE) },
  // The invest modal's own view of the wallet drives `computeProvisioningNeed`. Its shortfall is what
  // the buggy code seeded the header from; the fix ignores it in favour of the full requirement.
  balancesByChain: {
    [ARBITRUM]: { nativeUsd: 2.29, tokenUsd: 17.54 },
    [BASE]: { nativeUsd: 18, tokenUsd: 8.56 },
  },
  gasEstimateUsd: 0.075,
};

const input: ProvisioningNeedInput = {
  currentChainId: ARBITRUM,
  targetChainId: ARBITRUM,
  opRequiredUsdc: 100,
  gasEstimateUsd: 0.075,
  balancesByChain: {
    [ARBITRUM]: { nativeUsd: 2.29, tokenUsd: 17.54 },
    [BASE]: { nativeUsd: 18, tokenUsd: 8.56 },
  },
};

async function openSourceSelector() {
  // With the on-ramp on, the "Where from" screen leads; the token route opens the source selector.
  // POO-1501 [R5]: the row is now verb plus amount (`Use $88.40 + buy $121.60`), so it is matched on
  // the shape rather than on figures this fixture would have to restate.
  fireEvent.click(await screen.findByRole("button", { name: /^use \$[\d,.]+ \+ buy \$/i }));
  return screen.findByRole("button", { name: "Confirm and start" });
}

beforeEach(() => {
  planHolder.current = realProvisioningPlan();
  push.mockClear();
  __resetDevOverridesForTests();
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetDevOverridesForTests();
});

describe("ProvisioningPanel — Choose tokens header denominator (POO-1166)", () => {
  it("shows the full requirement as the denominator, not a shortfall", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={input}
        context={context}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    await openSourceSelector();

    // The denominator is the operation's full requirement ($100.00), the liquidity the user asked for —
    // never `need.usdcShortfallUsd` ($73.90 here), which double-counted the on-target holding.
    const meter = await screen.findByText(/of \$/);
    expect(meter).toHaveTextContent("of $100.00");
    expect(meter).not.toHaveTextContent("of $73");
  });

  it("counts the on-target holding toward the requirement rather than netting it out", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={input}
        context={context}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    await openSourceSelector();

    // The 17.54 USDC on Arbitrum arrives pre-selected (POO-1155) and counts as coverage: $17.54 of
    // $100.00, still $82.46 to go — not subtracted from the requirement.
    const meter = await screen.findByText(/of \$/);
    expect(meter).toHaveTextContent("$17.54 of $100.00");
    expect(screen.getByText(/82\.46/)).toBeInTheDocument();
  });

  it("keeps the denominator stable as the selection grows", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={input}
        context={context}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );

    await openSourceSelector();
    expect(await screen.findByText(/of \$/)).toHaveTextContent("$17.54 of $100.00");

    // Adding the Base USDC raises coverage to $26.10 but the denominator does not move: $73.90 to go.
    fireEvent.click(screen.getByRole("option", { name: /USDC on Base/ }));
    await waitFor(() => expect(screen.getByText(/of \$/)).toHaveTextContent("$26.10 of $100.00"));
    expect(screen.getByText(/73\.90/)).toBeInTheDocument();
  });
});
