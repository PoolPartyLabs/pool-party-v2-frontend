/**
 * @id PP-CORE-LIB-046
 * @name fetchWalletFinancials — tests
 *
 * Behavior: reads the analytics /wallets/:addr/financials endpoint and validates it, returning the
 * parsed payload on success and `null` on any empty/missing/outage (so a caller keeps the legacy
 * /metrics path — POO-936 [R6] shadow). An outage is observed before degrading; a clean empty is not.
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
import { fetchWalletFinancials } from "./fetchWalletFinancials";

const ADDR = "0xabc0000000000000000000000000000000000001";

const validPayload = {
  address: ADDR,
  earnedToday: null,
  feesEarned: { "24h": null, "7d": null, "30d": null },
  invested: 10_000,
  totalYield: 812.19,
  portfolioValue: 10_812.19,
  claimableGross: 42.5,
  coverage: null,
  provisional: false,
  byStrategy: {},
  last_updated: { ledger: null, investor_snapshot: null, pool_snapshot: null, price_cache: null },
  _assertions: { windowClampActivations: 0 },
};

afterEach(() => {
  analyticsFetch.mockReset();
  observeAnalyticsFailure.mockReset();
});

describe("fetchWalletFinancials", () => {
  it("hits the /wallets/:addr/financials endpoint and returns the parsed payload", async () => {
    analyticsFetch.mockResolvedValue(validPayload);
    const result = await fetchWalletFinancials(ADDR);
    expect(analyticsFetch).toHaveBeenCalledWith(
      `analytics/wallets/${ADDR}/financials`,
      expect.objectContaining({ schema: expect.anything() }),
    );
    expect(result?.totalYield).toBe(812.19);
    expect(result?.earnedToday).toBeNull();
  });

  it("returns null on a 204/empty response (clean empty, not an outage — silent)", async () => {
    analyticsFetch.mockResolvedValue(null);
    const result = await fetchWalletFinancials(ADDR);
    expect(result).toBeNull();
    expect(observeAnalyticsFailure).not.toHaveBeenCalled();
  });

  it("observes the outage and returns null when the read throws", async () => {
    analyticsFetch.mockRejectedValue(new AnalyticsError(503, "SYSTEM_INTERNAL", "boom"));
    const result = await fetchWalletFinancials(ADDR);
    expect(result).toBeNull();
    expect(observeAnalyticsFailure).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: `analytics/wallets/${ADDR}/financials`, key: ADDR }),
    );
  });

  it("returns null when the response fails schema validation (never blanks the surface)", async () => {
    analyticsFetch.mockRejectedValue(
      new (class extends Error {})("parse failed"), // any throw degrades to null
    );
    const result = await fetchWalletFinancials(ADDR);
    expect(result).toBeNull();
  });
});
