/**
 * @id PP-MGR-LIB-030
 * @name fundSlippage tests
 * @implements-rules-version v1 (POO-2180 rules v1)
 * @analytics-events none (pure maths, no user surface)
 *
 * Covers R12 to R16 of POO-2180: the three presets and their basis points, the launch flow's 2%
 * default, the per-keystroke sanitiser that never caps at 5, the blur rules (an empty field goes
 * back to 2%, under 0.1 with zero included goes up to 0.1, above 5 comes down to 5 and says so,
 * decision D-D), the 10 to 500 bps invariant and the absence of any severity warning.
 */
import { describe, expect, it } from "vitest";
import {
  CREATE_POOL_DEFAULT_SLIPPAGE_PCT,
  MANAGER_DEFAULT_SLIPPAGE_PCT,
  slippageSeverity,
} from "@/features/strategies/lib/slippage";
import {
  commitFundSlippageInput,
  defaultFundSlippage,
  FUND_SLIPPAGE_DEFAULT_PCT,
  FUND_SLIPPAGE_MAX_PCT,
  FUND_SLIPPAGE_MIN_PCT,
  FUND_SLIPPAGE_PRESETS,
  type FundSlippage,
  fundSlippageFromPct,
  fundSlippagePreset,
  sanitizeFundSlippageInput,
} from "./fundSlippage";

/** Every value the blur can produce must be one a signed swap accepts (finding 27, D-D). */
function expectSignable(out: FundSlippage): void {
  expect(out.pct).toBeGreaterThanOrEqual(FUND_SLIPPAGE_MIN_PCT);
  expect(out.pct).toBeLessThanOrEqual(FUND_SLIPPAGE_MAX_PCT);
  expect(Number.isInteger(out.bps)).toBe(true);
  expect(out.bps).toBeGreaterThanOrEqual(10);
  expect(out.bps).toBeLessThanOrEqual(500);
  // The launch adapter derives `maxLossBps` as Math.round(slippagePct * 100): same number.
  expect(out.bps).toBe(Math.round(out.pct * 100));
}

describe("presets", () => {
  it("offers 0.5%, 1% and 2%, mapping to 50, 100 and 200 bps", () => {
    // @rule R12
    expect(FUND_SLIPPAGE_PRESETS).toEqual([0.5, 1, 2]);
    expect(FUND_SLIPPAGE_PRESETS.map((preset) => fundSlippagePreset(preset))).toEqual([
      { pct: 0.5, bps: 50, preset: 0.5, capped: false },
      { pct: 1, bps: 100, preset: 1, capped: false },
      { pct: 2, bps: 200, preset: 2, capped: false },
    ]);
  });

  it("defaults to the launch flow's 2%, not the 5% seed of Move Range and Close", () => {
    // @rule R12
    expect(FUND_SLIPPAGE_DEFAULT_PCT).toBe(CREATE_POOL_DEFAULT_SLIPPAGE_PCT);
    expect(FUND_SLIPPAGE_DEFAULT_PCT).not.toBe(MANAGER_DEFAULT_SLIPPAGE_PCT);
    expect(defaultFundSlippage()).toEqual({ pct: 2, bps: 200, preset: 2, capped: false });
  });

  it("caps the fund panel at 5% (500 bps) and floors it at 0.1% (10 bps)", () => {
    // @rule R15
    expect(FUND_SLIPPAGE_MAX_PCT).toBe(5);
    expect(FUND_SLIPPAGE_MIN_PCT).toBe(0.1);
  });
});

describe("sanitizeFundSlippageInput (per keystroke)", () => {
  it("reads a comma as the decimal point and keeps one decimal", () => {
    // @rule R13
    expect(sanitizeFundSlippageInput("1,7")).toBe("1.7");
    expect(sanitizeFundSlippageInput("1,75")).toBe("1.7");
    expect(sanitizeFundSlippageInput("0.25")).toBe("0.2");
  });

  it("never caps at 5 while the manager types, so the blur can say it did", () => {
    // @rule R13
    expect(sanitizeFundSlippageInput("8")).toBe("8");
    expect(sanitizeFundSlippageInput("12.5")).toBe("12.5");
    expect(sanitizeFundSlippageInput("5.1")).toBe("5.1");
  });

  it("keeps an empty field and an in-progress decimal typeable", () => {
    // @rule R13
    expect(sanitizeFundSlippageInput("")).toBe("");
    expect(sanitizeFundSlippageInput("0.")).toBe("0.");
    expect(sanitizeFundSlippageInput("0")).toBe("0");
  });

  it("drops letters, signs, spaces and extra points", () => {
    // @rule R13
    expect(sanitizeFundSlippageInput("-1a.2.3")).toBe("1.2");
    expect(sanitizeFundSlippageInput(" 2 % ")).toBe("2");
    expect(sanitizeFundSlippageInput("007")).toBe("7");
  });
});

