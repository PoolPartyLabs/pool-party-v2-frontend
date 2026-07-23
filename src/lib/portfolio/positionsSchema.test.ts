/**
 * @id PP-STR (POO-569)
 * @name Portfolio API response schema resilience
 * @implements-rules-version v1
 *
 * Guards the portfolio read against pp_api response-shape drift on fields the FE does NOT consume.
 * On 2026-07-07 pp_api changed `networkCounts` from an object to an array; the old strict `z.record`
 * shape rejected it, failing the ENTIRE positions parse and blanking the Home/Manager dashboard even
 * though nothing reads `networkCounts`. These tests lock the tolerant contract.
 */
import { describe, expect, it } from "vitest";
import { apiPortfolioSchema, apiPositionSchema, mapPortfolioAggregates } from "./positionsSchema";

/** A minimal position carrying exactly the fields the ACL mapper requires. */
const validPosition = {
  totalBalanceUsd: 8.2,
  totalFeesInUsd: 0.1,
  poolPartyPosition: { positionId: "0xabc", closed: false },
};

describe("apiPortfolioSchema — pp_api shape-drift resilience (POO-569)", () => {
  it("[regression] parses the ARRAY-shaped networkCounts pp_api now returns", () => {
    // The exact shape from the 2026-07-07 outage: an array of { network, count } instead of an object.
    const body = {
      positions: [validPosition],
      networkCounts: [
        { network: "arbitrum", count: 12 },
        { network: "base", count: 1 },
        { network: "polygon", count: 0 },
      ],
    };
    expect(apiPortfolioSchema.safeParse(body).success).toBe(true);
  });

  it("still parses the legacy OBJECT-shaped networkCounts (no regression for older pp_api)", () => {
    const body = { positions: [validPosition], networkCounts: { base: 3, arbitrum: 1 } };
    expect(apiPortfolioSchema.safeParse(body).success).toBe(true);
  });

  it("parses with networkCounts absent entirely", () => {
    expect(apiPortfolioSchema.safeParse({ positions: [validPosition] }).success).toBe(true);
  });
});

describe("apiPositionSchema — totalFeesInUsd is optional (POO-569)", () => {
  it("parses a position that OMITS totalFeesInUsd when claimableFeesUsd is present", () => {
    const position = {
      totalBalanceUsd: 8.2,
      claimableFeesUsd: 0.1,
      poolPartyPosition: { positionId: "0xabc", closed: false },
    };
    expect(apiPositionSchema.safeParse(position).success).toBe(true);
  });

  it("still requires the fields the mapper actually consumes (positionId, closed, totalBalanceUsd)", () => {
    // Over-loosening guard: dropping a genuinely-required field must still fail.
    const missingPositionId = {
      totalBalanceUsd: 8.2,
      poolPartyPosition: { closed: false },
    };
    expect(apiPositionSchema.safeParse(missingPositionId).success).toBe(false);
  });
});

/**
 * POO-696 (FE consumption of the new backend contract): `/portfolio/:wallet/all` now serves top-level
 * `avgApr` (value-weighted fee APR, %) and `allocation: [{ risk, pct }]` (per-band share, all three
 * bands, ~100). Both are read straight from the envelope. `allocation` is TOLERANT (`.catch(undefined)`)
 * so a future shape drift can NEVER fail the whole positions parse and blank the dashboard again (the
 * POO-698 networkCounts outage class): a drifted/garbage value degrades to `undefined` (the KPI mapper
 * then falls back to the client-side active-holdings computation), it never throws `ApiParseError`.
 */
describe("apiPortfolioSchema: POO-696 grand aggregates (avgApr + {risk,pct} allocation)", () => {
  it("parses top-level avgApr + the {risk,pct} allocation bands when present", () => {
    const parsed = apiPortfolioSchema.parse({
      positions: [],
      avgApr: 7.1,
      allocation: [
        { risk: "steady", pct: 40 },
        { risk: "dynamic", pct: 35 },
        { risk: "wild", pct: 25 },
      ],
    });
    expect(parsed.avgApr).toBe(7.1);
    expect(parsed.allocation).toEqual([
      { risk: "steady", pct: 40 },
      { risk: "dynamic", pct: 35 },
      { risk: "wild", pct: 25 },
    ]);
  });

  it("parses a lean envelope that omits avgApr + allocation (older backend)", () => {
    const parsed = apiPortfolioSchema.parse({ positions: [] });
    expect(parsed.avgApr).toBeUndefined();
    expect(parsed.allocation).toBeUndefined();
  });

  it("[outage-guard] a shape-drifted allocation degrades to undefined WITHOUT throwing (never blanks the dashboard)", () => {
    // Every drift class must degrade, not throw: the pre-POO-696 {level,value} shape no backend serves,
    // a missing field, an unknown band, and a wrong type entirely. A field the KPI mapper falls back
    // from must never fail the ENTIRE positions parse (the POO-698 / networkCounts outage class).
    const drifted: unknown[] = [
      [{ level: 2, value: 50 }],
      [{ risk: "steady" }],
      [{ risk: "spicy", pct: 10 }],
      "steady:40",
      42,
    ];
    for (const allocation of drifted) {
      const result = apiPortfolioSchema.safeParse({ positions: [], allocation });
      expect(result.success).toBe(true);
      expect(result.success && result.data.allocation).toBeUndefined();
    }
  });
});

