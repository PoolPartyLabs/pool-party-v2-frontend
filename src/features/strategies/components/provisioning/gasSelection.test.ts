/**
 * @id PP-CORE-LIB-017
 * @name gasSelection tests
 * @implements-rules-version v2
 *
 * Pure gas-amount selection + validation for the buy-gas modal. Presets ($10/$25) are an explicit
 * allowlist; the [$10, $200] bounds apply to Custom only. Over-balance never blocks (the rail
 * on-ramps the shortfall — POO-331 R4).
 */
import { describe, expect, it } from "vitest";
import { GAS_CUSTOM_MAX_USD, GAS_CUSTOM_MIN_USD, GAS_PRESETS_USD } from "@/lib/provisioning";
import { parseGasAmount, selectCustom, selectPreset, validateGas } from "./gasSelection";

describe("GAS_PRESETS_USD coupling", () => {
  it("is [10, 25] — if this drifts, update GasChoice.presetUsd + selectPreset", () => {
    expect([...GAS_PRESETS_USD]).toEqual([10, 25]);
  });
});

describe("selectPreset", () => {
  it("builds a GasChoice with presetUsd + matching amount", () => {
    expect(selectPreset(10)).toEqual({ presetUsd: 10, amountUsd: 10 });
    expect(selectPreset(25)).toEqual({ presetUsd: 25, amountUsd: 25 });
  });
});

describe("parseGasAmount", () => {
  it("parses a plain number", () => {
    expect(parseGasAmount("50")).toBe(50);
    expect(parseGasAmount("12.5")).toBe(12.5);
  });
  it("strips a currency symbol and spaces", () => {
    expect(parseGasAmount("$30 ")).toBe(30);
  });
  it("returns NaN for empty/garbage", () => {
    expect(Number.isNaN(parseGasAmount(""))).toBe(true);
    expect(Number.isNaN(parseGasAmount("abc"))).toBe(true);
    expect(Number.isNaN(parseGasAmount("."))).toBe(true);
  });
});

describe("selectCustom", () => {
  it("builds a custom GasChoice (presetUsd null)", () => {
    expect(selectCustom("50")).toEqual({ presetUsd: null, amountUsd: 50 });
  });
  it("carries NaN for an unparseable amount", () => {
    expect(Number.isNaN(selectCustom("").amountUsd)).toBe(true);
  });
});

describe("validateGas", () => {
  const BAL = 1_000;

  it("rejects null and empty custom as 'empty'", () => {
    expect(validateGas(null, BAL)).toMatchObject({ ok: false, reason: "empty" });
    expect(validateGas(selectCustom(""), BAL)).toMatchObject({ ok: false, reason: "empty" });
  });

  it("accepts both presets regardless of the custom min", () => {
    expect(validateGas(selectPreset(10), BAL).ok).toBe(true);
    expect(validateGas(selectPreset(25), BAL).ok).toBe(true);
  });

  it("rejects a custom amount below the min", () => {
    expect(validateGas(selectCustom("5"), BAL)).toMatchObject({ ok: false, reason: "belowMin" });
  });

  it("accepts a custom amount at the min boundary", () => {
    expect(validateGas(selectCustom(String(GAS_CUSTOM_MIN_USD)), BAL).ok).toBe(true);
  });

  it("rejects a custom amount above the max", () => {
    expect(validateGas(selectCustom(String(GAS_CUSTOM_MAX_USD + 1)), BAL)).toMatchObject({
      ok: false,
      reason: "overMax",
    });
  });

  it("flags needsOnRamp when the amount exceeds USDC balance, but does NOT block (R4)", () => {
    const v = validateGas(selectPreset(25), 5);
    expect(v.ok).toBe(true);
    expect(v.needsOnRamp).toBe(true);
  });

  it("does not flag needsOnRamp when the balance covers it", () => {
    expect(validateGas(selectPreset(10), 1_000).needsOnRamp).toBe(false);
  });
});