describe("commitFundSlippageInput (on blur)", () => {
  it("brings an empty field back to the 2% preset", () => {
    // @rule R14
    for (const text of ["", "   ", ".", "abc"]) {
      expect(commitFundSlippageInput(text), JSON.stringify(text)).toEqual(defaultFundSlippage());
    }
  });

  it("raises a value under 0.1, zero included, to 0.1", () => {
    // @rule R14
    for (const text of ["0", "0.0", "0.", "0,0", "0.05", "00"]) {
      expect(commitFundSlippageInput(text), text).toEqual({
        pct: 0.1,
        bps: 10,
        preset: null,
        capped: false,
      });
    }
  });

  it("brings a value above 5 down to 5 and tells the caller (D-D)", () => {
    // @rule R14
    for (const text of ["5.1", "8", "20", "100", "250"]) {
      expect(commitFundSlippageInput(text), text).toEqual({
        pct: 5,
        bps: 500,
        preset: null,
        capped: true,
      });
    }
  });

  it("keeps 5 itself without the notice", () => {
    // @rule R14
    expect(commitFundSlippageInput("5")).toEqual({ pct: 5, bps: 500, preset: null, capped: false });
    expect(commitFundSlippageInput("5.0")).toEqual({
      pct: 5,
      bps: 500,
      preset: null,
      capped: false,
    });
  });

  it("keeps a typed value as custom, so no preset reads as selected", () => {
    // @rule R15 (P12: custom active, no preset selected)
    expect(commitFundSlippageInput("1.5")).toEqual({
      pct: 1.5,
      bps: 150,
      preset: null,
      capped: false,
    });
    expect(commitFundSlippageInput("2")).toEqual({ pct: 2, bps: 200, preset: null, capped: false });
    expect(commitFundSlippageInput("0.1")).toEqual({
      pct: 0.1,
      bps: 10,
      preset: null,
      capped: false,
    });
  });

  it("reads a comma typed with the decimal", () => {
    // @rule R13
    expect(commitFundSlippageInput("1,7")).toEqual({
      pct: 1.7,
      bps: 170,
      preset: null,
      capped: false,
    });
  });
});

describe("fundSlippageFromPct (a stored value)", () => {
  it("selects the preset a stored value equals", () => {
    // @rule R15
    expect(fundSlippageFromPct(0.5)).toEqual(fundSlippagePreset(0.5));
    expect(fundSlippageFromPct(1)).toEqual(fundSlippagePreset(1));
    expect(fundSlippageFromPct(2)).toEqual(fundSlippagePreset(2));
  });

  it("keeps any other stored value as custom, to one decimal", () => {
    // @rule R15
    expect(fundSlippageFromPct(1.5)).toEqual({ pct: 1.5, bps: 150, preset: null, capped: false });
    expect(fundSlippageFromPct(1.25)).toEqual({ pct: 1.3, bps: 130, preset: null, capped: false });
  });

  it("never leaves 0.1 to 5, whatever was stored", () => {
    // @rule R15
    expect(fundSlippageFromPct(0)).toEqual({ pct: 0.1, bps: 10, preset: null, capped: false });
    expect(fundSlippageFromPct(-3)).toEqual({ pct: 0.1, bps: 10, preset: null, capped: false });
    expect(fundSlippageFromPct(9)).toEqual({ pct: 5, bps: 500, preset: null, capped: true });
    expect(fundSlippageFromPct(Number.NaN)).toEqual(defaultFundSlippage());
    expect(fundSlippageFromPct(Number.POSITIVE_INFINITY)).toEqual(defaultFundSlippage());
  });
});

describe("basis points", () => {
  it("are always an integer from 10 to 500, for every one-decimal value from 0 to 120", () => {
    // @rule R15
    for (let tenths = 0; tenths <= 1200; tenths += 1) {
      const text = (tenths / 10).toFixed(1);
      expectSignable(commitFundSlippageInput(text));
      expectSignable(commitFundSlippageInput(text.replace(".", ",")));
      expectSignable(fundSlippageFromPct(tenths / 10));
    }
  });

  it("stay signable for junk and extreme input", () => {
    // @rule R15
    for (const text of ["", ".", "-", "1e9", "999999999", "0.00001", "--5", "5..5", "x"]) {
      expectSignable(commitFundSlippageInput(text));
    }
    for (const preset of FUND_SLIPPAGE_PRESETS) expectSignable(fundSlippagePreset(preset));
  });
});

describe("no severity warning", () => {
  it("returns only pct, bps, preset and capped: strip 09 is not built (D-D)", () => {
    // @rule R16
    expect(Object.keys(commitFundSlippageInput("8")).sort()).toEqual([
      "bps",
      "capped",
      "pct",
      "preset",
    ]);
  });

  it("never reaches the app's High slippage band, so its warning cannot show", () => {
    // @rule R16
    for (const text of ["5", "5.1", "8", "20.5", "100", "1000"]) {
      expect(slippageSeverity(commitFundSlippageInput(text).pct), text).toBe("none");
    }
  });
});
