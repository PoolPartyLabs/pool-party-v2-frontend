/**
 * @id PP-MGR-LIB-069
 * @name solanaRangeModel tests
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, pure protocol range tests
 */
import { describe, expect, it } from "vitest";
import {
  currentSolanaPrice,
  displaySolanaRange,
  inspectSolanaRangeContext,
  presetSolanaRange,
  type SolanaRangeContext,
  type SolanaRangeDraft,
  snapSolanaRangePrice,
  solanaRangeStatus,
  solanaSqrtPriceAtTick,
  stepSolanaRange,
  validateSolanaRange,
} from "./solanaRangeModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

/** Pure vectors are protocol math examples, never production pool discovery or financial fixtures. */
function rangeTestContext(protocol: "orca" | "raydium" = "orca"): SolanaRangeContext {
  const common = {
    cluster: "mainnet-beta" as const,
    program: "11111111111111111111111111111111",
    pool: WSOL_MINT,
    tokenA: {
      kind: "spl" as const,
      network: "solana" as const,
      cluster: "mainnet-beta" as const,
      mint: WSOL_MINT,
      decimals: 9,
      symbol: "WSOL",
      unit: "base-units" as const,
      tokenProgram: "11111111111111111111111111111111",
      extensions: { status: "unknown" as const },
    },
    tokenB: {
      kind: "spl" as const,
      network: "solana" as const,
      cluster: "mainnet-beta" as const,
      mint: USDC_MINT,
      decimals: 6,
      symbol: "USDC",
      unit: "base-units" as const,
      tokenProgram: "11111111111111111111111111111111",
      extensions: { status: "unknown" as const },
    },
    status: "available" as const,
    source: {
      kind: "observed" as const,
      source: "official-math-test-vector",
      sourceAsOf: "2026-10-07T00:00:00Z",
      slot: "1",
      commitment: "confirmed" as const,
    },
    tickSpacing: 64,
    tickCurrent: 0,
    sqrtPriceX64: "18446744073709551616",
    position: {
      positionId: USDC_MINT,
      pool: WSOL_MINT,
      rawLiquidity: "10",
      tickLower: -128,
      tickUpper: 128,
    },
  };
  return protocol === "orca"
    ? {
        ...common,
        protocol,
        fee: { kind: "fixed", baseFeeRate: "3000", effectiveFeeRate: null },
        tokenBadge: { status: "unknown" },
      }
    : {
        ...common,
        protocol,
        ammConfig: {
          address: USDC_MINT,
          tickSpacing: 64,
          tradeFeeRate: "100",
          protocolFeeRate: "0",
          fundFeeRate: "0",
        },
        feeOn: "unknown",
        dynamicFee: "unknown",
      };
}
const draft: SolanaRangeDraft = { tickLower: -128, tickUpper: 128, displayInverted: false };

