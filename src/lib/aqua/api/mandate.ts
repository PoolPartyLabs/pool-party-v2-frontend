import "server-only";

import { MANDATES } from "./compiler/mandates";

/**
 * The investment mandate, in the shape the strategy detail prospectus already renders
 * (assets / protocols / networks), so Active Reserve reads like every other strategy in the
 * catalog rather than like a special case.
 *
 * Everything here is DERIVED from the compiler's mandates and the deployed address config, not
 * typed in twice. The percentages are the real policy numbers: `bandSleevePct` is the share of
 * the vault a band may commit (PRG-R5), so the carry leg is the remainder.
 */

export type MandateEntry = { label: string; maxPct: number };

export type AquaMandateView = {
  assets: MandateEntry[];
  protocols: MandateEntry[];
  networks: string[];
};

/**
 * Total share of the vault that may be committed to buy bands at once, across every mandate.
 * PRG-R6 caps coverage at 1.0, and both launch bands share the single 10% sleeve, so this is
 * the sleeve itself and not the sum of the two mandates.
 */
export const BAND_SLEEVE_PCT = MANDATES.production.bandSleevePct;

/** Whatever is not committed to a band is lent on Aave, earning every block. */
export const CARRY_PCT = 100 - BAND_SLEEVE_PCT;

export function aquaMandate(): AquaMandateView {
  return {
    // USDC is the deposit and settlement asset; WETH is what the bands accumulate. The WETH cap
    // is the sleeve because a fully-filled band converts exactly that much USDC into WETH.
    assets: [
      { label: "USDC", maxPct: 100 },
      { label: "WETH", maxPct: BAND_SLEEVE_PCT },
    ],
    // The two venues this strategy actually touches. Aave v3 holds the carry leg; 1inch Aqua is
    // where the buy bands live and where fills settle.
    protocols: [
      { label: "Aave v3", maxPct: CARRY_PCT },
      { label: "1inch Aqua", maxPct: BAND_SLEEVE_PCT },
    ],
    networks: ["Arbitrum"],
  };
}

/**
 * Composition slices for the stacked bar, mirroring `detail.composition` on the existing screen.
 * Weights come from LIVE balances, so the bar shows what the vault holds right now rather than
 * the designed split. Returns null when there is nothing to show, so the caller can hide the
 * section instead of rendering an empty bar (FE-R7).
 */
export function compositionSlices(input: {
  parkedUsdc: bigint;
  hotBufferUsdc: bigint;
  wethValuedUsdc: bigint;
}): Array<{ label: string; weight: number }> | null {
  const total = input.parkedUsdc + input.hotBufferUsdc + input.wethValuedUsdc;
  if (total <= BigInt(0)) return null;

  const pct = (part: bigint) => Number((part * BigInt(10_000)) / total) / 100;
  return [
    { label: "Lent on Aave", weight: pct(input.parkedUsdc) },
    { label: "Cash on hand", weight: pct(input.hotBufferUsdc) },
    { label: "ETH bought", weight: pct(input.wethValuedUsdc) },
  ].filter((slice) => slice.weight > 0);
}
