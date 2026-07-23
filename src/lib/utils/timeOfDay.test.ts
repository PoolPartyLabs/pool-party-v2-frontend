/**
 * @name timeOfDay — tests
 * Covers the bucket boundaries (5 / 12 / 18) and the overnight wrap.
 */
import { describe, expect, it } from "vitest";
import { timeOfDay } from "./timeOfDay";

describe("timeOfDay", () => {
  it("buckets morning (5-11)", () => {
    expect(timeOfDay(5)).toBe("morning");
    expect(timeOfDay(9)).toBe("morning");
    expect(timeOfDay(11)).toBe("morning");
  });

  it("buckets afternoon (12-17)", () => {
    expect(timeOfDay(12)).toBe("afternoon");
    expect(timeOfDay(17)).toBe("afternoon");
  });

  it("buckets evening (18-23 and 0-4)", () => {
    expect(timeOfDay(18)).toBe("evening");
    expect(timeOfDay(23)).toBe("evening");
    expect(timeOfDay(0)).toBe("evening");
    expect(timeOfDay(4)).toBe("evening");
  });
});
