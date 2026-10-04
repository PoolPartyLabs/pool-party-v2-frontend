/**
 * @id PP-MGR-LIB-030
 * @name fundSlippage
 * @implements-rules-version v1 (POO-2180 rules v1)
 * @analytics-events none (pure maths, no user surface)
 *
 * The Max slippage rule of the fund builder's configuration panels (handoff "Build configuration
 * panels" v1.2, P12, and the row "Max slippage" of "What the deployed alpha and the v2 API
 * change"), with the product owner's decision D-D on open point 16. Slice PB of POO-2171.
 *
 * - [R12] Presets 0.5%, 1% and 2% are 50, 100 and 200 bps. The default is the launch flow's 2%
 *   (`CREATE_POOL_DEFAULT_SLIPPAGE_PCT`); the 5% seed of Move Range and Close is not used here.
 * - [R13] Each keystroke goes through the app's `sanitizeSlippageInput` WITHOUT a `max` of 5:
 *   passing 5 would clamp every keystroke, so the blur could never say it capped (finding 27). A
 *   comma reads as the decimal point and one decimal is kept.
 * - [R14] On blur an empty field goes back to the 2% preset, a value under 0.1 (zero included)
 *   becomes 0.1, and a value above 5 becomes 5 with `capped: true`, so the panel can show
 *   "5% is the maximum." (D-D). The app's `floorSlippage` leaves zero untouched by design, so the
 *   floor is applied here and V1 is not edited.
 * - [R15] The result is `{ pct, bps, preset, capped }`, and `bps` is always an integer from 10 to
 *   500: signed swap routes accept a maximum loss of 0.01% to 5% (`maxLossBps` 1 to 500), and the
 *   launch adapter derives `maxLossBps` with the same `Math.round(slippagePct * 100)`.
 * - [R16] No severity: nothing above 5% is produced, so the High and Very high slippage warnings
 *   (strip 09) cannot occur and are not built (D-D).
 *
 * `preset` names the chip the control shows selected: a preset click, the empty-field fallback and
 * a stored value equal to a preset select one; a typed value keeps the custom field active, so no
 * chip reads as selected (P12, the app's settings dialog does the same).
 */
import {
  CREATE_POOL_DEFAULT_SLIPPAGE_PCT,
  SLIPPAGE_MIN,
  SLIPPAGE_PRESETS,
  sanitizeSlippageInput,
} from "@/features/strategies/lib/slippage";

/** One of the three preset chips, in percent. */
export type FundSlippagePreset = (typeof SLIPPAGE_PRESETS)[number];

/** The preset chips, in percent (R12). */
export const FUND_SLIPPAGE_PRESETS: readonly FundSlippagePreset[] = SLIPPAGE_PRESETS;

/** The default after Use and for an empty field: the launch flow's 2% (R12). */
export const FUND_SLIPPAGE_DEFAULT_PCT: FundSlippagePreset = CREATE_POOL_DEFAULT_SLIPPAGE_PCT;

/** The lowest tolerance a committed value can hold, in percent: 10 bps (R14). */
export const FUND_SLIPPAGE_MIN_PCT = SLIPPAGE_MIN;

/** The highest tolerance a signed swap route accepts, in percent: 500 bps (R14, D-D). */
export const FUND_SLIPPAGE_MAX_PCT = 5;

/** A committed slippage tolerance, as the panel stores and shows it. */
export interface FundSlippage {
  /** The tolerance in percent, from 0.1 to 5, at most one decimal. */
  pct: number;
  /** The same tolerance in basis points, an integer from 10 to 500. */
  bps: number;
  /** The chip that reads as selected, or null while the custom field holds a typed value. */
  preset: FundSlippagePreset | null;
  /** True when a value above 5% was brought down to 5% ("5% is the maximum."). */
  capped: boolean;
}

function slippage(pct: number, preset: FundSlippagePreset | null, capped: boolean): FundSlippage {
  return { pct, bps: Math.round(pct * 100), preset, capped };
}

/** The tolerance of a preset chip (R12). */
export function fundSlippagePreset(preset: FundSlippagePreset): FundSlippage {
  return slippage(preset, preset, false);
}

/** The default tolerance: the 2% preset (R12). */
export function defaultFundSlippage(): FundSlippage {
  return fundSlippagePreset(FUND_SLIPPAGE_DEFAULT_PCT);
}

/**
 * Clean one keystroke of the custom field into its display text (R13): digits and one decimal
 * point, a comma read as that point, one decimal kept. It never caps at 5, so an in-progress "8"
 * stays visible until the blur brings it to 5 and says so.
 */
export function sanitizeFundSlippageInput(text: string): string {
  return sanitizeSlippageInput(text);
}

/**
 * Commit the custom field when it loses focus (R14): an empty or unreadable field goes back to the
 * 2% preset, under 0.1 (zero included) becomes 0.1, above 5 becomes 5 with `capped`. A typed value
 * stays custom, so `preset` is null even when it equals a chip.
 */
export function commitFundSlippageInput(text: string): FundSlippage {
  const value = Number.parseFloat(sanitizeSlippageInput(text));
  if (!Number.isFinite(value)) return defaultFundSlippage();
  if (value > FUND_SLIPPAGE_MAX_PCT) return slippage(FUND_SLIPPAGE_MAX_PCT, null, true);
  if (value < FUND_SLIPPAGE_MIN_PCT) return slippage(FUND_SLIPPAGE_MIN_PCT, null, false);
  return slippage(value, null, false);
}

/**
 * The tolerance of a stored `slippagePct`, so the control can seed itself from an applied block:
 * the chip it equals reads as selected, any other value is custom to one decimal, and it is held
 * inside 0.1 to 5 like a typed value (`capped` when it was above 5). A value that is not a finite
 * number reads as the default.
 */
export function fundSlippageFromPct(pct: number): FundSlippage {
  if (!Number.isFinite(pct)) return defaultFundSlippage();
  const held = Math.min(FUND_SLIPPAGE_MAX_PCT, Math.max(FUND_SLIPPAGE_MIN_PCT, pct));
  const tenths = Math.round(held * 10) / 10;
  const preset = FUND_SLIPPAGE_PRESETS.find((chip) => chip === tenths) ?? null;
  return slippage(tenths, preset, pct > FUND_SLIPPAGE_MAX_PCT);
}
