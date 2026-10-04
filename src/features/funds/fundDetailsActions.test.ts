import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFund, mockHolder } from "@/mocks/data/v2Funds";

const mocks = vi.hoisted(() => ({
  enabled: true,
  wallet: `0x${"4".repeat(40)}`,
  owner: vi.fn(),
  fund: vi.fn(),
  holder: vi.fn(),
}));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => mocks.enabled }));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: async () => mocks.wallet,
  getAuthHeader: async () => ({}),
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.owner }));
vi.mock("@/lib/api/v2/funds", () => ({ readFund: mocks.fund, readHolder: mocks.holder }));

import { loadPersonalFundDetailsAction, loadPublicFundDetailsAction } from "./fundDetailsActions";

describe("investor Details read boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.owner.mockResolvedValue({ walletAddress: mocks.wallet });
    mocks.fund.mockResolvedValue(mockFund);
    mocks.holder.mockResolvedValue(mockHolder);
  });
  it("keeps a public read independent of a holder/session failure", async () => {
    mocks.owner.mockRejectedValue(new Error("unavailable"));
    expect(await loadPublicFundDetailsAction(mockFund.coreVault)).toMatchObject({
      ok: true,
      fund: mockFund,
    });
    expect(await loadPersonalFundDetailsAction(mockFund.coreVault)).toMatchObject({ ok: false });
    expect(mocks.holder).not.toHaveBeenCalled();
  });
  it("reads only the verified server wallet's holder", async () => {
    expect(await loadPersonalFundDetailsAction(mockFund.coreVault)).toMatchObject({
      ok: true,
      data: { wallet: mocks.wallet },
    });
    expect(mocks.holder).toHaveBeenCalledWith(mockFund.coreVault, mocks.wallet);
    mocks.owner.mockResolvedValue({ walletAddress: `0x${"8".repeat(40)}` });
    mocks.holder.mockClear();
    expect(await loadPersonalFundDetailsAction(mockFund.coreVault)).toMatchObject({
      ok: false,
      error: { code: "V2_SESSION" },
    });
    expect(mocks.holder).not.toHaveBeenCalled();
  });
  it("rejects wrong public identity, malformed core and disabled flag", async () => {
    mocks.fund.mockResolvedValue({ ...mockFund, coreVault: `0x${"8".repeat(40)}` });
    expect(await loadPublicFundDetailsAction(mockFund.coreVault)).toMatchObject({ ok: false });
    mocks.fund.mockClear();
    expect(await loadPublicFundDetailsAction("bad")).toMatchObject({ ok: false });
    expect(mocks.fund).not.toHaveBeenCalled();
    mocks.enabled = false;
    expect(await loadPublicFundDetailsAction(mockFund.coreVault)).toMatchObject({ ok: false });
    expect(await loadPersonalFundDetailsAction(mockFund.coreVault)).toMatchObject({ ok: false });
    expect(mocks.holder).not.toHaveBeenCalled();
  });
});
