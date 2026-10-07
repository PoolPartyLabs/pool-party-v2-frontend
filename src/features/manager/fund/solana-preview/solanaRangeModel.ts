/**
 * @id PP-MGR-LIB-069
 * @name solanaRangeModel
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, pure protocol range presentation; host owns intent
 */
import Decimal from "decimal.js";
import { z } from "zod";
import {
  type SolanaSource,
  solanaAddressSchema,
  solanaRawAmountSchema,
  solanaSourceSchema,
  solanaTokenSchema,
} from "./solanaSchemas";
export interface SolanaRangeDraft {
  tickLower: number;
  tickUpper: number;
  displayInverted: boolean;
}
interface RangeToken {
  kind: "spl";
  network: "solana";
  cluster: "mainnet-beta" | "devnet" | "testnet";
  mint: string;
  decimals: number;
  symbol: string;
  unit: "base-units";
  tokenProgram: string;
  extensions: { status: "unknown" } | { status: "verified"; names: string[] };
}
interface RangeCommon {
  cluster: RangeToken["cluster"];
  program: string;
  pool: string;
  tokenA: RangeToken;
  tokenB: RangeToken;
  status: "available" | "stale";
  source: SolanaSource;
  tickSpacing: number;
  tickCurrent: number;
  sqrtPriceX64: string;
  position: {
    positionId: string;
    pool: string;
    rawLiquidity: string;
    tickLower: number;
    tickUpper: number;
  } | null;
}
export type SolanaRangeContext = RangeCommon &
  (
    | {
        protocol: "orca";
        fee: { kind: "fixed" | "adaptive"; baseFeeRate: string; effectiveFeeRate: string | null };
        tokenBadge: { status: "unknown" } | { status: "verified"; address: string };
      }
    | {
        protocol: "raydium";
        ammConfig: {
          address: string;
          tickSpacing: number;
          tradeFeeRate: string;
          protocolFeeRate: string;
          fundFeeRate: string;
        };
        feeOn: "unknown" | "both" | "tokenA" | "tokenB";
        dynamicFee: "unknown" | "fixed" | "dynamic";
      }
  );

/** Apache-2.0 derived tick math, modified from Rust to TypeScript BigInt for read-only presentation.
 * Orca: Copyright 2022 Orca Foundation. Licensed under the Apache License, Version 2.0;
 * https://www.apache.org/licenses/LICENSE-2.0. Provided AS IS, without warranties or conditions.
 * Source: e528dd23 (2025-02-26), programs/whirlpool/src/math/tick_math.rs.
 * Its sqrt functions match the later f2a3d13 reference byte-for-byte; the later Orca License
 * is not the grant used for this port. No post-license-change implementation is adopted here.
 * Raydium ed1eb41: programs/amm/src/libraries/tick_math.rs
 * Raydium's source is separately licensed under Apache-2.0; upstream notices govern this port.
 * These differing rounding constants are deliberately never shared with Uniswap.
 */
const ORCA_POSITIVE = [
  "79232123823359799118286999567",
  "79236085330515764027303304731",
  "79244008939048815603706035061",
  "79259858533276714757314932305",
  "79291567232598584799939703904",
  "79355022692464371645785046466",
  "79482085999252804386437311141",
  "79736823300114093921829183326",
  "80248749790819932309965073892",
  "81282483887344747381513967011",
  "83390072131320151908154831281",
  "87770609709833776024991924138",
  "97234110755111693312479820773",
  "119332217159966728226237229890",
  "179736315981702064433883588727",
  "407748233172238350107850275304",
  "2098478828474011932436660412517",
  "55581415166113811149459800483533",
  "38992368544603139932233054999993551",
].map((value) => BigInt(value));
const ORCA_NEGATIVE = [
  "18445821805675392311",
  "18444899583751176498",
  "18443055278223354162",
  "18439367220385604838",
  "18431993317065449817",
  "18417254355718160513",
  "18387811781193591352",
  "18329067761203520168",
  "18212142134806087854",
  "17980523815641551639",
  "17526086738831147013",
  "16651378430235024244",
  "15030750278693429944",
  "12247334978882834399",
  "8131365268884726200",
  "3584323654723342297",
  "696457651847595233",
  "26294789957452057",
  "37481735321082",
].map((value) => BigInt(value));
const RAYDIUM_NEGATIVE = [
  "0xfffcb933bd6fb800",
  "0xfff97272373d4000",
  "0xfff2e50f5f657000",
  "0xffe5caca7e10f000",
  "0xffcb9843d60f7000",
  "0xff973b41fa98e800",
  "0xff2ea16466c9b000",
  "0xfe5dee046a9a3800",
  "0xfcbe86c7900bb000",
  "0xf987a7253ac65800",
  "0xf3392b0822bb6000",
  "0xe7159475a2caf000",
  "0xd097f3bdfd2f2000",
  "0xa9f746462d9f8000",
  "0x70d869a156f31c00",
  "0x31be135f97ed3200",
  "0x9aa508b5b85a500",
  "0x5d6af8dedc582c",
  "0x2216e584f5fa",
].map((value) => BigInt(value));

