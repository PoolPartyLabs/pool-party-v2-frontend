import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioViewProps } from "@/features/portfolio/PortfolioView";
import type { StrategiesExploreScreenProps } from "@/features/strategies/StrategiesExploreScreen";
import { mockFund, mockHolder, mockWallet } from "@/mocks/data/v2Funds";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import type { loadInvestorListAction } from "./investorListActions";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  address: "0x0000000000000000000000000000000000000001",
  signed: true,
}));
vi.mock("./investorListActions", () => ({ loadInvestorListAction: mocks.load }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.address }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => ({ isSignedIn: mocks.signed }),
}));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/features/strategies/StrategiesExploreScreen", () => ({
  StrategiesExploreScreen: ({
    strategies,
    paged,
    ownedIds,
    investedIds,
  }: StrategiesExploreScreenProps) => (
    <div>
      {strategies.map((s) => (
        <p key={s.id}>{s.name}</p>
      ))}
      <p>{paged?.total} scope</p>
      <p>
        {ownedIds.length} owned / {investedIds.length} invested
      </p>
      <button type="button" onClick={paged?.onLoadMore}>
        More
      </button>
      <button type="button" onClick={() => paged?.onQueryChange("second")}>
        Search
      </button>
    </div>
  ),
}));
vi.mock("@/features/portfolio/PortfolioView", () => ({
  PortfolioView: ({ totalValue, positions, paged }: PortfolioViewProps) => (
    <div>
      <p>{totalValue === null ? "absent-total" : "bad-total"}</p>
      <p>
        {positions.length} active / {paged?.closed.entries?.length ?? 0} exited
      </p>
      <button type="button" onClick={paged?.closed.onReveal}>
        Closed
      </button>
    </div>
  ),
}));

import { InvestorListLoader } from "./InvestorListLoader";

describe("V2 list loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.address = mockWallet;
    mocks.signed = true;
  });
  // @rule R4 R5
  it("paginates only retrieved scope and resets search to five", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      data: {
        funds: Array.from({ length: 7 }, (_, i) => ({
          ...mockFund,
          coreVault: `core${i}`,
          profile: { ...mockFund.profile, name: i === 6 ? "second" : `first${i}` },
        })),
        holders: {},
        wallet: null,
      },
    });
    renderWithProviders(<InvestorListLoader view="explore" />);
    await waitFor(() => expect(screen.getByText("7 scope")).toBeInTheDocument());
    expect(screen.queryByText("first5")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("More"));
    expect(screen.getByText("first5")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Search"));
    expect(screen.getByText("1 scope")).toBeInTheDocument();
    expect(screen.queryByText("first0")).not.toBeInTheDocument();
  });
  // @rule R5
  it("ignores an old wallet result and never invents partial Portfolio totals", async () => {
    let resolve: (value: Awaited<ReturnType<typeof loadInvestorListAction>>) => void = () => {};
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = renderWithProviders(<InvestorListLoader view="holder" />);
    mocks.address = "0x0000000000000000000000000000000000000002";
    mocks.load.mockResolvedValue({
      ok: true,
      data: {
        funds: [mockFund],
        holders: { [mockFund.coreVault]: mockHolder },
        wallet: mocks.address,
      },
    });
    view.rerender(<InvestorListLoader view="holder" />);
    await waitFor(() => expect(screen.getByText("absent-total")).toBeInTheDocument());
    await act(async () => resolve({ ok: false, error: { status: 502, code: "V2_UNAVAILABLE" } }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  // @rule R5
  it("retains read error with retry instead of turning it into an empty portfolio", async () => {
    mocks.load.mockResolvedValue({ ok: false, error: { status: 502, code: "V2_UNAVAILABLE" } });
    renderWithProviders(<InvestorListLoader view="holder" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  });
  // @rule R5
  it("keeps public rows but rejects badges from another server wallet", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      data: {
        funds: [mockFund],
        holders: { [mockFund.coreVault]: mockHolder },
        wallet: "0x0000000000000000000000000000000000000002",
      },
    });
    renderWithProviders(<InvestorListLoader view="explore" />);
    await waitFor(() => expect(screen.getByText("0 owned / 0 invested")).toBeInTheDocument());
    expect(screen.getByText(mockFund.profile.name)).toBeInTheDocument();
  });
  // @rule R5
  it("keeps closed income and payout pending rows exclusively active", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      data: {
        funds: [{ ...mockFund, state: "Closed" }],
        holders: {
          [mockFund.coreVault]: {
            ...mockHolder,
            value: "0",
            shares: "0",
            incomeOwed: "1",
            payout: { ...mockHolder.payout, open: true },
          },
        },
        wallet: mockWallet,
      },
    });
    renderWithProviders(<InvestorListLoader view="holder" />);
    await waitFor(() => expect(screen.getByText("1 active / 0 exited")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Closed"));
    expect(screen.getByText("1 active / 0 exited")).toBeInTheDocument();
  });
});
