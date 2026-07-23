/**
 * @id PP-MGR-LIB-006 (POO-559)
 * @name buildSpark tests
 * @implements-rules-version v1
 *
 * The pure spark builder for the manager-console card sparkline (POO-559): windows a pool's real
 * value series to the trailing <=30d, downsamples to ~8 points, and reports whether the result is a
 * measured trend (>=2 points) or a placeholder that must not be presented as one.
 */
import { describe, expect, it } from "vitest";
import type { TimeseriesPoint } from "@/lib/timeseries/timeseriesSchema";
import { downsampleSpark, sparkFromSeries } from "./buildSpark";

/** `count` consecutive daily points ending 2026-07-04, values `start + index * stepPerDay`. */
function dailySeries(count: number, start = 1, stepPerDay = 1): TimeseriesPoint[] {
  const end = Date.UTC(2026, 6, 4);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(end - (count - 1 - index) * 86_400_000).toISOString(),
    value_usd: start + index * stepPerDay,
  }));
}

describe("downsampleSpark", () => {
  // @rule R3
  it("[R3] downsamples a long series to the target point count", () => {
    const values = Array.from({ length: 30 }, (_, i) => i);
    const out = downsampleSpark(values, 8);
    expect(out).toHaveLength(8);
  });

  // @rule R3
  it("[R3] keeps the first and last points so the endpoints (and tint) are preserved", () => {
    const values = Array.from({ length: 30 }, (_, i) => i * 10);
    const out = downsampleSpark(values, 8);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(290);
  });

  // @rule R3
  it("[R3] returns the series unchanged when it is already at or below the target", () => {
    expect(downsampleSpark([1, 2, 3], 8)).toEqual([1, 2, 3]);
    const eight = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(downsampleSpark(eight, 8)).toEqual(eight);
  });
});

describe("sparkFromSeries", () => {
  // @rule R1
  it("[R1] maps the trailing 30d of the value series to spark numbers, oldest -> newest", () => {
    const series = dailySeries(40, 1, 1); // values 1..40, one per day
    const spark = sparkFromSeries(series);
    expect(spark.measured).toBe(true);
    // trailing 30d window (31 daily closes: values 10..40) downsampled to <=8, endpoints preserved
    expect(spark.points[0]).toBe(10);
    expect(spark.points.at(-1)).toBe(40);
    expect(spark.points.length).toBeLessThanOrEqual(8);
    expect(spark.points.length).toBeGreaterThanOrEqual(2);
  });

  // @rule R2
  it("[R2] reports not-measured for a single-point series (never a measured trend)", () => {
    const spark = sparkFromSeries(dailySeries(1));
    expect(spark.measured).toBe(false);
  });

  // @rule R2
  it("[R2] reports not-measured for an empty series", () => {
    const spark = sparkFromSeries([]);
    expect(spark.measured).toBe(false);
  });

  // @rule R2
  it("[R2] keeps a two-point window as a measured trend without downsampling", () => {
    const spark = sparkFromSeries(dailySeries(2, 5, 3)); // values 5, 8
    expect(spark.measured).toBe(true);
    expect(spark.points).toEqual([5, 8]);
  });

  // @rule R5
  it("[R5] preserves first vs last so a rising series tints up", () => {
    const spark = sparkFromSeries(dailySeries(20, 100, 5)); // rising
    expect(spark.points.at(-1)).toBeGreaterThan(spark.points[0] as number);
  });

  // @rule R5
  it("[R5] preserves first vs last so a falling series tints down", () => {
    const spark = sparkFromSeries(dailySeries(20, 200, -4)); // falling
    expect(spark.points.at(-1)).toBeLessThan(spark.points[0] as number);
  });
});
