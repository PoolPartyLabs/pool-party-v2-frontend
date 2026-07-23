/**
 * @id PP-REW-SCR-002
 * @name ManagerIncentiveProgram — tests
 * Behavior: renders the dashboard from the mock data — hero revenue, headline stats, the token
 * callout, the tier ladder (with the current tier), the revenue breakdown and the onboarding goals.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { managerIncentiveProgram } from "@/mocks/data/rewards";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { ManagerIncentiveProgramScreen } from "./ManagerIncentiveProgramScreen";

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

describe("ManagerIncentiveProgramScreen", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it("tracks reward_program_viewed (managerIncentiveProgram) on render", () => {
    renderWithProviders(<ManagerIncentiveProgramScreen data={managerIncentiveProgram} />);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "reward_program_viewed",
        reward_program: "manager_incentive_program",
      }),
    );
  });

  it("renders the header and hero", () => {
    renderWithProviders(<ManagerIncentiveProgramScreen data={managerIncentiveProgram} />);
    expect(
      screen.getByRole("heading", { name: "Manager Incentive Program", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Manager Incentive Program · Maria")).toBeInTheDocument();
    expect(screen.getByText("Revenue this month")).toBeInTheDocument();
  });

  it("links the back button to the profile hub", () => {
    // ManagerIncentiveProgram is entered directly from the Profile hub, so back returns there —
    // consistent with the Rubber Rush and Referral screens.
    renderWithProviders(<ManagerIncentiveProgramScreen data={managerIncentiveProgram} />);
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/profile");
  });

  it("renders the headline stats", () => {
    renderWithProviders(<ManagerIncentiveProgramScreen data={managerIncentiveProgram} />);
    expect(screen.getByText("Strategies created")).toBeInTheDocument();
    expect(screen.getByText("Managed TVL")).toBeInTheDocument();
    expect(screen.getAllByText("Bonus fees").length).toBeGreaterThan(0);
    expect(screen.getByText("$391.83")).toBeInTheDocument();
  });

  it("renders the token callout and tier ladder", () => {
    renderWithProviders(<ManagerIncentiveProgramScreen data={managerIncentiveProgram} />);
    expect(
      screen.getByRole("heading", { name: /5,000,000 tokens to be distributed/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "You're a Tier 6 member" })).toBeInTheDocument();
    expect(screen.getByText("Tier 1")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("$1M")).toBeInTheDocument();
  });

  it("renders the revenue breakdown and onboarding goals", () => {
    renderWithProviders(<ManagerIncentiveProgramScreen data={managerIncentiveProgram} />);
    expect(screen.getByText("$44.55")).toBeInTheDocument();
    expect(screen.getByText("$1,626.46")).toBeInTheDocument();
    expect(screen.getByText("10 referrals")).toBeInTheDocument();
    expect(screen.getAllByText("tracked externally")).toHaveLength(2);
  });
});
