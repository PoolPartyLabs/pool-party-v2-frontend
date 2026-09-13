/**
 * @id PP-CORE-LIB-017
 * @name gasSelection tests
 * @implements-rules-version v2
 *
 * Pure gas-amount selection + validation for the buy-gas modal. Presets are an explicit allowlist,
 * per funding source, and a preset the source does not offer is rejected; the numeric [min, $200]
 * bounds apply to Custom. Over-balance never blocks (the rail on-ramps the shortfall — POO-331 R4).
 */
import { describe, expect, it } from "vitest";
import { GAS_CUSTOM_MAX_USD, GAS_CUSTOM_MIN_USD, GAS_PRESETS_USD } from "@/lib/provisioning";
import {
  gasMaxUsd,
  gasMinUsd,
  gasPresets,
  parseGasAmount,
  selectCustom,
  selectPreset,
  validateGas,
} from "./gasSelection";

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

/**
 * POO-1084 [F1-R4]/[F1-R5]. The $10 floor is the PAYBIS FIAT minimum, and a swap out of USDC the
 * user already holds is not a fiat purchase: it has no such floor. So the presets and the custom
 * minimum are a property of where the gas is paid from, not a global constant.
 */
describe("per-source presets", () => {
  const BAL = 1_000;

  it("[F1-R4] USDC offers $5/$10, card offers $10/$25", () => {
    expect([...gasPresets("usdc")]).toEqual([5, 10]);
    expect([...gasPresets("card")]).toEqual([10, 25]);
  });

  it("[F1-R4] the custom minimum follows the source; the maximum does not", () => {
    expect(gasMinUsd("usdc")).toBe(5);
    expect(gasMinUsd("card")).toBe(GAS_CUSTOM_MIN_USD);
    expect(gasMaxUsd("usdc")).toBe(GAS_CUSTOM_MAX_USD);
    expect(gasMaxUsd("card")).toBe(GAS_CUSTOM_MAX_USD);
  });

  it("[F1-R4] $5 is a valid custom amount out of USDC and not on card", () => {
    expect(validateGas(selectCustom("5"), BAL, "usdc").ok).toBe(true);
    expect(validateGas(selectCustom("5"), BAL, "card")).toMatchObject({
      ok: false,
      reason: "belowMin",
    });
  });

  it("[F1-R4] below the USDC floor is still below a floor", () => {
    expect(validateGas(selectCustom("4.99"), BAL, "usdc")).toMatchObject({
      ok: false,
      reason: "belowMin",
    });
  });

  it("[F1-R4] the $200 ceiling holds for both sources", () => {
    expect(validateGas(selectCustom("201"), BAL, "usdc")).toMatchObject({
      ok: false,
      reason: "overMax",
    });
    expect(validateGas(selectCustom("201"), BAL, "card")).toMatchObject({
      ok: false,
      reason: "overMax",
    });
  });

  it("[F1-R4] a $5 preset is accepted on the USDC path", () => {
    expect(selectPreset(5)).toEqual({ presetUsd: 5, amountUsd: 5 });
    expect(validateGas(selectPreset(5), BAL, "usdc").ok).toBe(true);
  });

  it("[F1-R5] omitting the source keeps today's card behaviour, byte for byte", () => {
    // Every existing call site passes two arguments. If this default ever moves, the buy-gas modal
    // silently starts accepting amounts Paybis will refuse.
    expect(validateGas(selectCustom("5"), BAL)).toEqual(
      validateGas(selectCustom("5"), BAL, "card"),
    );
    expect(validateGas(selectCustom("50"), BAL)).toEqual(
      validateGas(selectCustom("50"), BAL, "card"),
    );
    expect(validateGas(null, BAL)).toEqual(validateGas(null, BAL, "card"));
  });

  it("[F1-R4] a preset the source does not offer is rejected", () => {
    // The allowlist is per-source since [F1-R4], so a preset CAN be out of bounds: $5 is a usdc
    // preset and, on the card path, an amount Paybis refuses. Enforcing the floor for Custom only
    // let it through.
    expect(validateGas(selectPreset(5), BAL, "card")).toMatchObject({
      ok: false,
      reason: "belowMin",
    });
    expect(validateGas(selectPreset(25), BAL, "usdc").ok).toBe(false);
  });

  it("[F1-R5] every preset a source DOES offer stays valid", () => {
    expect(validateGas(selectPreset(10), BAL, "card").ok).toBe(true);
    expect(validateGas(selectPreset(25), BAL, "card").ok).toBe(true);
    expect(validateGas(selectPreset(5), BAL, "usdc").ok).toBe(true);
    expect(validateGas(selectPreset(10), BAL, "usdc").ok).toBe(true);
  });

  it("over-balance still never blocks, on either source (POO-331 R4)", () => {
    expect(validateGas(selectPreset(10), 1, "usdc")).toMatchObject({
      ok: true,
      needsOnRamp: true,
    });
  });
});
