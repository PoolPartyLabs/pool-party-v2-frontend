/**
 * @id PP-ACT (POO-212)
 * @name fetchTransactions tests
 * @implements-rules-version v1
 *
 * [R1][R7] Server-side read of the analytics activity feed, mapped to Transaction[].
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
  return import("./fetchTransactions");
}

const sample = {
  data: [
    {
      id: "tx-1",
      type: "LiquidityAdded",
      amount: "1,030.81",
      token: "USDC (Calc)",
      timestamp: "2026-04-19T14:30:09.000Z",
    },
    {
      id: "tx-2",
      type: "LiquidityRemoved",
      amount: "no data",
      token: "no data",
      timestamp: "2026-04-18T10:00:00.000Z",
    },
  ],
  meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
};

describe("fetchTransactions", () => {
  beforeEach(() => {
    analyticsFetch.mockReset();
    observeAnalyticsFailure.mockReset();
  });

  it("[R1] returns [] without hitting the network when no address is given", async () => {
    const { fetchTransactions } = await importFetch();
    expect(await fetchTransactions()).toEqual([]);
    expect(analyticsFetch).not.toHaveBeenCalled();
  });

  it("[R1][R7] reads the first page and maps the rows most-recent-first", async () => {
    analyticsFetch.mockResolvedValueOnce(sample);
    const { fetchTransactions } = await importFetch();

    const txs = await fetchTransactions("0xabc");

    const [path, opts] = analyticsFetch.mock.calls[0] as [string, { revalidate?: number }];
    expect(path).toBe("analytics/wallets/0xabc/transactions?limit=50");
    expect(opts.revalidate).toBe(60);
    expect(txs).toHaveLength(2);
    // POO-226 R2: a LiquidityAdded event is a strategy `invest` (not a cash-in `deposit`).
    expect(txs[0]).toMatchObject({ id: "tx-1", type: "invest", tokenSymbol: "USDC" });
    // 'no data' row is kept with a 0 amount.
    expect(txs[1]).toMatchObject({ id: "tx-2", type: "withdraw", tokenAmount: 0 });
  });

  it("[R1] a 404 WALLET_NOT_FOUND degrades to an empty list", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(404, "WALLET_NOT_FOUND", "none"));
    const { fetchTransactions } = await importFetch();
    expect(await fetchTransactions("0xabc")).toEqual([]);
  });

  // [R3] A per-wallet 404 is expected (no data yet), not an outage: do NOT observe.
  it("[R3] does NOT observe a 404 WALLET_NOT_FOUND", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(404, "WALLET_NOT_FOUND", "none"));
    const { fetchTransactions } = await importFetch();
    await fetchTransactions("0xabc");
    expect(observeAnalyticsFailure).not.toHaveBeenCalled();
  });

  it("rethrows a non-404 error", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(500, "SYSTEM_INTERNAL", "boom"));
    const { fetchTransactions } = await importFetch();
    await expect(fetchTransactions("0xabc")).rejects.toThrow(AnalyticsError);
  });

  // [R2] A genuine outage is observed (with endpoint + wallet key) even though it rethrows.
  it("[R2] observes a non-404 outage before rethrowing", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(500, "SYSTEM_INTERNAL", "boom"));
    const { fetchTransactions } = await importFetch();

    await expect(fetchTransactions("0xabc")).rejects.toThrow(AnalyticsError);

    expect(observeAnalyticsFailure).toHaveBeenCalledOnce();
    expect(observeAnalyticsFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "analytics/wallets/0xabc/transactions",
        key: "0xabc",
      }),
    );
  });
});
