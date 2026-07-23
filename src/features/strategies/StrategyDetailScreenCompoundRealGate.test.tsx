/**
 * @id PP-STR-SCR-002 (POO-511)
 * @name Strategy Detail: real-mode Compound gate tests
 * @implements-rules-version v1
 *
 * [R1] In REAL mode (isMockMode false) the Compound CTA renders DISABLED (visible, not hidden)
 * with the coming-soon explanation, and no interaction can reach CompoundModal's mock settle.
 * The neighbouring Collect/Withdraw actions stay enabled (the gate is compound-only). Mock mode
 * keeps the full flow untouched (covered by StrategyDetailScreen.test.tsx, which runs in mock
 * mode and opens the Compound modal).
 *
 * The whole file runs with `@/lib/services` mocked to real mode, mirroring the
 * MoveRangeModalRealMode.test.tsx precedent.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { StrategyDetailScreen } from "./StrategyDetailScreen";

// Real mode: isMockMode false. In real mode useReferral (fetched on mount by the screen's referral
// aside) reads the getReferralAction server action, NOT rewardsService directly (POO-661), so stub the
// action with an empty program and keep the rewardsService stub for any other consumer.
vi.mock("@/lib/services", () => ({
  isMockMode: false,
  rewardsService: { getReferral: vi.fn(async () => ({ code: null, inviteLink: null })) },
}));
vi.mock("@/features/rewards/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/rewards/actions")>()),
  getReferralAction: vi.fn(async () => ({
    rewardUsd: 10,
    minInvestUsd: 50,
    totalEarnedUsd: 0,
    friendsJoined: 0,
    code: null,
    inviteLink: null,
    invites: [],
  })),
}));

// The real-mode operation hooks (useInvest/useCollectFees/useWithdraw) read the Privy wallet at
// render time; stub the wallet surface so the screen renders without a Privy provider.
// POO-892 R5: the tx hooks read the active address for the address-matched wallet lookup;
// undefined keeps the wallets[0] fallback, preserving the existing fixtures.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: undefined }) }));
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: [] }),
  useSignTypedData: () => ({ signTypedData: vi.fn() }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const strategy: Strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 100,
  tvl: 1_250_000,
  investors: 312,
  estReturn: 7.4,
  rateType: "APY",
  status: "active",
};

const position: Position = {
  id: "p1",
  strategyId: "s1",
  invested: 1800,
  currentValue: 2050,
  totalYield: 250,
  available: 120,
  reinvestment: "auto-compound",
  status: "active",
};

const chartData = [
  { value: 100, label: "Mon" },
  { value: 110, label: "Tue" },
];

function renderOwned() {
  return renderWithProviders(
    <StrategyDetailScreen
      strategy={strategy}
      position={position}
      balance={50}
      chartData={chartData}
    />,
  );
}

beforeEach(() => {
  window.dataLayer = [];
});

describe("StrategyDetailScreen Compound gate (real mode, POO-511)", () => {
  it("[R1] renders the Compound CTA disabled with the coming-soon explanation", () => {
    renderOwned();
    const compounds = screen.getAllByRole("button", { name: "Compound" });
    expect(compounds.length).toBeGreaterThanOrEqual(1);
    for (const button of compounds) expect(button).toBeDisabled();
    // Explanatory affordance: helper text under the CTA (one per action block).
    expect(
      screen.getAllByText("Compounding is coming soon. You can still collect your yield.").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("[R1] clicking the disabled Compound CTA never opens the mock compound flow", () => {
    renderOwned();
    const [compound] = screen.getAllByRole("button", { name: "Compound" });
    if (!compound) throw new Error("expected a Compound button");
    fireEvent.click(compound);
    expect(screen.queryByText("Available to compound")).toBeNull();
  });

  it("[R1] the gate is compound-only: Collect and Withdraw stay enabled", () => {
    renderOwned();
    const [collect] = screen.getAllByRole("button", { name: "Collect $250.00" });
    const [withdraw] = screen.getAllByRole("button", { name: "Withdraw" });
    expect(collect).toBeEnabled();
    expect(withdraw).toBeEnabled();
  });
});
