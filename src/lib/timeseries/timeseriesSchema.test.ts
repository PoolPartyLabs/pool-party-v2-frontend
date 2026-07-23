/**
 * @id PP-CORE (POO-366)
 * @name analytics timeseries schemas — tests
 * @implements-rules-version v1
 */
import { describe, expect, it } from "vitest";
import { poolTimeseriesSchema, walletTimeseriesSchema } from "./timeseriesSchema";

describe("poolTimeseriesSchema", () => {
  it("parses a pool AUM series, coercing string numerics and ignoring extras", () => {
    const parsed = poolTimeseriesSchema.parse({
      pool: { position_id: "0xpool", pool_address: "0xpool" },
      series: [
        { date: "2026-06-01", value_usd: 1234.56, n_positions: 3 },
        { date: "2026-06-02", value_usd: "1300.00", n_positions: 4 },
      ],
    });
    expect(parsed.series).toEqual([
      { date: "2026-06-01", value_usd: 1234.56 },
      { date: "2026-06-02", value_usd: 1300 },
    ]);
  });

  it("rejects a malformed series (missing date / non-array)", () => {
    expect(poolTimeseriesSchema.safeParse({ series: [{ value_usd: 1 }] }).success).toBe(false);
    expect(poolTimeseriesSchema.safeParse({ series: "nope" }).success).toBe(false);
  });
});

describe("walletTimeseriesSchema", () => {
  // POO-645 R1/R3: the LIVE contract serves investor_portfolio as a BARE ARRAY (matching
  // manager_aum's convention). Payload below is verbatim from the dev endpoint (2026-07-06);
  // rejecting it blanked the Home/Portfolio heroes AND the manager AUM chart.
  it("parses the live wire shape: investor_portfolio as a bare array + envelope extras (POO-645 R1/R3)", () => {
    const parsed = walletTimeseriesSchema.parse({
      address: "0xfe4c8730817ab1840775dbfd49cf0b83b2cbb408",
      granularity: "day",
      manager_aum: [{ date: "2026-04-06T00:00:00.000Z", value_usd: "6.94", n_positions: 1 }],
      investor_portfolio: [
        { date: "2026-04-06T00:00:00.000Z", value_usd: "4.59", n_positions: 1 },
        { date: "2026-04-07T00:00:00.000Z", value_usd: "4.61", n_positions: 1 },
      ],
    });
    expect(parsed.manager_aum).toEqual([{ date: "2026-04-06T00:00:00.000Z", value_usd: 6.94 }]);
    expect(parsed.investor_portfolio).toEqual([
      { date: "2026-04-06T00:00:00.000Z", value_usd: 4.59 },
      { date: "2026-04-07T00:00:00.000Z", value_usd: 4.61 },
    ]);
  });

  it("still tolerates the legacy object shapes: { series } and the { note } stub (POO-645 R1)", () => {
    const withSeries = walletTimeseriesSchema.parse({
      investor_portfolio: { series: [{ date: "2026-06-19", value_usd: 100 }] },
    });
    expect(withSeries.investor_portfolio).toEqual({
      series: [{ date: "2026-06-19", value_usd: 100 }],
    });
    const stub = walletTimeseriesSchema.parse({ investor_portfolio: { note: "pending" } });
    expect(stub.investor_portfolio).toMatchObject({ note: "pending" });
  });

  it("parses manager_aum and ignores the investor_portfolio stub", () => {
    const parsed = walletTimeseriesSchema.parse({
      manager_aum: [{ date: "2026-06-01", value_usd: "50000", n_positions: 2 }],
      investor_portfolio: { note: "per-investor value-over-time is pending" },
    });
    expect(parsed.manager_aum).toEqual([{ date: "2026-06-01", value_usd: 50000 }]);
  });

  it("accepts a wallet with no manager series", () => {
    expect(walletTimeseriesSchema.parse({}).manager_aum).toBeUndefined();
  });
});
