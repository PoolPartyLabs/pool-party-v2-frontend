/**
 * @id PP-CORE-LIB-017
 * @name gasSelection
 * @implements-rules-version v2
 *
 * Pure gas-amount selection + validation for the buy-gas modal (PP-CORE-MOD-010). Drives the
 * $10/$25/Custom selector: presets are an explicit allowlist (both ≥ the Paybis $10 floor), and the
 * [$10, $200] bounds apply to a Custom amount only. Over-balance is informational, never blocking —
 * if the chosen gas exceeds the wallet's USDC, the rail on-ramps the shortfall (POO-331 R4).
 *
 * No React: the selector component renders these results. Bounds come from the provisioning module
 * so there is a single source of truth (`GAS_CUSTOM_MIN_USD` / `GAS_CUSTOM_MAX_USD`).
 */

import type { GasChoice } from "@/lib/provisioning";
import { GAS_CUSTOM_MAX_USD, GAS_CUSTOM_MIN_USD } from "@/lib/provisioning";

/** Why a gas choice is not yet valid (drives the inline helper + disabled CTA). */
export type GasInvalidReason = "empty" | "belowMin" | "overMax";

/** The validity of a gas choice. `needsOnRamp` is informational (Paybis tops up), not a block. */
export interface GasValidity {
  ok: boolean;
  reason?: GasInvalidReason;
  needsOnRamp?: boolean;
}

/** Build a {@link GasChoice} from a preset tap. */
export function selectPreset(usd: 10 | 25): GasChoice {
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

/** Validate a gas choice against the bounds + balance. Presets bypass the bounds check. */
export function validateGas(choice: GasChoice | null, balanceUsd: number): GasValidity {
  if (!choice) return { ok: false, reason: "empty" };

  const { presetUsd, amountUsd } = choice;
  const isCustom = presetUsd === null;

  if (isCustom) {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { ok: false, reason: "empty" };
    if (amountUsd < GAS_CUSTOM_MIN_USD) return { ok: false, reason: "belowMin" };
    if (amountUsd > GAS_CUSTOM_MAX_USD) return { ok: false, reason: "overMax" };
  }

  // Over-balance does not block: the rail buys the shortfall via Paybis (POO-331 R4).
  return { ok: true, needsOnRamp: amountUsd > balanceUsd };
}
