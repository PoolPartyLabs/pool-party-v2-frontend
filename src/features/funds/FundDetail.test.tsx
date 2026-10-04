import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
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
  loadFundManagerAction: vi.fn(),
  loadFundPositionAction: vi.fn(),
  loadFundTransitAction: vi.fn(),
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
});
