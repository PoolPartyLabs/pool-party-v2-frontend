import { describe, expect, it } from "vitest";
import { buildInvestReturnHref, parseInvestParams } from "./investContext";

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

describe("V2 funding identity (POO-2217 R2)", () => {
  const core = `0x${"1".repeat(40)}`;
  const wallet = `0x${"2".repeat(40)}`;
  const query = {
    family: "v2",
    core,
    account: wallet,
    amount: "9.123456",
    invest: "10.123456",
    from: "portfolio",
  };

  it("keeps a fund identity separate from a V1 strategy", () => {
    expect(parseInvestParams(query)).toEqual({
      family: "v2",
      core,
      wallet,
      shortfall: 9.123456,
      investAmount: 10.123456,
      origin: "investor",
      fromPortfolio: true,
    });
  });

  it("never falls back to V1 on malformed or mixed family context", () => {
    expect(parseInvestParams({ ...query, core: "not-an-address", strategy: "s1" })).toBeNull();
    expect(parseInvestParams({ ...query, account: undefined })).toBeNull();
    expect(parseInvestParams({ family: "v3", strategy: "s1" })).toBeNull();
  });

  it("rejects V2 amounts with excess precision, exponents or trailing text", () => {
    for (const invest of ["10.1234567", "1e3", "10usd", "Infinity", "-1"]) {
      expect(parseInvestParams({ ...query, invest })?.investAmount).toBeUndefined();
    }
  });

  it("returns to fund amount with portfolio and account context, without a signing flag", () => {
    const context = parseInvestParams(query);
    expect(context).not.toBeNull();
    expect(buildInvestReturnHref(context, wallet)).toBe(
      `/funds/${core}?invest=10.123456&account=${wallet}&from=portfolio`,
    );
    expect(buildInvestReturnHref(context, `0x${"3".repeat(40)}`)).toBeNull();
    expect(buildInvestReturnHref(context, null)).toBeNull();
  });

  it("preserves the exact legacy investor and manager return URLs", () => {
    expect(buildInvestReturnHref(parseInvestParams({ strategy: "s1", invest: "100" }))).toBe(
      "/strategies/s1?invest=100",
    );
    expect(
      buildInvestReturnHref(
        parseInvestParams({ strategy: "s1", origin: "manager", invest: "100" }),
      ),
    ).toBe("/manager?manage=s1&invest=100");
  });
});