describe("mapPortfolioAggregates: POO-696 avgApr + {risk,pct}→{level,value} mapping", () => {
  it("surfaces avgApr and maps the {risk,pct} bands onto the {level,value} bar model (steady→1, dynamic→3, wild→5)", () => {
    const aggregates = mapPortfolioAggregates({
      totalBalanceUsd: 100,
      claimableFeesUsd: 5,
      avgApr: 8.2,
      allocation: [
        { risk: "steady", pct: 40 },
        { risk: "dynamic", pct: 35 },
        { risk: "wild", pct: 25 },
      ],
    });
    expect(aggregates.avgApr).toBe(8.2);
    // Mapped to the internal AllocationSegment shape the AllocationByRisk bar + computeApyAndAllocation
    // both use, so the `aggregates.allocation ?? computed.allocation` fallback stays shape-uniform.
    expect(aggregates.allocation).toEqual([
      { level: 1, value: 40 },
      { level: 3, value: 35 },
      { level: 5, value: 25 },
    ]);
  });

  it("leaves avgApr + allocation undefined when the envelope omits them (client-compute fallback path)", () => {
    const aggregates = mapPortfolioAggregates({ totalBalanceUsd: 100 });
    expect(aggregates.avgApr).toBeUndefined();
    expect(aggregates.allocation).toBeUndefined();
  });

  it("respects a backend avgApr of 0 and an empty allocation (real values, not 'absent')", () => {
    const aggregates = mapPortfolioAggregates({ totalBalanceUsd: 100, avgApr: 0, allocation: [] });
    expect(aggregates.avgApr).toBe(0);
    expect(aggregates.allocation).toEqual([]);
  });

  it("a null envelope zeroes balance/fees and leaves avgApr/allocation undefined (never NaN)", () => {
    const aggregates = mapPortfolioAggregates(null);
    expect(aggregates.totalBalanceUsd).toBe(0);
    expect(aggregates.claimableFeesUsd).toBe(0);
    expect(aggregates.avgApr).toBeUndefined();
    expect(aggregates.allocation).toBeUndefined();
  });
});

/**
 * POO-832 [R1]/[R5]: additive OPTIONAL grand `totalInvestedUsd` (invested cost basis, POO-719 ledger).
 * Absent on a not-yet-redeployed backend → the KPI mapper falls back to `totalBalanceUsd` (today's
 * mirror behavior); present once the backend serves it, driving the Invested KPI distinctly.
 */
describe("apiPortfolioSchema — optional totalInvestedUsd grand aggregate (POO-832 R1)", () => {
  it("parses the optional totalInvestedUsd grand aggregate when present", () => {
    const parsed = apiPortfolioSchema.parse({ positions: [], totalInvestedUsd: 12.61 });
    expect(parsed.totalInvestedUsd).toBe(12.61);
  });

  it("parses a lean envelope that omits totalInvestedUsd (today's backend)", () => {
    const parsed = apiPortfolioSchema.parse({ positions: [] });
    expect(parsed.totalInvestedUsd).toBeUndefined();
  });
});

describe("mapPortfolioAggregates — totalInvestedUsd passthrough (POO-832 R1/R5)", () => {
  it("surfaces the backend grand totalInvestedUsd when the envelope carries it", () => {
    const aggregates = mapPortfolioAggregates({
      totalBalanceUsd: 12.77,
      totalInvestedUsd: 12.61,
    });
    expect(aggregates.totalInvestedUsd).toBe(12.61);
  });

  it("leaves totalInvestedUsd undefined when the envelope omits it (mirror-balance fallback path)", () => {
    const aggregates = mapPortfolioAggregates({ totalBalanceUsd: 12.77 });
    expect(aggregates.totalInvestedUsd).toBeUndefined();
  });

  it("respects a backend totalInvestedUsd of 0 (a real value, not 'absent')", () => {
    const aggregates = mapPortfolioAggregates({ totalBalanceUsd: 0, totalInvestedUsd: 0 });
    expect(aggregates.totalInvestedUsd).toBe(0);
  });

  it("a null envelope leaves totalInvestedUsd undefined (never NaN)", () => {
    const aggregates = mapPortfolioAggregates(null);
    expect(aggregates.totalInvestedUsd).toBeUndefined();
  });
});
