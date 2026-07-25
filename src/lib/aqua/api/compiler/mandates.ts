import "server-only";

import { TOKENS } from "../../config/addresses";
import type { Mandate, MandateName } from "./types";

/**
 * The two mandates shipped at launch (execution plan section 6.1).
 *
 * They exist together on purpose: one vault backs two simultaneous strategies with the same
 * capital, and the demo band sits close enough to market that fills execute without waiting
 * for a real dip. Combined shipped quote must stay inside the 10% sleeve (PRG-R5/R6), which
 * the compiler enforces through `alreadyShipped`.
 */

const PAIR = { base: TOKENS.WETH, quote: TOKENS.USDC } as const;

/** D4: 80 bps flat fee. D5: 3-day epoch, 10% sleeve. */
const SHARED = {
  pair: PAIR,
  feeBps: 80,
  epochDays: 3,
  bandSleevePct: 10,
} as const;

export const MANDATES: Record<MandateName, Mandate> = {
  /**
   * The real product: buy the dip between 15% and 5% below spot. This band only fills when
   * the market actually dips into it, which is the point.
   */
  production: {
    ...SHARED,
    bandLowPct: -1500,
    bandHighPct: -500,
    maxPerShip: BigInt(150_000_000), // 150 USDC
    minBelowSpotBps: 200,
  },

  /**
   * Approved demo band, spot-0.3% .. spot-0.1%. Close enough to market that our own taker can
   * settle against it on stage without simulating a crash.
   *
   * `minBelowSpotBps` is 10 rather than 200 because the band top is only 10 bps below spot.
   * PRG-R3's flat 200 bps would refuse this mandate outright. The hard invariant that the
   * whole band sits strictly below spot still applies and is checked unconditionally.
   */
  demo: {
    ...SHARED,
    bandLowPct: -30,
    bandHighPct: -10,
    maxPerShip: BigInt(50_000_000), // 50 USDC
    minBelowSpotBps: 10,
  },
};

export function mandateFor(name: MandateName): Mandate {
  const mandate = MANDATES[name];
  if (!mandate)
    throw new Error(`Unknown mandate "${name}". Known: ${Object.keys(MANDATES).join(", ")}`);
  return mandate;
}