describe("Solana protocol ranges", () => {
  // @rule POO-2291 R2,R5: the protocol snapshot has byte-ordered canonical mints, not display order.
  it.each([
    "orca",
    "raydium",
  ] as const)("rejects reversed canonical %s mints without reinterpreting sqrt price", (protocol) => {
    const context = rangeTestContext(protocol);
    expect(inspectSolanaRangeContext(context).status).toBe("available");
    const reversed = { ...context, tokenA: context.tokenB, tokenB: context.tokenA };
    expect(inspectSolanaRangeContext(reversed).status).toBe("unavailable");
    expect(currentSolanaPrice(reversed)).toBeNull();
  });
  // @rule POO-2291 R3: a processed or fixture observation cannot establish confirmed zero liquidity.
  it("does not assert no liquidity from an unconfirmed or fixture zero", () => {
    const context = rangeTestContext();
    const zero = { tickLower: -128, tickUpper: 128, rawLiquidity: "0" };
    expect(solanaRangeStatus(context, zero)).toBe("zero-liquidity");
    expect(
      solanaRangeStatus(
        {
          ...context,
          source: {
            ...context.source,
            kind: "observed",
            source: "rpc",
            slot: "2",
            commitment: "processed",
          },
        },
        zero,
      ),
    ).toBe("unavailable");
    expect(
      solanaRangeStatus(
        {
          ...context,
          source: {
            kind: "fixture",
            fixtureId: "range-zero",
            slot: null,
            sourceAsOf: context.source.sourceAsOf,
          },
        },
        zero,
      ),
    ).toBe("unavailable");
  });
  // @rule R2,R3: no fixture fallback or EVM identity at the read boundary.
  it("requires explicit complete provenance, canonical mints/decimals and matching AmmConfig", () => {
    expect(inspectSolanaRangeContext(null).status).toBe("unavailable");
    const orca = rangeTestContext();
    expect(inspectSolanaRangeContext(orca).status).toBe("available");
    expect(
      inspectSolanaRangeContext({ ...orca, tokenA: { ...orca.tokenA, decimals: 6 } }).status,
    ).toBe("unavailable");
    expect(
      inspectSolanaRangeContext({ ...orca, tokenB: { ...orca.tokenB, mint: orca.tokenA.mint } })
        .status,
    ).toBe("unavailable");
    expect(inspectSolanaRangeContext({ ...orca, sqrtPriceX64: "0" }).status).toBe("unavailable");
    expect(inspectSolanaRangeContext({ ...orca, sqrtPriceX64: "not-an-integer" }).status).toBe(
      "unavailable",
    );
    expect(inspectSolanaRangeContext({ ...orca, tickCurrent: 443637 }).status).toBe("unavailable");
    expect(inspectSolanaRangeContext({ ...orca, tickCurrent: 100 }).status).toBe("unavailable");
    expect(inspectSolanaRangeContext({ ...orca, tickCurrent: -1 }).status).toBe("available");
    expect(inspectSolanaRangeContext({ ...orca, tickCurrent: -2 }).status).toBe("unavailable");
    if (orca.protocol !== "orca") throw new Error("wrong protocol");
    expect(
      inspectSolanaRangeContext({ ...orca, fee: { ...orca.fee, baseFeeRate: "broken" } }).status,
    ).toBe("unavailable");
    expect(
      inspectSolanaRangeContext({ ...orca, position: { ...orca.position, rawLiquidity: "broken" } })
        .status,
    ).toBe("unavailable");
    const ray = rangeTestContext("raydium");
    expect(inspectSolanaRangeContext(ray).status).toBe("available");
    if (ray.protocol !== "raydium") throw new Error("wrong protocol");
    expect(
      inspectSolanaRangeContext({ ...ray, ammConfig: { ...ray.ammConfig, tickSpacing: 60 } })
        .status,
    ).toBe("unavailable");
    expect(inspectSolanaRangeContext({ ...orca, status: "stale" }).status).toBe("stale");
  });
  // @rule R5: Apache Orca e528dd23 exact bit vectors and Raydium ed1eb41 domain.
  it("matches official integer sqrt-price vectors and keeps different protocol maxima", () => {
    expect(solanaSqrtPriceAtTick("orca", 0)).toBe("18446744073709551616");
    expect(solanaSqrtPriceAtTick("orca", 1)).toBe("18447666387855959850");
    expect(solanaSqrtPriceAtTick("orca", -1)).toBe("18445821805675392311");
    expect(solanaSqrtPriceAtTick("orca", 32768)).toBe("94936283578220370716");
    expect(solanaSqrtPriceAtTick("orca", -443636)).toBe("4295048016");
    expect(solanaSqrtPriceAtTick("orca", 443636)).toBe("79226673515401279992447579055");
    expect(solanaSqrtPriceAtTick("raydium", -443636)).toBe("4295048016");
    expect(solanaSqrtPriceAtTick("raydium", 443636)).toBe("79226673521066979257578248091");
    expect(solanaSqrtPriceAtTick("orca", 887272)).toBeNull();
  });
  // @rule R5: Q64.64 canonical decimals; official SDK price.rs vector, no display-first arithmetic.
  it("retains exact Q64 input and decimal orientation without a float or zero tiny price", () => {
    const context = rangeTestContext();
    expect(currentSolanaPrice(context)).toBe("1000");
    const sol = { ...context, sqrtPriceX64: "6918418495991757039", tickCurrent: -19615 };
    expect(currentSolanaPrice(sol)?.startsWith("140.661165956923")).toBe(true);
    const bounds = displaySolanaRange(context, draft);
    const inverted = displaySolanaRange(context, { ...draft, displayInverted: true });
    expect(bounds?.min).not.toBe("0");
    expect(inverted?.base.mint).toBe(USDC_MINT);
    expect(inverted?.quote.mint).toBe(WSOL_MINT);
    expect(inverted?.min).not.toBe(bounds?.min);
    expect(draft).toEqual({ tickLower: -128, tickUpper: 128, displayInverted: false });
  });
  // @rule R5: real spacing, usable domain, and only Orca threshold imposes full-only.
  it("validates domain/grid/width and Orca full-range-only rather than Uniswap defaults", () => {
    const context = rangeTestContext();
    expect(validateSolanaRange(context, draft)).toBe("valid");
    expect(validateSolanaRange(context, { ...draft, tickLower: -127 })).toBe("off-grid");
    expect(validateSolanaRange(context, { ...draft, tickUpper: 887272 })).toBe("out-of-domain");
    expect(validateSolanaRange(context, { ...draft, tickUpper: -128 })).toBe("collapsed");
    const fullOnly = { ...context, tickSpacing: 32768, position: null };
    expect(validateSolanaRange(fullOnly, { ...draft, tickLower: -32768, tickUpper: 32768 })).toBe(
      "full-only",
    );
    expect(presetSolanaRange(fullOnly, "full", false)).toEqual({
      tickLower: -425984,
      tickUpper: 425984,
      displayInverted: false,
    });
    expect(presetSolanaRange(fullOnly, 10, false)).toBeNull();
    const ray = rangeTestContext("raydium");
    expect(validateSolanaRange(ray, draft)).toBe("valid");
  });
  // @rule R5: all edits share canonical grid, invalid collapse is surfaced rather than repaired.
  it("snaps blur/inversion/presets and nudges exactly one actual spacing", () => {
    const context = rangeTestContext();
    const next = snapSolanaRangePrice(context, draft, "min", "995");
    expect(next?.tickLower).toBe(-64);
    expect(next?.tickUpper).toBe(128);
    expect(snapSolanaRangePrice(context, draft, "min", "1000")).toEqual({ ...draft, tickLower: 0 });
    expect(snapSolanaRangePrice(context, draft, "min", "NaN")).toBeNull();
    expect(snapSolanaRangePrice(context, draft, "min", "1e999")).toBeNull();
    expect(stepSolanaRange(context, draft, "min", 1)?.tickLower).toBe(-64);
    expect(stepSolanaRange(context, { ...draft, displayInverted: true }, "min", 1)?.tickUpper).toBe(
      64,
    );
    for (const preset of [5, 10, 20, "full"] as const) {
      const value = presetSolanaRange(context, preset, true);
      expect(value).not.toBeNull();
      expect(validateSolanaRange(context, value as SolanaRangeDraft)).toBe("valid");
    }
  });
  // @rule R3,R8: only current position affects its status; liquidity zero is explicit.
  it("preserves current identity/status independently of drafts and neutralizes zero liquidity", () => {
    const context = rangeTestContext();
    expect(solanaRangeStatus(context, context.position)).toBe("in");
    expect(
      solanaRangeStatus(context, { ...draft, tickLower: 0, tickUpper: 128, rawLiquidity: "10" }),
    ).toBe("in");
    expect(
      solanaRangeStatus(context, { ...draft, tickLower: -128, tickUpper: 0, rawLiquidity: "10" }),
    ).toBe("above");
    expect(solanaRangeStatus(context, { tickLower: -128, tickUpper: 128, rawLiquidity: "0" })).toBe(
      "zero-liquidity",
    );
    expect(solanaRangeStatus({ ...context, status: "stale" }, context.position)).toBe(
      "unavailable",
    );
  });
});
