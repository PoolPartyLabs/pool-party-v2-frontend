import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  position: vi.fn(),
  manager: vi.fn(),
  transit: vi.fn(),
}));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}));
vi.mock("@/lib/hooks/useContractFamily", () => ({
  useContractFamily: () => ({ family: "v2", hydrated: true }),
}));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: "holder" }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({ useSiweSession: () => ({ isSignedIn: true }) }));
vi.mock("./fundActions", () => ({
  loadFundAction: mocks.load,
  loadFundManagerAction: mocks.manager,
  loadFundPositionAction: mocks.position,
  loadFundTransitAction: mocks.transit,
}));
vi.mock("./FundActionsPanel", () => ({ FundActionsPanel: () => <p>investor-controls</p> }));

import { mockFund, mockHolder } from "@/mocks/data/v2Funds";
import { FundDetail } from "./FundDetail";

describe("fund detail views", () => {
  it("R2 maps Share Price at 24 decimals and NAV at six without mixing V1", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      data: { fund: mockFund, holder: mockHolder, wallet: `0x${"4".repeat(40)}` },
    });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    expect(await screen.findByRole("heading", { name: "Balanced Income" })).toBeInTheDocument();
    expect(screen.getByText("1 USDC")).toBeInTheDocument();
    expect(screen.getByText("1000000 USDC")).toBeInTheDocument();
    expect(screen.getByText("Income owed")).toBeInTheDocument();
    expect(screen.getByText("investor-controls")).toBeInTheDocument();
  });
  it("R7 renders dormant failures with retry rather than exposing raw upstream messages", async () => {
    mocks.load.mockResolvedValue({ ok: false, error: { status: 503, code: "V2_UNAVAILABLE" } });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
  // @rule R4 @rule R5
  it("links deployments, manager and lifecycle history on the selected position chain", async () => {
    const hash = `0x${"d".repeat(64)}`;
    mocks.load.mockResolvedValue({
      ok: true,
      data: { fund: mockFund, holder: mockHolder, wallet: `0x${"4".repeat(40)}` },
    });
    mocks.position.mockResolvedValue({
      ok: true,
      data: {
        protocolVersion: "v2",
        position: null,
        history: {
          protocolVersion: "v2",
          complete: true,
          events: [
            {
              protocolVersion: "v2",
              type: "opened",
              timestamp: "2026-10-04",
              transactionHash: hash,
              adapter: mockFund.manager,
            },
          ],
        },
      },
    });
    renderWithProviders(<FundDetail core={mockFund.coreVault} />);
    await screen.findByRole("heading", { name: "Balanced Income" });
    const addresses = screen.getAllByRole("link", { name: mockFund.coreVault });
    expect(addresses.map((link) => link.getAttribute("href"))).toContain(
      `https://arbiscan.io/address/${mockFund.coreVault}`,
    );
    expect(addresses.map((link) => link.getAttribute("href"))).toContain(
      `https://robinhoodchain.blockscout.com/address/${mockFund.coreVault}`,
    );
    const history = screen.getAllByRole("button", { name: "Position history" });
    const robinhood = history[1];
    if (!robinhood) throw new Error("missing Robinhood position");
    await userEvent.click(robinhood);
    expect(await screen.findByRole("link", { name: hash })).toHaveAttribute(
      "href",
      `https://robinhoodchain.blockscout.com/tx/${hash}`,
    );
    await waitFor(() =>
      expect(mocks.position).toHaveBeenCalledWith(mockFund.coreVault, 4663, expect.any(String)),
    );
  });
});
