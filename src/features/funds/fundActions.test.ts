import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wallet: `0x${"1".repeat(40)}`,
  enabled: true,
  request: vi.fn(),
  readFund: vi.fn(),
  readFunds: vi.fn(),
  owner: vi.fn(),
}));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => mocks.enabled }));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: async () => mocks.wallet,
  getAuthHeader: async () => ({ Authorization: "Bearer private" }),
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.owner }));
vi.mock("@/lib/api/v2/fundTransport", () => ({ fundRequest: mocks.request }));
vi.mock("@/lib/api/v2/funds", () => ({
  readFund: mocks.readFund,
  readFunds: mocks.readFunds,
  readHolder: vi.fn(),
  readBalances: vi.fn(),
  readPosition: vi.fn(),
  readTransit: vi.fn(),
  readTransits: vi.fn(),
}));

import { ApiError } from "@/lib/api/errors";
import { mockFund, mockFundBuild } from "@/mocks/data/v2Funds";
import { buildFundAction, loadFundsAction, startFundReportAction } from "./fundActions";

describe("fund server action safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.wallet = `0x${"1".repeat(40)}`;
    mocks.owner.mockResolvedValue({ walletAddress: mocks.wallet });
  });
  it("R4 builds with session-derived from/holder and preserves authoritative previews", async () => {
    mocks.request.mockResolvedValue(mockFundBuild({ action: "deposit" }));
    const result = await buildFundAction(mockFund.coreVault, {
      action: "deposit",
      amount: "2000000",
      minShares: "1000000000000000000",
    });
    expect(result.ok).toBe(true);
    expect(mocks.request.mock.calls[0]?.[2]).toMatchObject({
      from: mocks.wallet,
      holder: mocks.wallet,
      side: "hub",
    });
  });
  it("R4 refuses a builder transaction for another wallet", async () => {
    const built = mockFundBuild({ action: "deposit" });
    const transaction = built.transactions[0];
    if (!transaction) throw new Error("missing fixture transaction");
    built.transactions[0] = { ...transaction, from: `0x${"4".repeat(40)}` };
    mocks.request.mockResolvedValue(built);
    expect(
      await buildFundAction(mockFund.coreVault, { action: "deposit", amount: "2000000" }),
    ).toMatchObject({ ok: false, error: { code: "V2_SESSION" } });
  });
  it("R1 prevents all upstream calls with the preview flag off", async () => {
    mocks.enabled = false;
    expect(await loadFundsAction("explore")).toMatchObject({ ok: false });
    expect(mocks.readFunds).not.toHaveBeenCalled();
  });
  it("R3 manager list excludes other managers", async () => {
    mocks.readFunds.mockResolvedValue({
      funds: [mockFund, { ...mockFund, manager: `0x${"4".repeat(40)}` }],
    });
    const result = await loadFundsAction("manager");
    expect(result.ok && result.data.funds).toEqual([mockFund]);
  });
  it("R6 report broker verifies the signed session upstream before starting a job", async () => {
    mocks.owner.mockRejectedValue(new ApiError(401, "V2_SESSION", "untrusted"));
    expect(await startFundReportAction(mockFund.coreVault)).toMatchObject({ ok: false });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("R7 returns decoded deferred errors without RPC or admin material", async () => {
    mocks.request.mockRejectedValue(new ApiError(409, "V2_DEFERRED", "secret-rpc"));
    const result = await buildFundAction(mockFund.coreVault, {
      action: "request-income-withdrawal",
      maxLossBps: 100,
    });
    expect(result).toEqual({ ok: false, error: { status: 409, code: "V2_DEFERRED" } });
  });
});
