import { describe, expect, it, vi } from "vitest";
import { type FundView, fundViewSchema } from "@/lib/api/v2/fundSchemas";
import { mockFund, mockFundBuild } from "@/mocks/data/v2Funds";
import fund6 from "./fixtures/fund6Detail.json";
import {
  approveAndRebuild,
  ensureFreshValuation,
  REPORT_WAIT_LIMIT_SECONDS,
  reportWaitSeconds,
  retryReportWaits,
  solanaRefreshPort,
} from "./fundFlow";

describe("investor fund flows", () => {
  // @rule R4
  it("stops an expired report job without assuming a fresh valuation", async () => {
    const poll = vi.fn().mockResolvedValue("expired");
    await expect(
      ensureFreshValuation({
        read: async () => ({ ...mockFund, lastReport: null }),
        start: async () => "job",
        poll,
        wait: async () => {},
        active: () => true,
        refreshing: vi.fn(),
      }),
    ).rejects.toThrow("V2_UNAVAILABLE");
    expect(poll).toHaveBeenCalledOnce();
  });
  it("R6 cancellation after a poll blocks a stale valuation reread", async () => {
    let active = true;
    const read = vi.fn().mockResolvedValue({ ...mockFund, lastReport: null });
    await expect(
      ensureFreshValuation({
        read,
        start: async () => "job",
        poll: async () => {
          active = false;
          return "delivered";
        },
        wait: async () => {},
        active: () => active,
        refreshing: vi.fn(),
      }),
    ).rejects.toThrow("V2_CANCELED");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("R6 failed jobs stop without a mint or burn builder", async () => {
    await expect(
      ensureFreshValuation({
        read: async () => ({ ...mockFund, lastReport: null }),
        start: async () => "job",
        poll: async () => "failed",
        wait: async () => {},
        active: () => true,
        refreshing: vi.fn(),
      }),
    ).rejects.toThrow("V2_UNAVAILABLE");
  });
  it("R6 bounded pending jobs time out rather than polling forever", async () => {
    const poll = vi.fn().mockResolvedValue("pending");
    await expect(
      ensureFreshValuation({
        read: async () => ({ ...mockFund, lastReport: null }),
        start: async () => "job",
        poll,
        wait: async () => {},
        active: () => true,
        refreshing: vi.fn(),
      }),
    ).rejects.toThrow("V2_UNAVAILABLE");
    expect(poll).toHaveBeenCalledTimes(120);
  });
  it("R6 skips the report job only when the accepted report is fresh", async () => {
    const start = vi.fn();
    await ensureFreshValuation({
      read: async () => mockFund,
      start,
      poll: vi.fn(),
      wait: vi.fn(),
      active: () => true,
      refreshing: vi.fn(),
    });
    expect(start).not.toHaveBeenCalled();
  });
  it("R6 delivered rereads freshness rather than assuming success", async () => {
    const stale = { ...mockFund, lastReport: null };
    const read = vi.fn().mockResolvedValue(stale);
    await expect(
      ensureFreshValuation({
        read,
        start: async () => "job",
        poll: async () => "delivered",
        wait: async () => {},
        active: () => true,
        refreshing: vi.fn(),
      }),
    ).rejects.toThrow("StaleSpokeReport");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("R6 cancels polling when fund or wallet changes", async () => {
    let active = true;
    const poll = vi.fn();
    await expect(
      ensureFreshValuation({
        read: async () => ({ ...mockFund, lastReport: null }),
        start: async () => "job",
        poll,
        wait: async () => {
          active = false;
        },
        active: () => active,
        refreshing: vi.fn(),
      }),
    ).rejects.toThrow("V2_CANCELED");
    expect(poll).not.toHaveBeenCalled();
  });
  it("R4 waits for approval receipt then rebuilds and returns authoritative preview", async () => {
    const built = mockFundBuild({ action: "deposit" });
    const order: string[] = [];
    const result = await approveAndRebuild(
      { ...built, preview: null, nextAction: "approval" },
      async () => {
        order.push("receipt");
      },
      async () => {
        order.push("rebuild");
        return built;
      },
      () => true,
    );
    expect(order).toEqual(["receipt", "rebuild"]);
    expect(result.preview).toEqual(built.preview);
  });
  it("R4 failed approval never rebuilds or broadcasts deposit", async () => {
    const rebuild = vi.fn();
    await expect(
      approveAndRebuild(
        { ...mockFundBuild({ action: "deposit" }), nextAction: "approval" },
        async () => {
          throw new Error("reverted");
        },
        rebuild,
        () => true,
      ),
    ).rejects.toThrow("reverted");
    expect(rebuild).not.toHaveBeenCalled();
  });
});

/** The live v6 Fund with its gate and per-spoke `usable` set for one scenario. */
function v6(reportsUsable: boolean, robinhood: boolean, solana: boolean): FundView {
  const fund = fundViewSchema.parse(fund6.data);
  return {
    ...fund,
    reportsUsable,
    spokes: fund.spokes?.map((spoke) =>
      spoke.reportFreshness
        ? {
            ...spoke,
            reportFreshness: {
              ...spoke.reportFreshness,
              usable: spoke.chainId === "1" ? solana : robinhood,
            },
          }
        : spoke,
    ),
  };
}
function ports(reads: FundView[], active = () => true) {
  // Each read answers the next scenario; the last one repeats.
  const queue = [...reads];
  const read = vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]) as FundView);
  return {
    read,
    start: vi.fn(async () => "job"),
    poll: vi.fn(
      async (_jobId: string): Promise<"pending" | "delivered" | "expired" | "failed"> =>
        "delivered",
    ),
    wait: vi.fn(async (_seconds: number) => {}),
    active,
    refreshing: vi.fn(),
    refreshSolana: vi.fn(async (): Promise<number | null> => 15),
  };
}

describe("POO-2262 v6 report gate (API contract §3.9)", () => {
  it("proceeds at once while reportsUsable is true, without any report call", async () => {
    const port = ports([v6(true, true, true)]);
    const fund = await ensureFreshValuation(port);
    expect(fund.reportsUsable).toBe(true);
    expect(port.refreshSolana).not.toHaveBeenCalled();
    expect(port.start).not.toHaveBeenCalled();
    expect(port.wait).not.toHaveBeenCalled();
  });
  it("asks for a fresh Solana report, waits its hint and polls the detail until usable", async () => {
    const port = ports([v6(false, true, false), v6(false, true, false), v6(true, true, true)]);
    port.refreshSolana.mockResolvedValueOnce(30).mockResolvedValueOnce(null);
    const fund = await ensureFreshValuation(port);
    expect(fund.reportsUsable).toBe(true);
    expect(port.refreshSolana).toHaveBeenCalledTimes(2);
    expect(port.wait.mock.calls.map(([seconds]) => seconds)).toEqual([30, 15]);
    expect(port.read).toHaveBeenCalledTimes(3);
    expect(port.refreshing).toHaveBeenCalled();
    // Never the admin report route for a v6 Fund.
    expect(port.start).not.toHaveBeenCalled();
    expect(port.poll).not.toHaveBeenCalled();
  });
  it("only polls when the stale spoke is Robinhood: the keeper refreshes it on its own cycle", async () => {
    const port = ports([v6(false, false, true), v6(false, false, true), v6(true, true, true)]);
    await ensureFreshValuation(port);
    expect(port.refreshSolana).not.toHaveBeenCalled();
    expect(port.start).not.toHaveBeenCalled();
    expect(port.wait.mock.calls.map(([seconds]) => seconds)).toEqual([15, 15]);
  });
  it("refreshes Solana when the detail does not say which spoke is stale", async () => {
    const port = ports([{ ...v6(false, false, false), spokes: undefined }, v6(true, true, true)]);
    await ensureFreshValuation(port);
    expect(port.refreshSolana).toHaveBeenCalledOnce();
  });
  it("gives up after about ten minutes with the report-wait code", async () => {
    const port = ports([v6(false, false, true)]);
    await expect(ensureFreshValuation(port)).rejects.toThrow("SPOKE_REPORT_STALE");
    const waited = port.wait.mock.calls.reduce((sum, [seconds]) => sum + seconds, 0);
    expect(waited).toBe(REPORT_WAIT_LIMIT_SECONDS);
  });
  it("stops when the Fund or wallet changes during a wait", async () => {
    let active = true;
    const port = ports([v6(false, true, false)], () => active);
    port.wait.mockImplementation(async () => {
      active = false;
    });
    await expect(ensureFreshValuation(port)).rejects.toThrow("V2_CANCELED");
    expect(port.read).toHaveBeenCalledOnce();
  });
  it("keeps the single-report gate for an EVM-only Fund even when reportsUsable is served", async () => {
    const port = ports([{ ...mockFund, lastReport: null, reportsUsable: false }]);
    port.poll.mockResolvedValue("failed");
    await expect(ensureFreshValuation(port)).rejects.toThrow("V2_UNAVAILABLE");
    expect(port.start).toHaveBeenCalledOnce();
    expect(port.refreshSolana).not.toHaveBeenCalled();
    expect(port.wait).toHaveBeenCalledWith(15);
  });
});

describe("POO-2262 builder report waits", () => {
  const live = { active: () => true, refreshing: vi.fn() };
  it("waits the 409 hint and rebuilds instead of failing", async () => {
    const wait = vi.fn(async (_seconds: number) => {});
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "SOLANA_REPORT_REFRESHING", retryAfterSeconds: 30 },
      })
      .mockResolvedValueOnce({ ok: false, error: { code: "SPOKE_REPORT_STALE" } })
      .mockResolvedValueOnce({ ok: true, data: "built" });
    await expect(retryReportWaits(attempt, { ...live, wait })).resolves.toBe("built");
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([seconds]) => seconds)).toEqual([30, 15]);
    expect(live.refreshing).toHaveBeenCalled();
  });
  it("throws any other refusal at once, and a report wait past the limit", async () => {
    const wait = vi.fn(async (_seconds: number) => {});
    await expect(
      retryReportWaits(async () => ({ ok: false, error: { code: "FundNotOpen" } }), {
        ...live,
        wait,
      }),
    ).rejects.toThrow("FundNotOpen");
    expect(wait).not.toHaveBeenCalled();
    await expect(
      retryReportWaits(
        async () => ({ ok: false, error: { code: "SPOKE_REPORT_STALE", retryAfterSeconds: 60 } }),
        { ...live, wait },
      ),
    ).rejects.toThrow("SPOKE_REPORT_STALE");
    expect(wait).toHaveBeenCalledTimes(10);
  });
  it("bounds one wait between 5 and 60 seconds", () => {
    expect(reportWaitSeconds(undefined)).toBe(15);
    expect(reportWaitSeconds(0)).toBe(5);
    expect(reportWaitSeconds(30)).toBe(30);
    expect(reportWaitSeconds(3600)).toBe(60);
  });
  it("turns a throttled or hinted refresh refusal into one more wait", async () => {
    await expect(
      solanaRefreshPort(async () => ({ ok: true, data: { retryAfterSeconds: 15 } }))(),
    ).resolves.toBe(15);
    await expect(
      solanaRefreshPort(async () => ({
        ok: false,
        error: { status: 429, code: "V2_RATE_LIMITED" },
      }))(),
    ).resolves.toBeNull();
    await expect(
      solanaRefreshPort(async () => ({
        ok: false,
        error: { status: 503, code: "SOLANA_LOOKUP_TABLE_WARMING", retryAfterSeconds: 15 },
      }))(),
    ).resolves.toBe(15);
    await expect(
      solanaRefreshPort(async () => ({ ok: false, error: { status: 401, code: "V2_SESSION" } }))(),
    ).rejects.toThrow("V2_SESSION");
  });
});
