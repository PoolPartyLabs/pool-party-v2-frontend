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
import { describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { InvestModal } from "./InvestModal";

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
  it("routes the Invest CTA → provision when the wallet is short (flag on)", async () => {
    enterAmount();
    // POO-598 R7: the "Invest" CTA intercepts to the pre-flight plan instead of starting the build.
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));

    // The op anchor + the plan CTA are unique to the provisioning plan view.
    // POO-1023: the plan resolves through the async computePlan seam, so await its arrival.
    expect(await screen.findByText("Invest in Stable Yield")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm & continue" })).toBeInTheDocument();
    // The build/sign has NOT started yet (no Review reached).
    expect(screen.queryByRole("button", { name: "Confirm investment" })).not.toBeInTheDocument();
  });

  it("cancel from the plan returns to the amount step with the op untouched", async () => {
    enterAmount();
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));
    // POO-1023: wait for the async plan before acting on it.
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    // Back on the amount step: the Invest CTA is present again, the plan is gone.
    expect(screen.getByRole("button", { name: "Invest" })).toBeInTheDocument();
    expect(screen.queryByText("Almost there")).not.toBeInTheDocument();
  });
});
