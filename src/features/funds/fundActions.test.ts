import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wallet: `0x${"1".repeat(40)}`,
  enabled: true,
  request: vi.fn(),
  readFund: vi.fn(),
  readFunds: vi.fn(),
  readHistory: vi.fn(),
  readBalances: vi.fn(),
  readTransits: vi.fn(),
  owner: vi.fn(),
  solanaFetch: vi.fn(),
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
  readFundHistory: mocks.readHistory,
  readHolder: vi.fn(),
  readBalances: mocks.readBalances,
  readPosition: vi.fn(),
  readTransit: vi.fn(),
  readTransits: mocks.readTransits,
}));
vi.mock("@/lib/api/v2/solanaFetch", () => ({ solanaFetch: mocks.solanaFetch }));

import { ApiError } from "@/lib/api/errors";
import { fundViewSchema } from "@/lib/api/v2/fundSchemas";
import { mockFund, mockFundBuild } from "@/mocks/data/v2Funds";
import fund6 from "./fixtures/fund6Detail.json";
import {
  buildFundAction,
  loadFundHistoryAction,
  loadFundManagerAction,
  loadFundsAction,
  pollFundReportAction,
  refreshSolanaReportAction,
  startFundReportAction,
} from "./fundActions";

describe("fund server action safety", () => {
  it("loads public fund-wide history without trading or position-history requests", async () => {
    mocks.readHistory.mockResolvedValue({
      coreVault: mockFund.coreVault,
      events: [],
      nextCursor: null,
      indexing: [],
    });
    expect(await loadFundHistoryAction(mockFund.coreVault)).toMatchObject({ ok: true });
    expect(mocks.readHistory).toHaveBeenCalledWith(mockFund.coreVault, undefined);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("rejects another fund's history and malformed cursors", async () => {
    mocks.readHistory.mockResolvedValue({ coreVault: `0x${"9".repeat(40)}` });
    expect(await loadFundHistoryAction(mockFund.coreVault)).toMatchObject({ ok: false });
    mocks.readHistory.mockClear();
    expect(await loadFundHistoryAction(mockFund.coreVault, "bad")).toMatchObject({ ok: false });
    expect(mocks.readHistory).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.wallet = `0x${"1".repeat(40)}`;
    mocks.owner.mockResolvedValue({ walletAddress: mocks.wallet });
    mocks.readFund.mockRejectedValue(new ApiError(503, "V2_UNAVAILABLE", "unavailable"));
  });
  it("R2 enriches discovery identities with fund details", async () => {
    const { mandate: _mandate, sharePrice: _price, ...identity } = mockFund;
    mocks.readFunds.mockResolvedValue({ funds: [identity] });
    mocks.readFund.mockResolvedValue(mockFund);
    const result = await loadFundsAction("explore");
    expect(result).toMatchObject({
      ok: true,
      data: { funds: [{ sharePrice: mockFund.sharePrice }] },
    });
    expect(mocks.readFund).toHaveBeenCalledWith(mockFund.coreVault);
  });
  it("R2 keeps an identity when its detail is unavailable", async () => {
    mocks.readFunds.mockResolvedValue({ funds: [mockFund] });
    mocks.readFund.mockRejectedValue(new ApiError(503, "V2_UNAVAILABLE", "unavailable"));
    expect(await loadFundsAction("explore")).toMatchObject({
      ok: true,
      data: { funds: [mockFund] },
    });
  });
  it("R3 filters by authoritative detail manager, not profile presentation", async () => {
    mocks.readFunds.mockResolvedValue({ funds: [{ ...mockFund, manager: mocks.wallet }] });
    mocks.readFund.mockResolvedValue({
      ...mockFund,
      manager: `0x${"8".repeat(40)}`,
      profile: { manager: mocks.wallet },
    });
    expect(await loadFundsAction("manager")).toMatchObject({ ok: true, data: { funds: [] } });
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
  it("R3 rejects forged sessions before manager reads and investor builds", async () => {
    mocks.owner.mockRejectedValue(new ApiError(401, "V2_SESSION", "untrusted"));
    expect(await loadFundsAction("manager")).toMatchObject({ ok: false });
    expect(
      await buildFundAction(mockFund.coreVault, { action: "deposit", amount: "1" }),
    ).toMatchObject({ ok: false });
    expect(mocks.readFunds).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("R6 repeated polls do not extend a pending job cache forever", async () => {
    const jobId = "00000000-0000-4000-8000-000000000042";
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(100_000);
      mocks.request.mockResolvedValue({
        protocolVersion: "v2",
        core: mockFund.coreVault,
        jobId,
        status: "pending",
      });
      await pollFundReportAction(mockFund.coreVault, jobId);
      now.mockReturnValue(110_000);
      await pollFundReportAction(mockFund.coreVault, jobId);
      now.mockReturnValue(116_000);
      mocks.request.mockResolvedValue({
        protocolVersion: "v2",
        core: mockFund.coreVault,
        jobId,
        status: "delivered",
      });
      expect(await pollFundReportAction(mockFund.coreVault, jobId)).toMatchObject({
        ok: true,
        data: { status: "delivered" },
      });
      expect(mocks.request).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
  it("R7 returns decoded deferred errors without RPC or admin material", async () => {
    mocks.request.mockRejectedValue(new ApiError(409, "V2_DEFERRED", "secret-rpc"));
    const result = await buildFundAction(mockFund.coreVault, {
      action: "request-income-withdrawal",
      maxLossBps: 100,
    });
    expect(result).toEqual({ ok: false, error: { status: 409, code: "V2_DEFERRED" } });
  });
  describe("POO-2262 v6 Funds", () => {
    const fund6View = fundViewSchema.parse(fund6.data);
    const fresh = {
      source: "solana",
      ageSeconds: 30,
      maxReportAge: 1600,
      usable: false,
      refreshing: true,
      jobId: "6f1c1a52-5d55-4c4e-9a43-0f3ad1b9d9a1",
      waitingOn: "solana-finality",
      retryAfterSeconds: 15,
    };
    it("asks the API key route for a fresh Solana report once per Fund per 15 s", async () => {
      const now = vi.spyOn(Date, "now");
      try {
        now.mockReturnValue(1_000_000);
        mocks.solanaFetch.mockResolvedValue(fresh);
        const core = fund6View.coreVault;
        const expected = {
          ok: true,
          data: { usable: false, refreshing: true, retryAfterSeconds: 15, jobId: fresh.jobId },
        };
        expect(await refreshSolanaReportAction(core)).toEqual(expected);
        expect(mocks.solanaFetch).toHaveBeenCalledWith(
          `/funds/${core}/solana/reports/fresh`,
          "POST",
          expect.anything(),
          {},
        );
        now.mockReturnValue(1_010_000);
        expect(await refreshSolanaReportAction(core)).toEqual(expected);
        expect(mocks.solanaFetch).toHaveBeenCalledOnce();
        now.mockReturnValue(1_016_000);
        await refreshSolanaReportAction(core);
        expect(mocks.solanaFetch).toHaveBeenCalledTimes(2);
        // The report broker and the admin key are never involved.
        expect(mocks.request).not.toHaveBeenCalled();
      } finally {
        now.mockRestore();
      }
    });
    it("refuses the refresh without a verified session or for a malformed core", async () => {
      mocks.owner.mockRejectedValue(new ApiError(401, "V2_SESSION", "untrusted"));
      expect(await refreshSolanaReportAction(`0x${"7".repeat(40)}`)).toMatchObject({ ok: false });
      mocks.owner.mockResolvedValue({ walletAddress: mocks.wallet });
      expect(await refreshSolanaReportAction("not-a-core")).toMatchObject({ ok: false });
      expect(mocks.solanaFetch).not.toHaveBeenCalled();
    });
    it("passes a builder's report wait through with its hint, not its message", async () => {
      // The shape fundRequest throws (FundRequestError): an ApiError with a validated `detail`.
      mocks.request.mockRejectedValue(
        Object.assign(new ApiError(409, "SOLANA_REPORT_REFRESHING", "secret upstream text"), {
          detail: { retryAfterSeconds: 15, jobId: fresh.jobId },
        }),
      );
      expect(
        await buildFundAction(fund6View.coreVault, { action: "deposit", amount: "50000000" }),
      ).toEqual({
        ok: false,
        error: {
          status: 409,
          code: "SOLANA_REPORT_REFRESHING",
          retryAfterSeconds: 15,
          jobId: fresh.jobId,
        },
      });
    });
    it("reads manager balances on the EVM chains only", async () => {
      mocks.wallet = fund6View.manager;
      mocks.owner.mockResolvedValue({ walletAddress: fund6View.manager });
      mocks.readFund.mockResolvedValue(fund6View);
      mocks.readTransits.mockResolvedValue({ items: [] });
      mocks.readBalances.mockResolvedValue({ chainId: "42161" });
      expect(await loadFundManagerAction(fund6View.coreVault)).toMatchObject({ ok: true });
      expect(mocks.readBalances.mock.calls.map(([, chain]) => chain)).toEqual([42161, 4663]);
    });
  });
});
