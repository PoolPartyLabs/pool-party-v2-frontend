/**
 * @id PP-CORE-LIB-045
 * @name analytics /financials wire schemas — tests
 *
 * Behavior: the schemas accept the authoritative POO-932 payloads (including honest NULL fields the
 * backfill has not populated yet) and reject a shape that is genuinely malformed. NULL is a
 * first-class value on every money field — the parse must not coerce it to 0, and a fully-null
 * (pre-backfill) payload must still parse.
 */
import { describe, expect, it } from "vitest";
import {
  managerFinancialsSchema,
  strategyFinancialsSchema,
  walletFinancialsSchema,
} from "./financialsSchema";

/** A fully-populated (post-backfill) investor payload. */
const populatedInvestor = {
  address: "0xabc0000000000000000000000000000000000001",
  earnedToday: 12.34,
  feesEarned: { "24h": 12.34, "7d": 45.6, "30d": 120.55 },
  invested: 10_000,
  totalYield: 812.19,
  portfolioValue: 10_812.19,
  claimableGross: 42.5,
  coverage: 0.9876,
  provisional: false,
  byStrategy: {
    "pos-1": {
      invested: 5_000,
      currentValue: 5_400,
      available: 20,
      totalYield: 420,
      collectedFees: { "24h": 1, "7d": 5, "30d": 20, all: 400 },
      feesEarned: { "24h": 1, "7d": 5, "30d": 20 },
      provisional: false,
    },
  },
  last_updated: {
    ledger: "2026-07-16T12:00:00.000Z",
    investor_snapshot: "2026-07-16T11:30:00.000Z",
    pool_snapshot: "2026-07-16T11:45:00.000Z",
    price_cache: "2026-07-16T12:05:00.000Z",
  },
  _assertions: { windowClampActivations: 0 },
};

/** The pre-backfill payload: ledger-dependent fields serve NULL honestly (never $0). */
const nullInvestor = {
  address: "0xabc0000000000000000000000000000000000002",
  earnedToday: null,
  feesEarned: { "24h": null, "7d": null, "30d": null },
  invested: null,
  totalYield: null,
  portfolioValue: null,
  claimableGross: null,
  coverage: null,
  provisional: false,
  byStrategy: {},
  last_updated: { ledger: null, investor_snapshot: null, pool_snapshot: null, price_cache: null },
  _assertions: { windowClampActivations: 0 },
};

const populatedManager = {
  address: "0xdef0000000000000000000000000000000000001",
  aum: 392_480,
  aumChange30dPct: 4.2,
  aumCoverage: 0.95,
  netInflows30d: 8_200,
  yieldGenerated: 48_200,
  performanceFees: 8_420.1,
  performanceFees30d: 640.1,
  activeInvestors: 1_980,
  totalInvestors: 2_140,
  charts: {
    aumSeries: [{ date: "2026-06-16", valueUsd: 318_000 }],
    flowsDaily: [{ date: "2026-07-15", netFlowUsd: 1_200 }],
  },
  last_updated: { ledger: "2026-07-16T12:00:00.000Z", pool_snapshot: null },
};

const nullManager = {
  address: "0xdef0000000000000000000000000000000000002",
  aum: null,
  aumChange30dPct: null,
  aumCoverage: null,
  netInflows30d: null,
  yieldGenerated: null,
  performanceFees: null,
  performanceFees30d: null,
  activeInvestors: 0,
  totalInvestors: 0,
  charts: { aumSeries: [], flowsDaily: [] },
  last_updated: { ledger: null, pool_snapshot: null, price_cache: null },
};

describe("walletFinancialsSchema", () => {
  it("parses a fully-populated investor payload", () => {
    const result = walletFinancialsSchema.safeParse(populatedInvestor);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalYield).toBe(812.19);
      expect(result.data.byStrategy["pos-1"]?.feesEarned["30d"]).toBe(20);
    }
  });

  it("parses a pre-backfill payload whose ledger fields are NULL (honest absence, never $0)", () => {
    const result = walletFinancialsSchema.safeParse(nullInvestor);
    expect(result.success).toBe(true);
    if (result.success) {
      // NULL must survive as null — NOT coerced to 0 (the whole point of the honest-NULL contract).
      expect(result.data.totalYield).toBeNull();
      expect(result.data.invested).toBeNull();
      expect(result.data.earnedToday).toBeNull();
      expect(result.data.feesEarned["24h"]).toBeNull();
      expect(result.data.last_updated.ledger).toBeNull();
    }
  });

  it("tolerates an absent _assertions block", () => {
    const { _assertions, ...withoutAssertions } = populatedInvestor;
    void _assertions;
    expect(walletFinancialsSchema.safeParse(withoutAssertions).success).toBe(true);
  });

  it("tolerates extra source names in last_updated", () => {
    const withExtra = {
      ...nullInvestor,
      last_updated: { ...nullInvestor.last_updated, some_future_source: null },
    };
    expect(walletFinancialsSchema.safeParse(withExtra).success).toBe(true);
  });

  it("rejects a numeric-string money field (the legacy locale-string leak the C9 contract kills)", () => {
    const withStringMoney = { ...populatedInvestor, totalYield: "812.19" };
    expect(walletFinancialsSchema.safeParse(withStringMoney).success).toBe(false);
  });

  it("rejects a payload missing a required window", () => {
    const missingWindow = {
      ...populatedInvestor,
      feesEarned: { "24h": 1, "7d": 2 },
    };
    expect(walletFinancialsSchema.safeParse(missingWindow).success).toBe(false);
  });
});

describe("strategyFinancialsSchema", () => {
  it("parses a per-strategy block with null money fields", () => {
    const result = strategyFinancialsSchema.safeParse({
      invested: null,
      currentValue: 100,
      available: null,
      totalYield: null,
      collectedFees: { "24h": null, "7d": null, "30d": null, all: null },
      feesEarned: { "24h": null, "7d": null, "30d": null },
      provisional: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.invested).toBeNull();
  });
});

describe("managerFinancialsSchema", () => {
  it("parses a fully-populated manager payload", () => {
    const result = managerFinancialsSchema.safeParse(populatedManager);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aumChange30dPct).toBe(4.2);
      expect(result.data.charts.aumSeries[0]?.valueUsd).toBe(318_000);
    }
  });

  it("parses a pre-backfill manager payload whose money fields are NULL", () => {
    const result = managerFinancialsSchema.safeParse(nullManager);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aum).toBeNull();
      expect(result.data.netInflows30d).toBeNull();
      expect(result.data.charts.aumSeries).toEqual([]);
    }
  });

  it("rejects a non-numeric investor count", () => {
    const bad = { ...populatedManager, activeInvestors: "1980" };
    expect(managerFinancialsSchema.safeParse(bad).success).toBe(false);
  });
});
