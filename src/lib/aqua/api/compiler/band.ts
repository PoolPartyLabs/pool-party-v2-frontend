import "server-only";

import { instructions } from "@1inch/swap-vm-sdk";
import { DECIMALS, TOKENS } from "../../config/addresses";
import type { CompiledBand } from "./types";

/**
 * Band math for `concentrateGrowLiquidity2D`.
 *
 * The instruction takes sqrt prices in 1e18 fixed point where P = tokenGt / tokenLt in RAW
 * token units, with tokenGt/tokenLt ordered by ADDRESS, not by role. Getting the decimals
 * wrong produces a band nowhere near the market and no error anywhere, so the conversion is
 * derived once here and checked against live ship #0 in the tests.
 *
 * For our pair WETH (0x82aF..., 18dp) < USDC (0xaf88..., 6dp): tokenLt = WETH, tokenGt = USDC,
 * so P is USDC raw units per WETH raw unit and P_x18 works out to `priceUsd * 1e6`, which is
 * just the USDC-decimal representation of the ETH price.
 */

const { ConcentrateGrowLiquidity2DArgs } = instructions.concentrate;

export const BPS = BigInt(10_000);
const CHAINLINK_DECIMALS = 8;
const TEN = BigInt(10);

function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/** Address ordering decides which token is the numerator of P. */
export function orderPair(
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
): { tokenLt: `0x${string}`; tokenGt: `0x${string}` } {
  return BigInt(tokenA) < BigInt(tokenB)
    ? { tokenLt: tokenA, tokenGt: tokenB }
    : { tokenLt: tokenB, tokenGt: tokenA };
}

/**
 * Convert a Chainlink ETH/USD answer (8dp) into the 1e18 fixed-point raw price the concentrate
 * instruction expects.
 *
 * P_x18 = answer * 10^decimalsGt * 1e18 / (10^8 * 10^decimalsLt)
 */
export function ethUsdToRawPriceX18(answerE8: bigint): bigint {
  const { tokenGt } = orderPair(TOKENS.WETH, TOKENS.USDC);
  if (tokenGt.toLowerCase() !== TOKENS.USDC.toLowerCase()) {
    throw new Error("Pair ordering changed: USDC is no longer tokenGt, revisit this conversion");
  }
  const numerator = answerE8 * pow10(DECIMALS.USDC) * pow10(18);
  const denominator = pow10(CHAINLINK_DECIMALS) * pow10(DECIMALS.WETH);
  return numerator / denominator;
}

/**
 * Build a band from negative bps offsets below spot.
 *
 * Only shape is validated here (offsets negative, low below high). The policy checks that can
 * refuse a ship (distance below spot, sleeve size) live in the compiler so every refusal
 * carries the same rule reference.
 */
export function bandFromSpot(
  spotE8: bigint,
  lowOffsetBps: number,
  highOffsetBps: number,
): CompiledBand {
  if (spotE8 <= BigInt(0)) {
    throw new Error(`Chainlink spot must be positive, got ${spotE8}`);
  }
  if (lowOffsetBps >= 0 || highOffsetBps >= 0) {
    throw new Error(
      `Band offsets must be negative (a buy band sits entirely below spot), got low=${lowOffsetBps} high=${highOffsetBps}`,
    );
  }
  if (lowOffsetBps >= highOffsetBps) {
    throw new Error(
      `Band low offset ${lowOffsetBps} must sit further below spot than high offset ${highOffsetBps}`,
    );
  }

  const lowE8 = (spotE8 * (BPS + BigInt(lowOffsetBps))) / BPS;
  const highE8 = (spotE8 * (BPS + BigInt(highOffsetBps))) / BPS;

  return {
    spotE8,
    lowE8,
    highE8,
    rawPriceMinX18: ethUsdToRawPriceX18(lowE8),
    rawPriceMaxX18: ethUsdToRawPriceX18(highE8),
  };
}

/** The SDK owns the sqrt conversion; we never compute sqrt prices by hand. */
export function concentrateArgsFor(band: CompiledBand) {
  return ConcentrateGrowLiquidity2DArgs.fromRawPrices(band.rawPriceMinX18, band.rawPriceMaxX18);
}

export function describeBand(band: CompiledBand): string {
  const usd = (e8: bigint) => (Number(e8) / 1e8).toFixed(2);
  return `spot $${usd(band.spotE8)}, band $${usd(band.lowE8)} .. $${usd(band.highE8)}`;
}
