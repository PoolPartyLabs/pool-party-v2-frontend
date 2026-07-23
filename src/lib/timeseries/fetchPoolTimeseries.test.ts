/**
 * @id PP-CORE (POO-366)
 * @name fetchPoolTimeseries — tests
 * @implements-rules-version v1
 *
 * Server-side pool AUM read: returns the series on success, and degrades to [] on empty, missing,
 * or any upstream error so the chart can fall back to its derived series.
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
  return import("./fetchPoolTimeseries");
}

beforeEach(() => {
  analyticsFetch.mockReset();
  observeAnalyticsFailure.mockReset();
});

describe("fetchPoolTimeseries", () => {
  it("returns the series and calls the pool timeseries path", async () => {
    analyticsFetch.mockResolvedValueOnce({
      series: [
        { date: "2026-06-01", value_usd: 1000 },
        { date: "2026-06-02", value_usd: 1100 },
      ],
    });
    const { fetchPoolTimeseries } = await importFetch();

    const series = await fetchPoolTimeseries("0xpool");

    expect(series).toHaveLength(2);
    expect(analyticsFetch).toHaveBeenCalledWith(
      "analytics/pools/0xpool/timeseries",
      expect.objectContaining({ revalidate: 300 }),
    );
  });

  // POO-782 @rule R1: a capped-period spark read carries `?period=1M`, so each spark pulls only the
  // trailing month instead of the full history series.
  it("[POO-782 R1] appends ?period=1M when a period is requested", async () => {
    analyticsFetch.mockResolvedValueOnce({ series: [] });
    const { fetchPoolTimeseries } = await importFetch();

    await fetchPoolTimeseries("0xpool", { period: "1M" });

    expect(analyticsFetch).toHaveBeenCalledWith(
      "analytics/pools/0xpool/timeseries?period=1M",
      expect.objectContaining({ revalidate: 300 }),
    );
  });

  // POO-782 hard constraint: the 1M-capped spark URL must be DISTINCT from the full-history detail-chart
  // URL, so the Next data-cache key splits and one never serves the other's payload. Locking the key
  // split at the fetcher boundary (the URL is the Next cache key) is the durable guard.
  it("[POO-782 cache-split] the capped spark URL differs from the full-history detail-chart URL", async () => {
    analyticsFetch.mockResolvedValue({ series: [] });
    const { fetchPoolTimeseries } = await importFetch();

    await fetchPoolTimeseries("0xpool"); // detail-chart: full history, no period
    await fetchPoolTimeseries("0xpool", { period: "1M" }); // spark: capped 1M

    const fullHistoryUrl = analyticsFetch.mock.calls[0]?.[0];
    const cappedSparkUrl = analyticsFetch.mock.calls[1]?.[0];
    expect(fullHistoryUrl).toBe("analytics/pools/0xpool/timeseries");
    expect(cappedSparkUrl).toBe("analytics/pools/0xpool/timeseries?period=1M");
    expect(cappedSparkUrl).not.toBe(fullHistoryUrl);
  });

  // The observe key stays the bare pool id (a period variant is the SAME pool for outage-observability),
  // and the endpoint logged is the parametrized one actually hit.
  it("[POO-782 R1] observes a capped-spark failure under the pool id with the parametrized endpoint", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(503, "SYSTEM_INTERNAL", "down"));
    const { fetchPoolTimeseries } = await importFetch();

    await fetchPoolTimeseries("0xpool", { period: "1M" });

    expect(observeAnalyticsFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "analytics/pools/0xpool/timeseries?period=1M",
        key: "0xpool",
      }),
    );
  });

  it("returns [] when the response is null or has no series", async () => {
    analyticsFetch.mockResolvedValueOnce(null);
    const { fetchPoolTimeseries } = await importFetch();
    expect(await fetchPoolTimeseries("0xpool")).toEqual([]);
  });

  it("returns [] (graceful fallback) when the upstream read throws", async () => {
    analyticsFetch.mockRejectedValueOnce(new Error("analytics down"));
    const { fetchPoolTimeseries } = await importFetch();
    expect(await fetchPoolTimeseries("0xpool")).toEqual([]);
  });

  // [R2] An outage must be observable, not silently swallowed to [].
  it("[R2] observes the failure (endpoint + pool key) when the upstream read throws", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(503, "SYSTEM_INTERNAL", "down"));
    const { fetchPoolTimeseries } = await importFetch();

    await fetchPoolTimeseries("0xpool");

    expect(observeAnalyticsFailure).toHaveBeenCalledOnce();
    expect(observeAnalyticsFailure).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "analytics/pools/0xpool/timeseries", key: "0xpool" }),
    );
  });

  // [R3] A clean 200-with-empty-series is expected, not an outage: do NOT observe.
  it("[R3] does NOT observe a clean empty-series response", async () => {
    analyticsFetch.mockResolvedValueOnce({ series: [] });
    const { fetchPoolTimeseries } = await importFetch();

    expect(await fetchPoolTimeseries("0xpool")).toEqual([]);
    expect(observeAnalyticsFailure).not.toHaveBeenCalled();
  });

  it("[R3] does NOT observe a null (no-series) response", async () => {
    analyticsFetch.mockResolvedValueOnce(null);
    const { fetchPoolTimeseries } = await importFetch();

    expect(await fetchPoolTimeseries("0xpool")).toEqual([]);
    expect(observeAnalyticsFailure).not.toHaveBeenCalled();
  });
});
