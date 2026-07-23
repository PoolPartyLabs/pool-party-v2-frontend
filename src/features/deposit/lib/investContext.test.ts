import { describe, expect, it } from "vitest";
import { parseInvestParams } from "./investContext";

describe("parseInvestParams", () => {
  // @rule POO-494 R1: the context exists whenever a strategy id is in the URL.
  it("parses a complete deep link", () => {
    expect(parseInvestParams({ strategy: "s1", amount: "97.93", invest: "100" })).toEqual({
      strategyId: "s1",
      shortfall: 97.93,
      investAmount: 100,
      origin: "investor",
    });
  });

  it("returns null without a strategy id", () => {
    expect(parseInvestParams({ amount: "97.93", invest: "100" })).toBeNull();
    expect(parseInvestParams({ strategy: "" })).toBeNull();
    expect(parseInvestParams({ strategy: ["a", "b"] })).toBeNull();
  });

  // @rule POO-494 R2: a bad shortfall drops only the prefill, never the context.
  it("zeroes an invalid shortfall but keeps the context", () => {
    expect(parseInvestParams({ strategy: "s1", amount: "abc", invest: "100" })).toEqual({
      strategyId: "s1",
      shortfall: 0,
      investAmount: 100,
      origin: "investor",
    });
    expect(parseInvestParams({ strategy: "s1", amount: "-5" })?.shortfall).toBe(0);
    expect(parseInvestParams({ strategy: "s1" })?.shortfall).toBe(0);
  });

  // @rule POO-494 R2: invest must be finite, positive and >= shortfall, else treated as absent.
  it("drops an inconsistent invest amount", () => {
    expect(parseInvestParams({ strategy: "s1", amount: "150", invest: "100" })?.investAmount).toBe(
      undefined,
    );
    expect(parseInvestParams({ strategy: "s1", amount: "150", invest: "abc" })?.investAmount).toBe(
      undefined,
    );
    expect(parseInvestParams({ strategy: "s1", amount: "150", invest: "-1" })?.investAmount).toBe(
      undefined,
    );
  });

  it("keeps invest when it equals the shortfall", () => {
    expect(parseInvestParams({ strategy: "s1", amount: "150", invest: "150" })?.investAmount).toBe(
      150,
    );
  });

  // @rule POO-520 R1: a manager-console origin travels in the context so the resume returns there.
  it("parses origin=manager into a manager-origin context", () => {
    expect(
      parseInvestParams({ strategy: "s1", amount: "97.93", invest: "100", origin: "manager" }),
    ).toEqual({
      strategyId: "s1",
      shortfall: 97.93,
      investAmount: 100,
      origin: "manager",
    });
  });

  // @rule POO-520 R2: anything but the exact "manager" value keeps the investor origin (validated).
  it("defaults to the investor origin when the param is absent or unrecognized", () => {
    expect(parseInvestParams({ strategy: "s1" })?.origin).toBe("investor");
    expect(parseInvestParams({ strategy: "s1", origin: "console" })?.origin).toBe("investor");
    expect(parseInvestParams({ strategy: "s1", origin: ["manager"] })?.origin).toBe("investor");
    expect(parseInvestParams({ strategy: "s1", origin: "" })?.origin).toBe("investor");
  });
});
