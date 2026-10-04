import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFund, mockHolder } from "@/mocks/data/v2Funds";
import {
  act,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({
  public: vi.fn(),
  personal: vi.fn(),
  wallet: `0x${"4".repeat(40)}`,
  query: "",
}));
vi.mock("./fundDetailsActions", () => ({
  loadPublicFundDetailsAction: mocks.public,
  loadPersonalFundDetailsAction: mocks.personal,
}));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}));
vi.mock("@/lib/hooks/useContractFamily", () => ({
  useContractFamily: () => ({ family: "v2", hydrated: true }),
}));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.wallet }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({ useSiweSession: () => ({ isSignedIn: true }) }));
vi.mock("@/features/strategies/components/InvestModal", () => ({
  InvestModal: (props: { open: boolean }) => (
    <div data-testid="invest-host" data-open={String(props.open)} />
  ),
}));
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
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("./FundTechnicalDetail", () => ({
  FundTechnicalDetail: () => <div data-testid="technical-manager" />,
}));

import { FundDetail } from "./FundDetail";

describe("investor V2 details", () => {
  beforeEach(() => {
    mocks.wallet = `0x${"4".repeat(40)}`;
    mocks.query = "";
    mocks.public.mockResolvedValue({ ok: true, fund: mockFund });
    mocks.personal.mockResolvedValue({ ok: false, error: { code: "V2_SESSION" } });
  });
  it("R2 public read survives holder failure without presenting zero ownership", async () => {
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    expect(await screen.findByRole("heading", { name: "Balanced Income" })).toBeInTheDocument();
    expect(await screen.findAllByText("Your position could not be loaded.")).toHaveLength(2);
    expect(screen.queryByText("Your position")).not.toBeInTheDocument();
  });
  it("R3 R4 shows exact-unit values and unproven actions unavailable", async () => {
    mocks.personal.mockResolvedValue({
      ok: true,
      data: { holder: mockHolder, wallet: `0x${"4".repeat(40)}` },
    });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await screen.findByRole("heading", { name: "Balanced Income" });
    await waitFor(() => expect(screen.getAllByText("Your position")).toHaveLength(2));
    expect(screen.getAllByText("1,000,000 USDC")).toHaveLength(1);
    expect(screen.getAllByText("325 USDC")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Collect income: Not available" })).toHaveLength(
      2,
    );
    expect(screen.queryByText("Maximum loss (bps)")).not.toBeInTheDocument();
  });
  it("keeps technical manager operations out of investor Details, even for the manager", async () => {
    mocks.wallet = mockFund.manager;
    mocks.personal.mockResolvedValue({
      ok: true,
      data: { holder: mockHolder, wallet: mockFund.manager },
    });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await screen.findByRole("heading", { name: "Balanced Income" });
    expect(screen.queryByTestId("technical-manager")).not.toBeInTheDocument();
  });
  it("retains an explicit manager entry", async () => {
    mocks.wallet = mockFund.manager;
    mocks.query = "view=manager";
    mocks.personal.mockResolvedValue({
      ok: true,
      data: { holder: mockHolder, wallet: mockFund.manager },
    });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    expect(await screen.findByTestId("technical-manager")).toBeInTheDocument();
  });
  it("never resumes another wallet's funding amount", async () => {
    mocks.query = `invest=100&account=${mockFund.manager}`;
    mocks.personal.mockResolvedValue({
      ok: true,
      data: { holder: mockHolder, wallet: mocks.wallet },
    });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await screen.findByRole("heading", { name: "Balanced Income" });
    expect(screen.getByTestId("invest-host")).toHaveAttribute("data-open", "false");
  });
  it("distinguishes Closing from Closed", async () => {
    mocks.public.mockResolvedValue({ ok: true, fund: { ...mockFund, state: "Closing" } });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await screen.findByRole("heading", { name: "Balanced Income" });
    expect(screen.getAllByText("Closing")).toHaveLength(2);
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
  });
  it("ignores a late fund response after navigating to another core", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.public.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const nextCore = `0x${"9".repeat(40)}`;
    const { rerender } = renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    mocks.public.mockResolvedValue({
      ok: true,
      fund: {
        ...mockFund,
        coreVault: nextCore,
        profile: { ...mockFund.profile, name: "New fund" },
      },
    });
    rerender(<FundDetail core={nextCore} />);
    await screen.findByRole("heading", { name: "New fund" });
    await act(async () => resolveOld({ ok: true, fund: mockFund }));
    expect(screen.queryByRole("heading", { name: "Balanced Income" })).not.toBeInTheDocument();
  });
});
