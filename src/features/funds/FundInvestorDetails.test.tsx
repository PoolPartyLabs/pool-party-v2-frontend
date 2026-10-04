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
  balance: vi.fn(),
  public: vi.fn(),
  personal: vi.fn(),
  wallet: `0x${"4".repeat(40)}`,
  query: "",
  signedIn: true,
}));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/tokens/readErc20", () => ({ readErc20Balance: mocks.balance }));
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
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => ({ isSignedIn: mocks.signedIn }),
}));
vi.mock("@/features/strategies/components/InvestModal", () => ({
  InvestModal: (props: { open: boolean; balance: number | null }) => (
    <div
      data-testid="invest-host"
      data-open={String(props.open)}
      data-balance={String(props.balance)}
    />
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
vi.mock("@/features/manager/fund/manage/ManageEntry", () => ({
  ManageEntry: () => <div data-testid="v2-manage" />,
}));

import { FundDetail } from "./FundDetail";

describe("investor V2 details", () => {
  beforeEach(() => {
    mocks.wallet = `0x${"4".repeat(40)}`;
    mocks.query = "";
    mocks.signedIn = true;
    mocks.balance.mockReset().mockResolvedValue(BigInt(25000001));
    mocks.public.mockResolvedValue({ ok: true, fund: mockFund });
    mocks.personal.mockResolvedValue({ ok: false, error: { code: "V2_SESSION" } });
  });
  it("R2 public read survives holder failure without presenting zero ownership", async () => {
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    expect(await screen.findByRole("heading", { name: "Balanced Income" })).toBeInTheDocument();
    expect(await screen.findAllByText("Your position could not be loaded.")).toHaveLength(2);
    expect(screen.queryByText("Your position")).not.toBeInTheDocument();
  });
  it("POO-2224 R2 reads connected hub USDC despite holder API failure", async () => {
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await waitFor(() =>
      expect(mocks.balance).toHaveBeenCalledWith(mockFund.mandate.usdc, mocks.wallet, 42161),
    );
    await waitFor(() =>
      expect(screen.getByTestId("invest-host")).toHaveAttribute("data-balance", "25.000001"),
    );
  });
  it("POO-2224 R1 reads public USDC before SIWE without loading holder data", async () => {
    mocks.signedIn = false;
    mocks.personal.mockClear();
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await waitFor(() =>
      expect(screen.getByTestId("invest-host")).toHaveAttribute("data-balance", "25.000001"),
    );
    expect(mocks.personal).not.toHaveBeenCalled();
  });
  it("POO-2224 R2 a failed public balance stays unavailable rather than zero", async () => {
    mocks.balance.mockRejectedValue(new Error("RPC failed"));
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await waitFor(() => expect(mocks.balance).toHaveBeenCalled());
    expect(screen.getByTestId("invest-host")).toHaveAttribute("data-balance", "null");
  });
  it("POO-2224 R2 ignores a late prior-wallet balance", async () => {
    let resolveOld!: (balance: bigint) => void;
    mocks.balance.mockImplementationOnce(
      () =>
        new Promise<bigint>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const view = renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await waitFor(() => expect(mocks.balance).toHaveBeenCalledTimes(1));
    mocks.wallet = `0x${"5".repeat(40)}`;
    mocks.balance.mockResolvedValue(BigInt(3000000));
    view.rerender(<FundDetail core={mockFund.coreVault} />);
    await waitFor(() =>
      expect(screen.getByTestId("invest-host")).toHaveAttribute("data-balance", "3"),
    );
    await act(async () => resolveOld(BigInt(90000000)));
    expect(screen.getByTestId("invest-host")).toHaveAttribute("data-balance", "3");
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
    expect(screen.queryByTestId("v2-manage")).not.toBeInTheDocument();
  });
  it("routes manager entry independently of investor reads", async () => {
    mocks.personal.mockClear();
    mocks.public.mockClear();
    mocks.wallet = mockFund.manager;
    mocks.query = "view=manager";
    mocks.personal.mockResolvedValue({
      ok: true,
      data: { holder: mockHolder, wallet: mockFund.manager },
    });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    expect(await screen.findByTestId("v2-manage")).toBeInTheDocument();
    expect(mocks.personal).not.toHaveBeenCalled();
    expect(mocks.public).not.toHaveBeenCalled();
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
  it("reads the confirmed wallet's hub USDC balance through the existing reader", async () => {
    mocks.personal.mockResolvedValue({
      ok: true,
      data: { holder: mockHolder, wallet: mocks.wallet },
    });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await waitFor(() =>
      expect(mocks.balance).toHaveBeenCalledWith(mockFund.mandate.usdc, mocks.wallet, 42161),
    );
  });
});
