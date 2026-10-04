import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({ build: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: true }));
vi.mock("./fundActions", () => ({
  buildFundAction: mocks.build,
  loadFundAction: mocks.load,
  pollFundReportAction: vi.fn(),
  startFundReportAction: vi.fn(),
}));

import { mockFund, mockFundBuild, mockHolder, mockWallet } from "@/mocks/data/v2Funds";
import { FundActionsPanel } from "./FundActionsPanel";

describe("fund investor controls", () => {
  it("explains a fractional payout as a one-share minimum instead of a deposit error", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { fund: mockFund } });
    mocks.build.mockResolvedValue({
      ok: false,
      error: { code: "PayoutBelowOneShare", status: 400 },
    });
    renderWithProviders(
      <FundActionsPanel
        fund={mockFund}
        holder={mockHolder}
        wallet={mockWallet}
        refresh={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText("Amount (USDC)"), "0.5");
    await userEvent.click(screen.getByRole("button", { name: "Instant payout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payouts are in whole shares; minimum 1 share.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("Minimum deposit");
    expect(screen.getByRole("alert")).not.toHaveTextContent("PayoutBelowOneShare");
    expect(screen.queryByRole("button", { name: "Confirm in wallet" })).not.toBeInTheDocument();
  });
  it("R4 labels pre-approval estimate and replaces it with authoritative builder values", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { fund: mockFund } });
    mocks.build.mockResolvedValue({
      ok: true,
      data: mockFundBuild({ action: "deposit", amount: "2000000" }),
    });
    renderWithProviders(
      <FundActionsPanel
        fund={mockFund}
        holder={mockHolder}
        wallet={mockWallet}
        refresh={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText("Amount (USDC)"), "2");
    expect(screen.getByText(/ESTIMATE/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() => expect(screen.getByText("Authoritative simulation")).toBeInTheDocument());
    expect(mocks.build).toHaveBeenCalledWith(
      mockFund.coreVault,
      expect.objectContaining({
        action: "deposit",
        amount: "2000000",
        minShares: "1000000000000000000",
      }),
    );
  });
  it("R5 renders the 72-hour Standard term and blocks claims when not claimable", () => {
    renderWithProviders(
      <FundActionsPanel
        fund={mockFund}
        holder={mockHolder}
        wallet={mockWallet}
        refresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/72-hour/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim payout" })).toBeDisabled();
  });
  it("R5 deferred income returns an accessible translated state without a transaction", async () => {
    mocks.build.mockResolvedValue({ ok: false, error: { code: "V2_DEFERRED", status: 409 } });
    renderWithProviders(
      <FundActionsPanel
        fund={mockFund}
        holder={mockHolder}
        wallet={mockWallet}
        refresh={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Withdraw income" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Income withdrawal deferred");
    expect(screen.queryByRole("button", { name: "Confirm in wallet" })).not.toBeInTheDocument();
  });
});
