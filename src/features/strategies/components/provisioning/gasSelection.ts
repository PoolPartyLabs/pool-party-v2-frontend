/**
 * @id PP-CORE-LIB-017
 * @name gasSelection
 * @implements-rules-version v3 (POO-1084 rules v1) · v2
 *
 * Pure gas-amount selection + validation for the inline gas control and the buy-gas modal
 * (PP-CORE-MOD-010). Over-balance is informational, never blocking: if the chosen gas exceeds the
 * wallet's USDC, the rail on-ramps the shortfall (POO-331 R4).
 *
 * ## v3: the presets depend on where the gas is paid from (POO-1084 [F1-R4])
 *
 * The `$10 / $25` allowlist and the `[$10, $200]` custom bounds were written for one funding path:
 * buying gas with a card, where `$10` is the **Paybis fiat minimum**. Gas paid by swapping USDC the
 * wallet already holds is not a purchase and has no such floor, so it offers `$5 / $10` and accepts
 * a custom amount down to `$5`.
 *
 * The `$200` ceiling is shared, because it is not a payment-rail constraint: it is the point past
 * which "top up gas" stops being a top-up.
 *
 * `validateGas` takes the source as a trailing parameter defaulting to `"card"`, so every call site
 * written before this change keeps its exact behaviour ([F1-R5]).
 *
 * No React: the selector component renders these results. Bounds come from the provisioning module
 * so there is a single source of truth.
 */

import type { GasChoice } from "@/lib/provisioning";
import {
  GAS_CUSTOM_MAX_USD,
  GAS_CUSTOM_MIN_USD,
  GAS_CUSTOM_MIN_USDC_USD,
  GAS_PRESETS_USD,
  GAS_PRESETS_USDC_USD,
} from "@/lib/provisioning";

/**
 * Where the gas top-up is paid from.
 *
 * `usdc` — swapped out of a holding the wallet already has, on-chain.
 * `card` — bought with fiat through the on-ramp, which imposes its own minimum.
 */
export type GasFundingSource = "usdc" | "card";

/** Why a gas choice is not yet valid (drives the inline helper + disabled CTA). */
export type GasInvalidReason = "empty" | "belowMin" | "overMax";

/** The validity of a gas choice. `needsOnRamp` is informational (Paybis tops up), not a block. */
export interface GasValidity {
  ok: boolean;
  reason?: GasInvalidReason;
  needsOnRamp?: boolean;
}

/** The presets offered for a funding source ([F1-R4]). */
export function gasPresets(source: GasFundingSource): readonly number[] {
  return source === "usdc" ? GAS_PRESETS_USDC_USD : GAS_PRESETS_USD;
}

/** The lowest custom amount a funding source accepts ([F1-R4]). */
export function gasMinUsd(source: GasFundingSource): number {
  return source === "usdc" ? GAS_CUSTOM_MIN_USDC_USD : GAS_CUSTOM_MIN_USD;
}

/** The highest custom amount, which does not depend on the source ([F1-R4]). */
export function gasMaxUsd(_source: GasFundingSource): number {
  return GAS_CUSTOM_MAX_USD;
}

/** Build a {@link GasChoice} from a preset tap. */
export function selectPreset(usd: 5 | 10 | 25): GasChoice {
  return { presetUsd: usd, amountUsd: usd };
}

/** Parse a free-text Custom amount to a number (`NaN` when empty/unparseable). */
export function parseGasAmount(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return Number.NaN;
  return Number.parseFloat(cleaned);
}

/** Build a custom {@link GasChoice} (presetUsd `null`) from the input text. */
export function selectCustom(text: string): GasChoice {
  return { presetUsd: null, amountUsd: parseGasAmount(text) };
}

/**
 * Validate a gas choice against the source's bounds + the balance. A Custom amount is checked
 * against the numeric bounds; a preset is checked for membership in {@link gasPresets} for the
 * source it is being validated against. Membership is not redundant since [F1-R4] split the
 * allowlist per source: `$5` is a `usdc` preset and, on the `card` path, below the Paybis fiat
 * minimum.
 *
 * `source` defaults to `"card"` so pre-POO-1084 call sites are unchanged ([F1-R5]).
 */
export function validateGas(
  choice: GasChoice | null,
  balanceUsd: number,
  source: GasFundingSource = "card",
): GasValidity {
  if (!choice) return { ok: false, reason: "empty" };

  const { presetUsd, amountUsd } = choice;
  const isCustom = presetUsd === null;

  if (isCustom) {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { ok: false, reason: "empty" };
    if (amountUsd < gasMinUsd(source)) return { ok: false, reason: "belowMin" };
    if (amountUsd > gasMaxUsd(source)) return { ok: false, reason: "overMax" };
  } else if (!gasPresets(source).includes(presetUsd)) {
    // Report it the way an out-of-bounds Custom amount is reported, relative to the source's floor.
    return { ok: false, reason: amountUsd < gasMinUsd(source) ? "belowMin" : "overMax" };
  }

  // Over-balance does not block: the rail buys the shortfall via Paybis (POO-331 R4).
  return { ok: true, needsOnRamp: amountUsd > balanceUsd };
}
