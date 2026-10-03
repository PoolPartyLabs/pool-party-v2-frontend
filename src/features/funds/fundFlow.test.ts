import { describe, expect, it, vi } from "vitest";
import { mockFund, mockFundBuild } from "@/mocks/data/v2Funds";
import { approveAndRebuild, ensureFreshValuation } from "./fundFlow";

describe("investor fund flows", () => {
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