const Q64 = BigInt("18446744073709551616");
const Q96 = BigInt("79228162514264337593543950336");
const U128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);
const D = Decimal.clone({
  precision: 100,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -1000,
  toExpPos: 1000,
});
export const SOLANA_TICK_DOMAIN = { min: -443636, max: 443636 } as const;
/** Decimal metadata can place 100 significant digits after more than 255 leading zeroes. */
export const SOLANA_RANGE_INPUT_MAX_LENGTH = 600;
export const SOLANA_RANGE_SOURCE_REFS = {
  orca: "https://github.com/orca-so/whirlpools/blob/e528dd23bb41571f92cfdb49a2f15d4fa0b01bec/programs/whirlpool/src/math/tick_math.rs",
  raydium:
    "https://github.com/raydium-io/raydium-clmm/blob/ed1eb41519d5355755f7df52b43fa9610938b60b/programs/amm/src/libraries/tick_math.rs",
} as const;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** For validated 32-byte public keys, integer order is lexicographic byte order, never text order. */
function mintBytesValue(mint: string): bigint {
  let value = BigInt(0);
  for (const char of mint) value = value * BigInt(58) + BigInt(BASE58_ALPHABET.indexOf(char));
  return value;
}
export function solanaSqrtPriceAtTick(protocol: "orca" | "raydium", tick: number): string | null {
  if (!Number.isInteger(tick) || tick < SOLANA_TICK_DOMAIN.min || tick > SOLANA_TICK_DOMAIN.max)
    return null;
  const bits = Math.abs(tick);
  const positive = protocol === "orca" && tick >= 0;
  const factors =
    protocol === "raydium" ? RAYDIUM_NEGATIVE : positive ? ORCA_POSITIVE : ORCA_NEGATIVE;
  let ratio = positive ? Q96 : Q64;
  for (let bit = 0; bit < factors.length; bit++) {
    if ((bits & (1 << bit)) !== 0)
      ratio = (ratio * (factors[bit] as bigint)) >> BigInt(positive ? 96 : 64);
  }
  if (protocol === "raydium" && tick > 0) ratio = U128_MAX / ratio;
  return (positive ? ratio >> BigInt(32) : ratio).toString();
}
const readToken = z
  .object({
    kind: z.literal("spl"),
    network: z.literal("solana"),
    cluster: z.enum(["mainnet-beta", "devnet", "testnet"]),
    mint: solanaAddressSchema,
    decimals: z.number().int().min(0).max(255),
    symbol: z.string().min(1).max(32),
    unit: z.literal("base-units"),
    tokenProgram: solanaAddressSchema,
    extensions: z.discriminatedUnion("status", [
      z.object({ status: z.literal("unknown") }).strict(),
      z
        .object({
          status: z.literal("verified"),
          names: z.array(z.string().min(1).max(64)).max(32),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { tokenProgram: _program, extensions: _extensions, ...token } = value;
    if (!solanaTokenSchema.safeParse(token).success)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Canonical token metadata required" });
  });
const tick = z.number().int().min(SOLANA_TICK_DOMAIN.min).max(SOLANA_TICK_DOMAIN.max);
const rate = solanaRawAmountSchema.refine(
  (value) => solanaRawAmountSchema.safeParse(value).success && BigInt(value) <= BigInt(1000000),
);
const common = {
  cluster: z.enum(["mainnet-beta", "devnet", "testnet"]),
  program: solanaAddressSchema,
  pool: solanaAddressSchema,
  tokenA: readToken,
  tokenB: readToken,
  status: z.enum(["available", "stale"]),
  source: solanaSourceSchema,
  tickSpacing: z.number().int().min(1).max(65535),
  tickCurrent: tick,
  sqrtPriceX64: solanaRawAmountSchema,
  position: z
    .object({
      positionId: solanaAddressSchema,
      pool: solanaAddressSchema,
      rawLiquidity: solanaRawAmountSchema.refine(
        (value) => solanaRawAmountSchema.safeParse(value).success && BigInt(value) <= U128_MAX,
      ),
      tickLower: tick,
      tickUpper: tick,
    })
    .strict()
    .nullable(),
};
export const solanaRangeContextSchema = z
  .discriminatedUnion("protocol", [
    z
      .object({
        ...common,
        protocol: z.literal("orca"),
        fee: z
          .object({
            kind: z.enum(["fixed", "adaptive"]),
            baseFeeRate: rate,
            effectiveFeeRate: rate.nullable(),
          })
          .strict(),
        tokenBadge: z.discriminatedUnion("status", [
          z.object({ status: z.literal("unknown") }).strict(),
          z.object({ status: z.literal("verified"), address: solanaAddressSchema }).strict(),
        ]),
      })
      .strict(),
    z
      .object({
        ...common,
        protocol: z.literal("raydium"),
        ammConfig: z
          .object({
            address: solanaAddressSchema,
            tickSpacing: z.number().int().min(1).max(1000),
            tradeFeeRate: rate,
            protocolFeeRate: rate,
            fundFeeRate: rate,
          })
          .strict(),
        feeOn: z.enum(["unknown", "both", "tokenA", "tokenB"]),
        dynamicFee: z.enum(["unknown", "fixed", "dynamic"]),
      })
      .strict(),
  ])
  .superRefine((context, ctx) => {
    const problem = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    // Refinement still runs for a dirty child validation result. Never parse unvalidated raw text.
    if (
      !tick.safeParse(context.tickCurrent).success ||
      !solanaRawAmountSchema.safeParse(context.sqrtPriceX64).success
    )
      return;
    if (
      context.tokenA.mint === context.tokenB.mint ||
      context.tokenA.cluster !== context.cluster ||
      context.tokenB.cluster !== context.cluster
    )
      problem("Distinct canonical mints on same cluster required");
    if (
      solanaAddressSchema.safeParse(context.tokenA.mint).success &&
      solanaAddressSchema.safeParse(context.tokenB.mint).success &&
      mintBytesValue(context.tokenA.mint) >= mintBytesValue(context.tokenB.mint)
    )
      problem("Protocol mints must retain canonical byte order");
    if (context.protocol === "raydium" && context.ammConfig.tickSpacing !== context.tickSpacing)
      problem("AmmConfig grid mismatch");
    const price = BigInt(context.sqrtPriceX64);
    const min = BigInt(solanaSqrtPriceAtTick(context.protocol, SOLANA_TICK_DOMAIN.min) as string);
    const max = BigInt(solanaSqrtPriceAtTick(context.protocol, SOLANA_TICK_DOMAIN.max) as string);
    if (price < min || price > max || (context.protocol === "raydium" && price === max))
      problem("Current sqrt price outside protocol domain");
    const lower = BigInt(solanaSqrtPriceAtTick(context.protocol, context.tickCurrent) as string);
    const upper =
      context.tickCurrent === SOLANA_TICK_DOMAIN.max
        ? max
        : BigInt(solanaSqrtPriceAtTick(context.protocol, context.tickCurrent + 1) as string);
    // At an exact initialized boundary a decreasing swap may retain tickCurrent = boundary - 1.
    if (price < lower || price > upper) problem("Current tick and sqrt price mismatch");
    if (
      context.position &&
      (context.position.pool !== context.pool ||
        validateSolanaRange(context as SolanaRangeContext, {
          ...context.position,
          displayInverted: false,
        }) !== "valid")
    )
      problem("Position pool/range mismatch");
  });
export function inspectSolanaRangeContext(value: unknown): {
  status: "available" | "stale" | "unavailable";
  context: SolanaRangeContext | null;
} {
  const parsed = solanaRangeContextSchema.safeParse(value);
  return parsed.success
    ? { status: parsed.data.status, context: parsed.data }
    : { status: "unavailable", context: null };
}
function priceFromSqrt(context: SolanaRangeContext, sqrt: string): Decimal {
  return new D(sqrt)
    .div(Q64.toString())
    .pow(2)
    .mul(new D(10).pow(context.tokenA.decimals - context.tokenB.decimals));
}
export function currentSolanaPrice(context: SolanaRangeContext): string | null {
  if (!inspectSolanaRangeContext(context).context) return null;
  return priceFromSqrt(context, context.sqrtPriceX64).toFixed();
}
export function validateSolanaRange(
  context: SolanaRangeContext,
  range: SolanaRangeDraft,
): "valid" | "off-grid" | "out-of-domain" | "collapsed" | "full-only" {
  if (
    !Number.isInteger(range.tickLower) ||
    !Number.isInteger(range.tickUpper) ||
    range.tickLower < SOLANA_TICK_DOMAIN.min ||
    range.tickUpper > SOLANA_TICK_DOMAIN.max
  )
    return "out-of-domain";
  if (
    !Number.isInteger(context.tickSpacing) ||
    context.tickSpacing < 1 ||
    range.tickLower % context.tickSpacing !== 0 ||
    range.tickUpper % context.tickSpacing !== 0
  )
    return "off-grid";
  if (range.tickLower >= range.tickUpper) return "collapsed";
  if (context.protocol === "orca" && context.tickSpacing >= 32768) {
    const bounds = usableSolanaBounds(context);
    if (range.tickLower !== bounds.min || range.tickUpper !== bounds.max) return "full-only";
  }
  return "valid";
}
export function usableSolanaBounds(context: Pick<SolanaRangeContext, "tickSpacing">) {
  return {
    min: Math.ceil(SOLANA_TICK_DOMAIN.min / context.tickSpacing) * context.tickSpacing,
    max: Math.floor(SOLANA_TICK_DOMAIN.max / context.tickSpacing) * context.tickSpacing,
  };
}
export function displaySolanaRange(
  context: SolanaRangeContext,
  range: SolanaRangeDraft,
): { min: string; max: string; base: RangeToken; quote: RangeToken } | null {
  if (
    !inspectSolanaRangeContext(context).context ||
    validateSolanaRange(context, range) !== "valid"
  )
    return null;
  const min = priceFromSqrt(
    context,
    solanaSqrtPriceAtTick(context.protocol, range.tickLower) as string,
  );
  const max = priceFromSqrt(
    context,
    solanaSqrtPriceAtTick(context.protocol, range.tickUpper) as string,
  );
  return range.displayInverted
    ? {
        min: new D(1).div(max).toFixed(),
        max: new D(1).div(min).toFixed(),
        base: context.tokenB,
        quote: context.tokenA,
      }
    : { min: min.toFixed(), max: max.toFixed(), base: context.tokenA, quote: context.tokenB };
}
function nearestPriceTick(context: SolanaRangeContext, price: Decimal): number | null {
  const canonicalMin = priceFromSqrt(
    context,
    solanaSqrtPriceAtTick(context.protocol, SOLANA_TICK_DOMAIN.min) as string,
  );
  const canonicalMax = priceFromSqrt(
    context,
    solanaSqrtPriceAtTick(context.protocol, SOLANA_TICK_DOMAIN.max) as string,
  );
  if (price.lt(canonicalMin) || price.gt(canonicalMax)) return null;
  // Search official rounded Q64 tick values. Log/float approximations never choose the stored tick.
  let low: number = SOLANA_TICK_DOMAIN.min,
    high: number = SOLANA_TICK_DOMAIN.max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (priceFromSqrt(context, solanaSqrtPriceAtTick(context.protocol, mid) as string).lte(price))
      low = mid;
    else high = mid - 1;
  }
  const bounds = usableSolanaBounds(context);
  const before = Math.max(bounds.min, Math.floor(low / context.tickSpacing) * context.tickSpacing);
  const after = Math.min(bounds.max, before + context.tickSpacing);
  const a = priceFromSqrt(context, solanaSqrtPriceAtTick(context.protocol, before) as string);
  const b = priceFromSqrt(context, solanaSqrtPriceAtTick(context.protocol, after) as string);
  // Distance in tick space is distance in log-price. Geometric midpoint avoids float logs.
  return price.pow(2).lt(a.mul(b)) ? before : after;
}
export function snapSolanaRangePrice(
  context: SolanaRangeContext,
  range: SolanaRangeDraft,
  bound: "min" | "max",
  input: string,
): SolanaRangeDraft | null {
  if (
    inspectSolanaRangeContext(context).status !== "available" ||
    input.length > SOLANA_RANGE_INPUT_MAX_LENGTH ||
    !/^\d+(\.\d+)?$/.test(input)
  )
    return null;
  let price = new D(input);
  if (!price.isPositive()) return null;
  if (range.displayInverted) price = new D(1).div(price);
  const tick = nearestPriceTick(context, price);
  if (tick === null) return null;
  const key = range.displayInverted
    ? bound === "min"
      ? "tickUpper"
      : "tickLower"
    : bound === "min"
      ? "tickLower"
      : "tickUpper";
  return { ...range, [key]: tick };
}
export function presetSolanaRange(
  context: SolanaRangeContext,
  preset: 5 | 10 | 20 | "full",
  inverted: boolean,
): SolanaRangeDraft | null {
  if (inspectSolanaRangeContext(context).status !== "available") return null;
  if (preset === "full") {
    const b = usableSolanaBounds(context);
    return { tickLower: b.min, tickUpper: b.max, displayInverted: inverted };
  }
  if (context.protocol === "orca" && context.tickSpacing >= 32768) return null;
  const current = new D(currentSolanaPrice(context) as string);
  const shown = inverted ? new D(1).div(current) : current;
  let range: SolanaRangeDraft = { tickLower: 0, tickUpper: 0, displayInverted: inverted };
  const min = shown.mul(new D(100 - preset).div(100));
  const max = shown.mul(new D(100 + preset).div(100));
  const first = snapSolanaRangePrice(context, range, "min", min.toFixed());
  if (!first) return null;
  range = snapSolanaRangePrice(context, first, "max", max.toFixed()) as SolanaRangeDraft;
  return range && validateSolanaRange(context, range) === "valid" ? range : null;
}
export function stepSolanaRange(
  context: SolanaRangeContext,
  range: SolanaRangeDraft,
  bound: "min" | "max",
  direction: 1 | -1,
): SolanaRangeDraft | null {
  if (inspectSolanaRangeContext(context).status !== "available") return null;
  const key = range.displayInverted
    ? bound === "min"
      ? "tickUpper"
      : "tickLower"
    : bound === "min"
      ? "tickLower"
      : "tickUpper";
  const next = {
    ...range,
    [key]: range[key] + direction * context.tickSpacing * (range.displayInverted ? -1 : 1),
  };
  return validateSolanaRange(context, next) === "valid" ? next : null;
}
export function solanaRangeStatus(
  context: SolanaRangeContext,
  range: { tickLower: number; tickUpper: number; rawLiquidity: string } | null,
): "in" | "above" | "below" | "zero-liquidity" | "unavailable" {
  if (
    inspectSolanaRangeContext(context).status !== "available" ||
    !range ||
    validateSolanaRange(context, { ...range, displayInverted: false }) !== "valid"
  )
    return "unavailable";
  if (!solanaRawAmountSchema.safeParse(range.rawLiquidity).success) return "unavailable";
  if (range.rawLiquidity === "0")
    return context.source.kind === "observed" && context.source.commitment !== "processed"
      ? "zero-liquidity"
      : "unavailable";
  return context.tickCurrent < range.tickLower
    ? "below"
    : context.tickCurrent >= range.tickUpper
      ? "above"
      : "in";
}
