/**
 * @id PP-REW (POO-567)
 * @name Analytics failure observability tests
 * @implements-rules-version v1
 *
 * TDD tests for the structured outage-observability hook the never-throw analytics
 * fetchers call before degrading to their empty default. An analytics OUTAGE must be
 * observable in server logs and DISTINCT from a clean no-data-yet response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsError, AnalyticsParseError } from "./errors";
import { observeAnalyticsFailure } from "./observeFailure";

describe("observeAnalyticsFailure", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  // -----------------------------------------------------------------------
  // [R2] Genuine outages ARE logged, with structured context.
  // -----------------------------------------------------------------------
  describe("[R2] outages are observable", () => {
    it("logs a structured warning on a network error", async () => {
      observeAnalyticsFailure({
        endpoint: "analytics/pools/0xpool/timeseries",
        error: new AnalyticsError(0, "SYSTEM_NETWORK_ERROR", "fetch failed"),
        key: "0xpool",
      });

      expect(warn).toHaveBeenCalledOnce();
      const [message, context] = warn.mock.calls[0] as [string, Record<string, unknown>];
      expect(message).toContain("analytics");
      expect(context).toMatchObject({
        endpoint: "analytics/pools/0xpool/timeseries",
        code: "SYSTEM_NETWORK_ERROR",
        status: 0,
        key: "0xpool",
      });
    });

    it("logs a structured warning on a 5xx upstream error", async () => {
      observeAnalyticsFailure({
        endpoint: "analytics/wallets/0xmgr/timeseries",
        error: new AnalyticsError(503, "SYSTEM_INTERNAL", "unavailable"),
        key: "0xmgr",
      });

      expect(warn).toHaveBeenCalledOnce();
      const [, context] = warn.mock.calls[0] as [string, Record<string, unknown>];
      expect(context).toMatchObject({ status: 503, code: "SYSTEM_INTERNAL", key: "0xmgr" });
    });

    it("logs a timeout (408 SYSTEM_TIMEOUT) as an outage", async () => {
      observeAnalyticsFailure({
        endpoint: "analytics/pools/0xpool/timeseries",
        error: new AnalyticsError(408, "SYSTEM_TIMEOUT", "timed out"),
        key: "0xpool",
      });

      expect(warn).toHaveBeenCalledOnce();
    });

    it("logs a schema parse failure as an outage (fabricated/broken upstream shape)", async () => {
      observeAnalyticsFailure({
        endpoint: "analytics/pools/0xpool/timeseries",
        error: new AnalyticsParseError("bad shape", []),
        key: "0xpool",
      });

      expect(warn).toHaveBeenCalledOnce();
      const [, context] = warn.mock.calls[0] as [string, Record<string, unknown>];
      expect(context).toMatchObject({ code: "SYSTEM_PARSE_ERROR", status: 422 });
    });

    it("logs a non-Analytics error (unexpected throw) as an outage", async () => {
      observeAnalyticsFailure({
        endpoint: "analytics/pools/0xpool/timeseries",
        error: new Error("boom"),
        key: "0xpool",
      });

      expect(warn).toHaveBeenCalledOnce();
      const [, context] = warn.mock.calls[0] as [string, Record<string, unknown>];
      expect(context).toMatchObject({ code: "SYSTEM_UNKNOWN" });
    });
  });

  // -----------------------------------------------------------------------
  // [R4] Mock mode: SYSTEM_NOT_CONFIGURED stays silent by design.
  // -----------------------------------------------------------------------
  describe("[R4] expected non-outage signals stay silent", () => {
    it("does NOT log SYSTEM_NOT_CONFIGURED (mock mode / unset ANALYTICS_API_URL)", async () => {
      observeAnalyticsFailure({
        endpoint: "analytics/pools/0xpool/timeseries",
        error: new AnalyticsError(503, "SYSTEM_NOT_CONFIGURED", "ANALYTICS_API_URL is not set"),
        key: "0xpool",
      });

      expect(warn).not.toHaveBeenCalled();
    });

    it("does NOT log a per-wallet 404 (young/uncovered wallet, not an outage)", async () => {
      observeAnalyticsFailure({
        endpoint: "analytics/wallets/0xnew/timeseries",
        error: new AnalyticsError(404, "WALLET_NOT_FOUND", "no wallet"),
        key: "0xnew",
      });

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
