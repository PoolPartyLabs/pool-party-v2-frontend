/**
 * @id PP-CORE (POO-366)
 * @name fetchManagerAumTimeseries — tests
 * @implements-rules-version v1
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsError } from "@/lib/analytics-api/client";

const analyticsFetch = vi.fn();
vi.mock("@/lib/analytics-api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics-api/client")>();
  return { ...actual, analyticsFetch: (...args: unknown[]) => analyticsFetch(...args) };
});

const observeAnalyticsFailure = vi.fn();
vi.mock("@/lib/analytics-api/observeFailure", () => ({
  observeAnalyticsFailure: (...args: unknown[]) => observeAnalyticsFailure(...args),
}));

async function importFetch() {
  vi.resetModules();
  return import("./fetchWalletTimeseries");
}

beforeEach(() => {
  analyticsFetch.mockReset();
  observeAnalyticsFailure.mockReset();
});

describe("fetchInvestorPortfolioTimeseries", () => {
  // POO-645 R1/R2: the LIVE contract is a bare array (matches manager_aum). The picker must read
  // it directly; the legacy { series } object stays tolerated below.
  it("[POO-645 R1] returns the series when investor_portfolio is the live bare-array contract", async () => {
    analyticsFetch.mockResolvedValueOnce({
      manager_aum: [{ date: "2026-04-06T00:00:00.000Z", value_usd: 6.94 }],
      investor_portfolio: [
        { date: "2026-04-06T00:00:00.000Z", value_usd: 4.59 },
        { date: "2026-04-07T00:00:00.000Z", value_usd: 4.61 },
      ],
    });
    const { fetchInvestorPortfolioTimeseries } = await importFetch();

    const series = await fetchInvestorPortfolioTimeseries("0xinv");

    expect(series).toHaveLength(2);
    expect(series[0]).toEqual({ date: "2026-04-06T00:00:00.000Z", value_usd: 4.59 });
    expect(observeAnalyticsFailure).not.toHaveBeenCalled();
  });

  // [R1] The per-investor value series is read from investor_portfolio.series.
  it("[R1] returns the investor_portfolio.series from the wallet timeseries path", async () => {
    analyticsFetch.mockResolvedValueOnce({
      manager_aum: [{ date: "2026-06-01", value_usd: 50000 }],
      investor_portfolio: {
        series: [
          { date: "2026-06-19T00:00:00.000Z", value_usd: 100 },
          { date: "2026-06-20T00:00:00.000Z", value_usd: 110 },
        ],
      },
    });
    const { fetchInvestorPortfolioTimeseries } = await importFetch();

    const series = await fetchInvestorPortfolioTimeseries("0xinv");

    expect(series).toHaveLength(2);
    expect(series[0]).toEqual({ date: "2026-06-19T00:00:00.000Z", value_usd: 100 });
    expect(analyticsFetch).toHaveBeenCalledWith(
      "analytics/wallets/0xinv/timeseries",
      expect.objectContaining({ revalidate: 300 }),
    );
  });

  // [R2]/[R3] The stub shape (a { note } object, no series) is a clean empty, not an outage.
  it("[R2] returns [] for the pending stub (investor_portfolio without a series)", async () => {
    analyticsFetch.mockResolvedValueOnce({ investor_portfolio: { note: "pending" } });
    const { fetchInvestorPortfolioTimeseries } = await importFetch();
    expect(await fetchInvestorPortfolioTimeseries("0xinv")).toEqual([]);
  });

  it("[R2] returns [] when investor_portfolio is absent (new wallet) or a null response", async () => {
    analyticsFetch.mockResolvedValueOnce({ manager_aum: [] });
    const { fetchInvestorPortfolioTimeseries } = await importFetch();
    expect(await fetchInvestorPortfolioTimeseries("0xinv")).toEqual([]);
  });

  it("[R2] returns [] (graceful) when the upstream read throws", async () => {
    analyticsFetch.mockRejectedValueOnce(new Error("analytics down"));
    const { fetchInvestorPortfolioTimeseries } = await importFetch();
    expect(await fetchInvestorPortfolioTimeseries("0xinv")).toEqual([]);
  });

  // [R2] An outage must be observable, keyed by endpoint + wallet.
  it("[R2] observes the failure (endpoint + wallet key) when the upstream read throws", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(502, "SYSTEM_INTERNAL", "gateway"));
    const { fetchInvestorPortfolioTimeseries } = await importFetch();

    await fetchInvestorPortfolioTimeseries("0xinv");

    expect(observeAnalyticsFailure).toHaveBeenCalledOnce();
    expect(observeAnalyticsFailure).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "analytics/wallets/0xinv/timeseries", key: "0xinv" }),
    );
  });

  // [R2]/[R3] A new wallet with no history is expected, not an outage: do NOT observe.
  it("[R2] does NOT observe a clean stub/empty response", async () => {
    analyticsFetch.mockResolvedValueOnce({ investor_portfolio: { note: "pending" } });
    const { fetchInvestorPortfolioTimeseries } = await importFetch();

    expect(await fetchInvestorPortfolioTimeseries("0xinv")).toEqual([]);
    expect(observeAnalyticsFailure).not.toHaveBeenCalled();
  });
});

describe("fetchManagerAumTimeseries", () => {
  it("returns the manager_aum series from the wallet timeseries path", async () => {
    analyticsFetch.mockResolvedValueOnce({
      manager_aum: [
        { date: "2026-06-01", value_usd: 50000 },
        { date: "2026-06-02", value_usd: 51000 },
      ],
      investor_portfolio: { note: "pending" },
    });
    const { fetchManagerAumTimeseries } = await importFetch();

    const series = await fetchManagerAumTimeseries("0xmgr");

    expect(series).toHaveLength(2);
    expect(analyticsFetch).toHaveBeenCalledWith(
      "analytics/wallets/0xmgr/timeseries",
      expect.objectContaining({ revalidate: 300 }),
    );
  });

  it("returns [] when there is no manager_aum (non-manager wallet) or a null response", async () => {
    analyticsFetch.mockResolvedValueOnce({ investor_portfolio: { note: "pending" } });
    const { fetchManagerAumTimeseries } = await importFetch();
    expect(await fetchManagerAumTimeseries("0xmgr")).toEqual([]);
  });

  it("returns [] (graceful) when the upstream read throws", async () => {
    analyticsFetch.mockRejectedValueOnce(new Error("analytics down"));
    const { fetchManagerAumTimeseries } = await importFetch();
    expect(await fetchManagerAumTimeseries("0xmgr")).toEqual([]);
  });

  // [R2] An outage must be observable, keyed by endpoint + wallet.
  it("[R2] observes the failure (endpoint + wallet key) when the upstream read throws", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(502, "SYSTEM_INTERNAL", "gateway"));
    const { fetchManagerAumTimeseries } = await importFetch();

    await fetchManagerAumTimeseries("0xmgr");

    expect(observeAnalyticsFailure).toHaveBeenCalledOnce();
    expect(observeAnalyticsFailure).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "analytics/wallets/0xmgr/timeseries", key: "0xmgr" }),
    );
  });

  // [R3] A non-manager wallet / empty series is expected, not an outage: do NOT observe.
  it("[R3] does NOT observe a clean non-manager (empty manager_aum) response", async () => {
    analyticsFetch.mockResolvedValueOnce({ investor_portfolio: { note: "pending" } });
    const { fetchManagerAumTimeseries } = await importFetch();

    expect(await fetchManagerAumTimeseries("0xmgr")).toEqual([]);
    expect(observeAnalyticsFailure).not.toHaveBeenCalled();
  });
});
