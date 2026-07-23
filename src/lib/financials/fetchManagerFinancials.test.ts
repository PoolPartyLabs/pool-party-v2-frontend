/**
 * @id PP-CORE-LIB-047
 * @name fetchManagerFinancials — tests
 *
 * Behavior: reads the analytics /manager/:addr/financials endpoint, returns the parsed payload on
 * success and `null` on any empty/missing/outage (console keeps the legacy path). An outage is
 * observed before degrading; a clean empty is not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsFetch = vi.fn();
const observeAnalyticsFailure = vi.fn();

vi.mock("@/lib/analytics-api/client", () => ({
  analyticsFetch: (...args: unknown[]) => analyticsFetch(...args),
}));
vi.mock("@/lib/analytics-api/observeFailure", () => ({
  observeAnalyticsFailure: (...args: unknown[]) => observeAnalyticsFailure(...args),
}));

import { AnalyticsError } from "@/lib/analytics-api/errors";
import { fetchManagerFinancials } from "./fetchManagerFinancials";

const ADDR = "0xdef0000000000000000000000000000000000001";

const validPayload = {
  address: ADDR,
  aum: 392_480,
  aumChange30dPct: 4.2,
  aumCoverage: null,
  netInflows30d: null,
  yieldGenerated: 48_200,
  performanceFees: 8_420.1,
  performanceFees30d: null,
  activeInvestors: 1_980,
  totalInvestors: 2_140,
  charts: { aumSeries: [], flowsDaily: [] },
  last_updated: { ledger: null, pool_snapshot: null },
};

afterEach(() => {
  analyticsFetch.mockReset();
  observeAnalyticsFailure.mockReset();
});

describe("fetchManagerFinancials", () => {
  it("hits the /manager/:addr/financials endpoint and returns the parsed payload", async () => {
    analyticsFetch.mockResolvedValue(validPayload);
    const result = await fetchManagerFinancials(ADDR);
    expect(analyticsFetch).toHaveBeenCalledWith(
      `analytics/manager/${ADDR}/financials`,
      expect.objectContaining({ schema: expect.anything() }),
    );
    expect(result?.aum).toBe(392_480);
    expect(result?.netInflows30d).toBeNull();
  });

  it("returns null on a 204/empty response (silent)", async () => {
    analyticsFetch.mockResolvedValue(null);
    expect(await fetchManagerFinancials(ADDR)).toBeNull();
    expect(observeAnalyticsFailure).not.toHaveBeenCalled();
  });

  it("observes the outage and returns null when the read throws", async () => {
    analyticsFetch.mockRejectedValue(new AnalyticsError(500, "SYSTEM_INTERNAL", "boom"));
    expect(await fetchManagerFinancials(ADDR)).toBeNull();
    expect(observeAnalyticsFailure).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: `analytics/manager/${ADDR}/financials`, key: ADDR }),
    );
  });
});
