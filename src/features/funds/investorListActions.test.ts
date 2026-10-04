import { describe, expect, it, vi } from "vitest";
import { mockFund, mockHolder, mockWallet } from "@/mocks/data/v2Funds";

const mocks = vi.hoisted(() => ({ load: vi.fn(), detail: vi.fn() }));
vi.mock("./fundActions", () => ({ loadFundsAction: mocks.load }));
vi.mock("@/lib/api/v2/funds", () => ({ readFund: mocks.detail }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));

import { loadInvestorListAction } from "./investorListActions";

describe("investor list reads", () => {
  // @rule R4
  it("enriches holder metadata without changing holder identity or inventing cursor inputs", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      data: {
        funds: [mockFund],
        holders: { [mockFund.coreVault]: mockHolder },
        wallet: mockWallet,
      },
    });
    mocks.detail.mockResolvedValue({ ...mockFund, state: "Closed" });
    const result = await loadInvestorListAction("holder");
    expect(mocks.load).toHaveBeenCalledWith("holder");
    expect(result.ok && result.data.funds[0]?.state).toBe("Closed");
  });
  // @rule R5
  it("preserves holder read failure rather than producing partial aggregate success", async () => {
    mocks.load.mockResolvedValue({
      ok: false,
      error: { status: 502, code: "V2_INVALID_RESPONSE" },
    });
    expect(await loadInvestorListAction("holder")).toEqual({
      ok: false,
      error: { status: 502, code: "V2_INVALID_RESPONSE" },
    });
  });
});
