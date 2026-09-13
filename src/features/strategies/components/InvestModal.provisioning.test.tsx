/**
 * @id PP-STR-MOD-001 (POO-419)
 * @name InvestModal — pre-flight provisioning wiring
 * @implements-rules-version v1
 *
 * With the dark-launched `provisioning` flag ON (forced here), the "Invest" CTA routes through the
 * pre-flight gate instead of straight to building: amount → provision (ProvisioningPanel) → building.
 * POO-598 R7: the gate stays on the flow-start "Invest" CTA (NOT the Review approve) because the
 * approve/permit signatures run before the review, so gas must be ensured first. Cancelling returns to
 * the amount step with the op untouched (R2: the invest flow + its params are never mutated by the
 * gate). The flag-OFF baseline is covered by InvestModal.test.tsx (unchanged).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { InvestModal } from "./InvestModal";
// The mocked settle switch (factory below), so a case can drive the mock rail to a failure.
import { settleOutcome } from "./settle";

// Force the dark-launched flag ON for this file (the happy-path file leaves it OFF).
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({
    isEnabled: (key: string) => key === "provisioning",
    flags: {},
  }),
}));

vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));

vi.mock("./settle", () => ({
  settleOutcome: vi.fn(() => "success"),
  settleTxError: vi.fn(() => ({ code: "-32603", message: "execution reverted: mock" })),
  settleTxHash: vi.fn(() => "0x7a3f5b8c0d1e2f4a6b8c0d1e2f4a6b8c0d1e9c2e"),
  settleDeployedUsd: vi.fn((requested: number) => requested),
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

const strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 50,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY",
  status: "active",
  detail: { lockupDays: 0, managerVerified: true, about: "x", composition: [] },
} as unknown as Strategy;

/** Render the dialog and enter a funded amount so the "Invest" CTA is armed. */
function enterAmount() {
  renderWithProviders(
    <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
  );
  fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value: "100" } });
}

describe("InvestModal — provisioning gate", () => {
  // A previous test's auto-started mock rail can still have a 900 ms settle timer in flight when the
  // next test begins, and that late call would consume a `mockReturnValueOnce`. Overrides are set
  // durably per test and restored here instead.
  afterEach(() => {
    vi.mocked(settleOutcome).mockImplementation(() => "success");
  });

  it("routes the Invest CTA → provision when the wallet is short (flag on)", async () => {
    enterAmount();
    // POO-598 R7: the "Invest" CTA intercepts to the pre-flight gate instead of starting the build.
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));

    // POO-1503: the mock Confirm screen is deleted and the panel auto-starts once the async plan
    // resolves, so the gate's tell is the provisioning EXECUTION surface with the op anchored on it.
    expect(await screen.findByText("Working on it")).toBeInTheDocument();
    expect(screen.getByText("Invest in Stable Yield")).toBeInTheDocument();
    // The build/sign has NOT started yet (no Review reached).
    expect(screen.queryByRole("button", { name: "Confirm investment" })).not.toBeInTheDocument();
  });

  it("leaving the gate returns to the amount step with the op untouched", async () => {
    // POO-1503: the mock Confirm (and its Cancel) is deleted and the panel auto-starts, so the
    // mock-reachable way OUT of the gate is the failure screen's Back. What R2 pins is unchanged:
    // leaving the gate lands back on the amount step with the invest flow untouched.
    vi.mocked(settleOutcome).mockReturnValue("error");
    enterAmount();
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back" }, { timeout: 3000 }));

    // Back on the amount step: the Invest CTA is present again, the gate is gone.
    expect(screen.getByRole("button", { name: "Invest" })).toBeInTheDocument();
    expect(screen.queryByText("Working on it")).not.toBeInTheDocument();
  });
});
