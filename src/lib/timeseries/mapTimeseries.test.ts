/**
 * @id PP-CORE (POO-366)
 * @name mapTimeseries — tests
 * @implements-rules-version v2
 */
import { describe, expect, it } from "vitest";
import { mapTimeseries } from "./mapTimeseries";

describe("mapTimeseries", () => {
  it("maps value, a UTC-stable date label, and a USD display, preserving order", () => {
    const points = mapTimeseries(
      [
        { date: "2026-06-01", value_usd: 1000 },
        { date: "2026-06-02", value_usd: 1250.5 },
      ],
      "en-US",
    );
    expect(points).toEqual([
      { value: 1000, label: "Jun 1", display: "$1,000.00", date: "2026-06-01" },
      { value: 1250.5, label: "Jun 2", display: "$1,250.50", date: "2026-06-02" },
    ]);
  });

  // @rule R2 (POO-557): the raw ISO date must survive onto the ChartPoint so period tabs can window
  // by real calendar time (not by trailing point count).
  it("keeps the point's ISO date on the mapped ChartPoint", () => {
    const points = mapTimeseries([{ date: "2026-06-19T00:00:00.000Z", value_usd: 5 }], "en-US");
    expect(points[0]?.date).toBe("2026-06-19T00:00:00.000Z");
  });

  it("does not shift the day across timezones (date is read as UTC)", () => {
    // "2026-01-01" must label as Jan 1 regardless of the host timezone (no Dec 31 off-by-one).
    const points = mapTimeseries([{ date: "2026-01-01", value_usd: 1 }], "en-US");
    expect(points[0]?.label).toBe("Jan 1");
  });

  it("returns an empty array for an empty series", () => {
    expect(mapTimeseries([], "en-US")).toEqual([]);
  });
});
