import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  formatUnits,
  formatUsdc,
  formatUsdPrice,
  formatWeth,
  percentFromSpot,
  shareOfTotal,
  shortHash,
} from "./format";

describe("formatUnits: exact, no floats", () => {
  it("formats USDC raw units", () => {
    expect(formatUnits("1000000", 6)).toBe("1");
    expect(formatUnits("1234567", 6)).toBe("1.234567");
    expect(formatUnits("0", 6)).toBe("0");
  });

  it("groups thousands", () => {
    expect(formatUnits("1234567890123", 6)).toBe("1,234,567.890123");
  });

  /**
   * The reason this module exists. 1 wei short of 1000 ETH is not representable as a JS
   * number, so any implementation that touched Number() would round it to exactly 1000.
   */
  it("keeps precision a float would lose", () => {
    const oneWeiShortOf1000Eth = (BigInt(1000) * BigInt(10) ** BigInt(18) - BigInt(1)).toString();
    expect(formatUnits(oneWeiShortOf1000Eth, 18, 18)).toBe("999.999999999999999999");
    // And the naive version really does lose it, which is what we are guarding against.
    expect(Number(oneWeiShortOf1000Eth) / 1e18).toBe(1000);
  });

  it("truncates rather than rounds, so a balance is never overstated", () => {
    expect(formatUnits("1999999", 6, 2)).toBe("1.99");
  });

  it("handles negatives", () => {
    expect(formatUnits(BigInt(-1500000), 6)).toBe("-1.5");
  });

  it("treats an empty string as zero rather than throwing", () => {
    expect(formatUnits("", 6)).toBe("0");
  });
});

describe("display helpers", () => {
  it("formats a Chainlink 8dp price", () => {
    expect(formatUsdPrice("186654000000")).toBe("$1,866.54");
  });

  it("formats USDC and WETH with their units", () => {
    expect(formatUsdc("2009005356")).toBe("$2,009.00");
    expect(formatWeth("510000000000000000")).toBe("0.51 ETH");
  });

  /**
   * A real fill of 0.00002 ETH rendered as "0 ETH": four fraction digits truncated the whole
   * amount away, so the page showed a purchase that had definitely happened as nothing. On a
   * page whose entire claim is that the numbers are real, that is the worst possible rounding
   * direction. Small amounts now keep two significant digits instead of a fixed four places.
   */
  it("never truncates a non-zero ETH amount down to zero", () => {
    expect(formatWeth("20000000000000")).toBe("0.00002 ETH"); // the observed fill
    expect(formatWeth("300000000000000")).toBe("0.0003 ETH");
    expect(formatWeth("1")).toBe("0.000000000000000001 ETH"); // one wei, the floor case
    expect(formatWeth("0")).toBe("0 ETH");
  });

  it("keeps ordinary amounts at four places rather than growing a tail", () => {
    // Precision is extended only when four places would show nothing. A normal balance is
    // unchanged, so the column does not suddenly render 18 digits for everything.
    expect(formatWeth("1234567890123456789")).toBe("1.2345 ETH");
    expect(formatWeth("510000000000000000")).toBe("0.51 ETH");
    expect(formatWeth("100000000000000")).toBe("0.0001 ETH");
  });

  it("shortens hashes", () => {
    expect(shortHash("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x123456...5678");
    expect(shortHash("0x1234")).toBe("0x1234");
  });
});

describe("shareOfTotal", () => {
  it("computes a percentage", () => {
    expect(shareOfTotal("900", "1000")).toBe(90);
  });

  it("returns null on a zero total so the view can hide the bar (FE-R7)", () => {
    expect(shareOfTotal("0", "0")).toBeNull();
  });

  it("does not floor small shares to zero", () => {
    // Integer division without scaling would make this 0.
    expect(shareOfTotal("1", "1000")).toBeCloseTo(0.1, 5);
  });
});

describe("percentFromSpot", () => {
  it("reports the band edges as negative percentages below spot", () => {
    const spot = "300000000000"; // $3000, 8dp
    expect(percentFromSpot("255000000000", spot)).toBeCloseTo(-15, 5);
    expect(percentFromSpot("285000000000", spot)).toBeCloseTo(-5, 5);
  });

  it("resolves the demo band's tight edges instead of collapsing them to zero", () => {
    const spot = "300000000000";
    expect(percentFromSpot("299100000000", spot)).toBeCloseTo(-0.3, 5);
    expect(percentFromSpot("299700000000", spot)).toBeCloseTo(-0.1, 5);
  });

  it("returns null when data is missing", () => {
    expect(percentFromSpot("", "300000000000")).toBeNull();
    expect(percentFromSpot("255000000000", "0")).toBeNull();
  });
});

describe("formatCountdown", () => {
  const now = new Date("2026-07-25T12:00:00Z");
  const at = (offsetSeconds: number) => String(Math.floor(now.getTime() / 1000) + offsetSeconds);

  it("counts days and hours", () => {
    expect(formatCountdown(at(3 * 86_400 + 2 * 3_600), now)).toBe("3d 2h");
  });

  it("drops to hours and minutes inside a day", () => {
    expect(formatCountdown(at(5 * 3_600 + 30 * 60), now)).toBe("5h 30m");
  });

  it("shows minutes in the last hour", () => {
    expect(formatCountdown(at(45 * 60), now)).toBe("45m");
  });

  it("says expired at or past the deadline", () => {
    expect(formatCountdown(at(0), now)).toBe("expired");
    expect(formatCountdown(at(-60), now)).toBe("expired");
  });

  it("returns empty for a missing deadline", () => {
    expect(formatCountdown("", now)).toBe("");
  });
});
