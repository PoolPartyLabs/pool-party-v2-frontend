/**
 * @id PP-REW (POO-209)
 * @name fetchRubberRush tests
 * @implements-rules-version v1
 *
 * [R1][R4][R5][R6] Server-side orchestration: three analyticsFetch reads merged
 * into a RubberRush, with per-slice 404/WALLET_NOT_FOUND graceful defaults and a
 * full zero-state when no wallet address is present.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsError } from "@/lib/analytics-api/client";

// Mock analyticsFetch while keeping the real AnalyticsError class for the catch logic.
const analyticsFetch = vi.fn();
vi.mock("@/lib/analytics-api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics-api/client")>();
  return { ...actual, analyticsFetch: (...args: unknown[]) => analyticsFetch(...args) };
});

const observeAnalyticsFailure = vi.fn();
vi.mock("@/lib/analytics-api/observeFailure", () => ({
  observeAnalyticsFailure: (...args: unknown[]) => observeAnalyticsFailure(...args),
}));

const summary = { totalPoints: 15021, dailyPoints: 286 };
const tier = {
  tierId: 2,
  percentile: 0.422,
  nextTierProgress: 68,
  totalBoost: 0,
  hasSaidGM: false,
  streak: { days: 3 },
};
const status = { triesRemaining: 7, weeklyTriesLeft: 5, quacksEarnedToday: 48 };
const referrals = { totalReferrals: 4 };

/** Route the mock by path so each of the four reads resolves independently. */
function routeByPath(map: {
  summary?: unknown;
  tier?: unknown;
  status?: unknown;
  referrals?: unknown;
}) {
  analyticsFetch.mockImplementation((path: string) => {
    // Check the more specific `/referrals/summary` before the `/summary` suffix.
    if (path.endsWith("/referrals/summary")) return Promise.resolve(map.referrals ?? referrals);
    if (path.endsWith("/summary")) return Promise.resolve(map.summary ?? summary);
    if (path.endsWith("/tier")) return Promise.resolve(map.tier ?? tier);
    if (path.endsWith("/duck-shoot/status")) return Promise.resolve(map.status ?? status);
    throw new Error(`unexpected path ${path}`);
  });
}

async function importFetch() {
  vi.resetModules();
  return import("./fetchRubberRush");
}

describe("fetchRubberRush", () => {
  beforeEach(() => {
    analyticsFetch.mockReset();
    observeAnalyticsFailure.mockReset();
  });

  it("[R6] returns a zero-state without hitting the network when no address is given", async () => {
    const { fetchRubberRush } = await importFetch();

    const result = await fetchRubberRush();

    expect(analyticsFetch).not.toHaveBeenCalled();
    expect(result.quacks).toBe(0);
    expect(result.tierIndex).toBe(0);
    expect(result.duckShoot.triesLeft).toBe(0);
  });

  it("[R1] reads the three endpoints and maps the merged result", async () => {
    routeByPath({});
    const { fetchRubberRush } = await importFetch();

    const result = await fetchRubberRush("0xabc");

    const paths = analyticsFetch.mock.calls.map((c) => c[0]);
    expect(paths).toContain("points/0xabc/summary");
    expect(paths).toContain("points/0xabc/tier");
    expect(paths).toContain("points/0xabc/duck-shoot/status");
    expect(paths).toContain("points/0xabc/referrals/summary");
    expect(result.quacks).toBe(15021);
    expect(result.tierIndex).toBe(1);
    expect(result.quacksToday).toBe(286); // POO-763 R1: from summary.dailyPoints
    expect(result.totalReferrals).toBe(4); // POO-763 R4: from the referrals slice
    expect(result.referralFriends).toBe(4); // POO-854 R1: friends count = the real referrals slice
  });

  it("[R5] reads the Rubber Rush slices uncached (no-store) so post-write refetches are fresh", async () => {
    routeByPath({});
    const { fetchRubberRush } = await importFetch();

    await fetchRubberRush("0xabc");

    const opts = (p: string) =>
      analyticsFetch.mock.calls.find((c) => c[0] === p)?.[1] as { cache?: string } | undefined;
    for (const p of [
      "points/0xabc/summary",
      "points/0xabc/tier",
      "points/0xabc/duck-shoot/status",
      "points/0xabc/referrals/summary",
    ]) {
      expect(opts(p)?.cache).toBe("no-store");
    }
  });

  it("[R5] a 404 on the tier slice falls back to tier zero defaults", async () => {
    analyticsFetch.mockImplementation((path: string) => {
      if (path.endsWith("/tier"))
        return Promise.reject(new AnalyticsError(404, "WALLET_NOT_FOUND", "no tier"));
      if (path.endsWith("/summary")) return Promise.resolve(summary);
      return Promise.resolve(status);
    });
    const { fetchRubberRush } = await importFetch();

    const result = await fetchRubberRush("0xabc");

    expect(result.tierIndex).toBe(0);
    expect(result.tierTopPercent).toBe(0);
    expect(result.quacks).toBe(15021); // summary still mapped
    expect(result.quacksToday).toBe(286); // summary.dailyPoints still mapped
  });

  it("[R5] WALLET_NOT_FOUND on the summary slice falls back to quacks 0", async () => {
    analyticsFetch.mockImplementation((path: string) => {
      if (path.endsWith("/summary"))
        return Promise.reject(new AnalyticsError(404, "WALLET_NOT_FOUND", "no wallet"));
      if (path.endsWith("/tier")) return Promise.resolve(tier);
      return Promise.resolve(status);
    });
    const { fetchRubberRush } = await importFetch();

    const result = await fetchRubberRush("0xabc");

    expect(result.quacks).toBe(0);
    expect(result.tierIndex).toBe(1); // tier still mapped
  });

  it("rethrows a non-404 error (e.g. 500) instead of swallowing it", async () => {
    analyticsFetch.mockImplementation((path: string) => {
      if (path.endsWith("/tier"))
        return Promise.reject(new AnalyticsError(500, "SYSTEM_INTERNAL", "boom"));
      return Promise.resolve(path.endsWith("/summary") ? summary : status);
    });
    const { fetchRubberRush } = await importFetch();

    await expect(fetchRubberRush("0xabc")).rejects.toThrow(AnalyticsError);
  });

  // [R2] A genuine outage on a slice is observed (endpoint + wallet key) before rethrowing.
  it("[R2] observes a non-404 slice outage before rethrowing", async () => {
    analyticsFetch.mockImplementation((path: string) => {
      if (path.endsWith("/tier"))
        return Promise.reject(new AnalyticsError(503, "SYSTEM_INTERNAL", "down"));
      return Promise.resolve(path.endsWith("/summary") ? summary : status);
    });
    const { fetchRubberRush } = await importFetch();

    await expect(fetchRubberRush("0xabc")).rejects.toThrow(AnalyticsError);
    expect(observeAnalyticsFailure).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "points/0xabc/tier", key: "0xabc" }),
    );
  });

  // [R3] A per-wallet 404 slice is expected (no data yet), not an outage: do NOT observe.
  it("[R3] does NOT observe a 404 WALLET_NOT_FOUND slice", async () => {
    analyticsFetch.mockImplementation((path: string) => {
      if (path.endsWith("/tier"))
        return Promise.reject(new AnalyticsError(404, "WALLET_NOT_FOUND", "no tier"));
      return Promise.resolve(path.endsWith("/summary") ? summary : status);
    });
    const { fetchRubberRush } = await importFetch();

    await fetchRubberRush("0xabc");
    expect(observeAnalyticsFailure).not.toHaveBeenCalled();
  });
});
