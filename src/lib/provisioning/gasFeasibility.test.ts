/**
 * @id PP-CORE-LIB-054 (POO-1032)
 * @name gas feasibility classifier tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The chicken-and-egg, exhaustively. A chain can only fund an operation if it can first pay for a
 * transaction on ITSELF, so every candidate source chain is classified OK / TOP_UP / BLOCKED before
 * anything is planned from it.
 *
 * Rules under test (POO-1032 rules v1):
 *   [R1] exactly one of OK / TOP_UP / BLOCKED per candidate chain
 *   [R2] a BLOCKED chain is RETURNED, with its reason, never silently dropped
 *   [R3] a BLOCKED chain carries its two escapes: bridge native in, or buy crypto
 *   [R4] gas comes from the quote, never a hardcoded constant
 *   [R5] the requirement carries headroom, so a plan never lands the wallet at exactly zero native
 *   [R6] pure: no I/O, no React, the whole matrix testable offline
 *
 * The core table is the acceptance criterion verbatim: {zero, short, sufficient} native x {has a
 * routable token, none} x {same-chain, cross-chain}.
 */
import { describe, expect, it } from "vitest";
import enStrategies from "@/i18n/messages/en/strategies.json";
import type { UniswapQuoteResponse } from "@/lib/uniswap/schemas";
import type { GasTopUpPlan } from "./gasFeasibility";
import {
  classifyGasFeasibility,
  GAS_ESCAPE_LABEL_KEYS,
  GAS_HEADROOM_MIN_USD,
  GAS_HEADROOM_RATE,
  GAS_VERDICT_REASON_KEYS,
  type GasCandidateChain,
  type GasSourceToken,
  quoteGasUsd,
  raiseTopUpToUsd,
  withGasHeadroom,
} from "./gasFeasibility";

const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

/** Same-chain funding: an approval plus the swap. Quoted, never a constant ([R4]). */
const SAME_CHAIN_GAS = { approvalUsd: 0.05, swapUsd: 0.1 };
/** Cross-chain funding: the same, plus the bridge origin transaction. */
const CROSS_CHAIN_GAS = { approvalUsd: 0.05, swapUsd: 0.1, bridgeUsd: 0.4 };

/** required(same-chain)  = 0.15 + max(0.15 * 0.25, 0.05) = 0.20 */
const SAME_CHAIN_REQUIRED = 0.2;
/** required(cross-chain) = 0.55 + max(0.55 * 0.25, 0.05) = 0.6875 */
const CROSS_CHAIN_REQUIRED = 0.6875;

/** $250 of USDC, 6 decimals. A routable, non-native holding the gas swap can eat a slice of. */
function usdcSource(overrides: Partial<GasSourceToken> = {}): GasSourceToken {
  return {
    symbol: "USDC",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    balanceRaw: "250000000",
    balanceUsd: 250,
    ...overrides,
  };
}

function candidate(overrides: Partial<GasCandidateChain> = {}): GasCandidateChain {
  return {
    chainId: BASE,
    nativeBalanceUsd: 5,
    gas: SAME_CHAIN_GAS,
    sources: [usdcSource()],
    ...overrides,
  };
}

/** The single-chain case, which is what most of these assertions are about. */
function classifyOne(overrides: Partial<GasCandidateChain> = {}) {
  const [result] = classifyGasFeasibility([candidate(overrides)]);
  if (!result) throw new Error("classifyGasFeasibility dropped its only candidate");
  return result;
}

describe("classifyGasFeasibility — the verdict matrix [R1]", () => {
  // The acceptance criterion, verbatim: 3 native states x 2 token states x 2 route shapes.
  const cases = [
    // native, sources, route, expected verdict, expected reason
    ["zero", 0, "none", "same-chain", "BLOCKED", GAS_VERDICT_REASON_KEYS.noNative],
    ["zero", 0, "none", "cross-chain", "BLOCKED", GAS_VERDICT_REASON_KEYS.noNative],
    ["zero", 0, "token", "same-chain", "BLOCKED", GAS_VERDICT_REASON_KEYS.noNative],
    ["zero", 0, "token", "cross-chain", "BLOCKED", GAS_VERDICT_REASON_KEYS.noNative],
    ["short", 0.05, "none", "same-chain", "BLOCKED", GAS_VERDICT_REASON_KEYS.shortNoSource],
    ["short", 0.05, "none", "cross-chain", "BLOCKED", GAS_VERDICT_REASON_KEYS.shortNoSource],
    ["short", 0.05, "token", "same-chain", "TOP_UP", GAS_VERDICT_REASON_KEYS.topUp],
    ["short", 0.05, "token", "cross-chain", "TOP_UP", GAS_VERDICT_REASON_KEYS.topUp],
    ["sufficient", 5, "none", "same-chain", "OK", GAS_VERDICT_REASON_KEYS.ok],
    ["sufficient", 5, "none", "cross-chain", "OK", GAS_VERDICT_REASON_KEYS.ok],
    ["sufficient", 5, "token", "same-chain", "OK", GAS_VERDICT_REASON_KEYS.ok],
    ["sufficient", 5, "token", "cross-chain", "OK", GAS_VERDICT_REASON_KEYS.ok],
  ] as const;

  it.each(
    cases,
  )("%s native + %s + %s tokens on a %s route → %s", (_label, nativeBalanceUsd, tokens, route, verdict, reasonKey) => {
    const result = classifyOne({
      nativeBalanceUsd,
      sources: tokens === "token" ? [usdcSource()] : [],
      gas: route === "cross-chain" ? CROSS_CHAIN_GAS : SAME_CHAIN_GAS,
    });

    expect(result.verdict).toBe(verdict);
    expect(result.reasonKey).toBe(reasonKey);
  });

  // The route axis is not decoration: the SAME native balance is fundable same-chain and short
  // cross-chain, because the bridge leg is a real transaction with a real quoted cost.
  it("re-classifies the same balance when the route grows a bridge leg", () => {
    const nativeBalanceUsd = 0.3; // >= 0.20 (same-chain) but < 0.6875 (cross-chain)

    expect(classifyOne({ nativeBalanceUsd, gas: SAME_CHAIN_GAS }).verdict).toBe("OK");
    expect(classifyOne({ nativeBalanceUsd, gas: CROSS_CHAIN_GAS }).verdict).toBe("TOP_UP");
  });

  it("is OK at the exact requirement boundary, and TOP_UP one cent under it", () => {
    expect(classifyOne({ nativeBalanceUsd: SAME_CHAIN_REQUIRED }).verdict).toBe("OK");
    expect(classifyOne({ nativeBalanceUsd: SAME_CHAIN_REQUIRED - 0.01 }).verdict).toBe("TOP_UP");
  });

  it("treats a broken (negative or non-finite) native read as zero rather than as funded", () => {
    expect(classifyOne({ nativeBalanceUsd: -1 }).verdict).toBe("BLOCKED");
    expect(classifyOne({ nativeBalanceUsd: Number.NaN }).verdict).toBe("BLOCKED");
  });

  it("classifies every candidate, keeping input order", () => {
    const results = classifyGasFeasibility([
      candidate({ chainId: ARBITRUM, nativeBalanceUsd: 5 }),
      candidate({ chainId: BASE, nativeBalanceUsd: 0 }),
      candidate({ chainId: POLYGON, nativeBalanceUsd: 0.05 }),
    ]);

    expect(results.map((r) => r.chainId)).toEqual([ARBITRUM, BASE, POLYGON]);
    expect(results.map((r) => r.verdict)).toEqual(["OK", "BLOCKED", "TOP_UP"]);
  });

  it("returns nothing for no candidates", () => {
    expect(classifyGasFeasibility([])).toEqual([]);
  });
});

describe("BLOCKED is surfaced, not hidden [R2] [R3]", () => {
  // Hiding the row makes the user's own money look like it does not exist. The row comes back with
  // a reason so the UI (POO-1039) can grey it AND say why.
  it("returns a zero-native chain with a reason instead of omitting it", () => {
    const results = classifyGasFeasibility([
      candidate({ chainId: BASE, nativeBalanceUsd: 0 }),
      candidate({ chainId: ARBITRUM, nativeBalanceUsd: 5 }),
    ]);

    expect(results).toHaveLength(2);
    const blocked = results.find((r) => r.chainId === BASE);
    expect(blocked?.verdict).toBe("BLOCKED");
    expect(blocked?.reasonKey).toBe(GAS_VERDICT_REASON_KEYS.noNative);
  });

  it("gives a BLOCKED chain exactly two escapes: bridge native in, or buy crypto", () => {
    const blocked = classifyOne({ nativeBalanceUsd: 0 });

    expect(blocked.escapes?.map((e) => e.kind)).toEqual(["bridge-native", "buy-crypto"]);
    expect(blocked.escapes?.map((e) => e.labelKey)).toEqual([
      GAS_ESCAPE_LABEL_KEYS["bridge-native"],
      GAS_ESCAPE_LABEL_KEYS["buy-crypto"],
    ]);
  });

  it("names the chains a blocked chain could receive native FROM, richest spare first", () => {
    const results = classifyGasFeasibility([
      candidate({ chainId: BASE, nativeBalanceUsd: 0 }),
      candidate({ chainId: ARBITRUM, nativeBalanceUsd: 3 }),
      candidate({ chainId: POLYGON, nativeBalanceUsd: 9 }),
    ]);

    const bridgeEscape = results.find((r) => r.chainId === BASE)?.escapes?.[0];
    expect(bridgeEscape?.kind).toBe("bridge-native");
    expect(bridgeEscape?.fromChainIds).toEqual([POLYGON, ARBITRUM]);
  });

  // A chain that is only just OK has nothing to spare, so offering it as a source would strand it.
  it("excludes an OK chain with no surplus from the bridge-native escape", () => {
    const results = classifyGasFeasibility([
      candidate({ chainId: BASE, nativeBalanceUsd: 0 }),
      candidate({ chainId: ARBITRUM, nativeBalanceUsd: SAME_CHAIN_REQUIRED }),
    ]);

    expect(results.find((r) => r.chainId === BASE)?.escapes?.[0]?.fromChainIds).toEqual([]);
  });

  // Still two escapes when there is nowhere to bridge from: the contract stays stable and the UI
  // decides what to disable. Silently dropping one would leave the user with no stated way out.
  it("keeps both escapes when no chain has spare native", () => {
    const blocked = classifyOne({ nativeBalanceUsd: 0 });

    expect(blocked.escapes).toHaveLength(2);
    expect(blocked.escapes?.[0]?.fromChainIds).toEqual([]);
  });

  it("gives OK and TOP_UP chains no escapes", () => {
    expect(classifyOne({ nativeBalanceUsd: 5 }).escapes).toBeUndefined();
    expect(classifyOne({ nativeBalanceUsd: 0.05 }).escapes).toBeUndefined();
  });
});

describe("the TOP_UP plan [R5]", () => {
  it("prepends a gas swap sized from the held token, as a decimal string", () => {
    const result = classifyOne({ nativeBalanceUsd: 0.05, gas: SAME_CHAIN_GAS });

    expect(result.verdict).toBe("TOP_UP");
    expect(result.topUp?.token.symbol).toBe("USDC");
    expect(result.topUp?.amountRaw).toMatch(/^\d+$/);
    expect(typeof result.topUp?.amountRaw).toBe("string");
  });

  // [R5]: the whole point. After the top-up the wallet must still hold the headroom, otherwise the
  // swap lands it at exactly zero and strands it one step later — the trap this classifier exists
  // to prevent.
  it("buys enough native to cover the requirement INCLUDING headroom", () => {
    const nativeBalanceUsd = 0.05;
    const result = classifyOne({ nativeBalanceUsd, gas: CROSS_CHAIN_GAS });

    const afterTopUp = nativeBalanceUsd + (result.topUp?.buyNativeUsd ?? 0);
    expect(afterTopUp).toBeGreaterThanOrEqual(result.requiredGasUsd);
    expect(afterTopUp).toBeGreaterThan(result.quotedGasUsd * (1 + GAS_HEADROOM_RATE) - 1e-9);
  });

  // The top-up is one MORE transaction on that chain, so its own gas is part of what it must buy.
  it("includes the gas swap's own quoted cost in the requirement", () => {
    const withoutOwnGas = classifyOne({ nativeBalanceUsd: 0.05, gas: SAME_CHAIN_GAS });
    const withOwnGas = classifyOne({
      nativeBalanceUsd: 0.05,
      gas: { ...SAME_CHAIN_GAS, topUpSwapUsd: 0.1 },
    });

    expect(withOwnGas.requiredGasUsd).toBeGreaterThan(withoutOwnGas.requiredGasUsd);
    expect(withOwnGas.topUp?.buyNativeUsd).toBeGreaterThan(withoutOwnGas.topUp?.buyNativeUsd ?? 0);
  });

  // The top-up swap's own gas only applies where a top-up actually happens.
  it("does not charge the top-up swap's gas to an OK chain", () => {
    const plain = classifyOne({ nativeBalanceUsd: 5, gas: SAME_CHAIN_GAS });
    const withOwnGas = classifyOne({
      nativeBalanceUsd: 5,
      gas: { ...SAME_CHAIN_GAS, topUpSwapUsd: 0.1 },
    });

    expect(withOwnGas.requiredGasUsd).toBe(plain.requiredGasUsd);
  });

  // UF-22 [R2]: sized to the gas requirement plus headroom, NEVER the whole balance.
  it("converts a slice, not the whole holding", () => {
    const result = classifyOne({ nativeBalanceUsd: 0.05, gas: CROSS_CHAIN_GAS });
    const source = usdcSource();

    expect(result.topUp?.amountUsd).toBeLessThan(source.balanceUsd);
    expect(BigInt(result.topUp?.amountRaw ?? "0")).toBeLessThan(BigInt(source.balanceRaw));
    // ~$0.64 of a $250 holding: well under 1%.
    expect(result.topUp?.amountUsd).toBeLessThan(source.balanceUsd * 0.01);
  });

  // Integer math on the base-unit amount: a decimal string in, a decimal string out, no float
  // anywhere near it. $0.6375 of a $250 / 250000000-unit USDC holding = 637_500 base units.
  it("sizes the slice with integer math on base units", () => {
    const result = classifyOne({ nativeBalanceUsd: 0.05, gas: CROSS_CHAIN_GAS });

    // buyNative = 0.6875 - 0.05 = 0.6375 → 0.6375/250 * 250_000_000 = 637_500
    expect(result.topUp?.buyNativeUsd).toBeCloseTo(0.6375, 6);
    expect(result.topUp?.amountRaw).toBe("637500");
  });

  it("does not lose precision on a balance beyond Number.MAX_SAFE_INTEGER", () => {
    // 12.3456789 WETH at $3,000 → the raw balance is a 20-digit integer that a float would round.
    const weth = usdcSource({
      symbol: "WETH",
      decimals: 18,
      balanceRaw: "12345678900000000000",
      balanceUsd: 37037.0367,
    });
    const result = classifyOne({ nativeBalanceUsd: 0.05, sources: [weth], gas: SAME_CHAIN_GAS });

    const amountRaw = BigInt(result.topUp?.amountRaw ?? "0");
    expect(amountRaw).toBeGreaterThan(BigInt(0));
    expect(amountRaw).toBeLessThan(BigInt(weth.balanceRaw));
    // The slice must be exactly representable as an integer, not a rounded float.
    expect(result.topUp?.amountRaw).toMatch(/^\d+$/);
    expect(Number(result.topUp?.amountRaw)).not.toBe(Number.NaN);
  });

  it("picks the largest holding, so the slice is the smallest fraction of it", () => {
    const small = usdcSource({ symbol: "DAI", balanceRaw: "20000000", balanceUsd: 20 });
    const large = usdcSource({ symbol: "USDC", balanceRaw: "250000000", balanceUsd: 250 });
    const result = classifyOne({ nativeBalanceUsd: 0.05, sources: [small, large] });

    expect(result.topUp?.token.symbol).toBe("USDC");
  });

  // Spending a holding that STILL leaves the wallet unable to transact costs the user the holding
  // and fixes nothing. Refusing is the honest verdict (UF-22 [R3], never present an impossible plan).
  it("blocks when the largest holding could not cover the requirement even entirely", () => {
    const tiny = usdcSource({ balanceRaw: "100000", balanceUsd: 0.1 });
    const result = classifyOne({ nativeBalanceUsd: 0.01, sources: [tiny], gas: CROSS_CHAIN_GAS });

    expect(result.verdict).toBe("BLOCKED");
    expect(result.reasonKey).toBe(GAS_VERDICT_REASON_KEYS.shortNoSource);
    expect(result.topUp).toBeUndefined();
  });

  it("spends a holding down to its last base unit when that exactly covers the requirement", () => {
    // required(same-chain) 0.20 - 0.05 native = 0.15 needed, and the holding is worth exactly that.
    const exact = usdcSource({ balanceRaw: "150000", balanceUsd: 0.15 });
    const result = classifyOne({ nativeBalanceUsd: 0.05, sources: [exact], gas: SAME_CHAIN_GAS });

    expect(result.verdict).toBe("TOP_UP");
    expect(result.topUp?.amountRaw).toBe("150000");
  });

  // A source that cannot produce even one base unit is not a source. Falling through to BLOCKED is
  // honest; a zero-amount swap step would just fail later with the money already committed.
  it("falls through to BLOCKED when no holding can produce a usable slice", () => {
    const unpriced = usdcSource({ balanceRaw: "0", balanceUsd: 0 });
    const result = classifyOne({ nativeBalanceUsd: 0.05, sources: [unpriced] });

    expect(result.verdict).toBe("BLOCKED");
    expect(result.reasonKey).toBe(GAS_VERDICT_REASON_KEYS.shortNoSource);
    expect(result.topUp).toBeUndefined();
  });

  it("gives an OK chain no top-up plan", () => {
    expect(classifyOne({ nativeBalanceUsd: 5 }).topUp).toBeUndefined();
  });
});

describe("the headroom buffer [R5]", () => {
  it("adds a proportional buffer over the quoted cost", () => {
    // 4.00 * 0.25 = 1.00, comfortably over the floor.
    expect(withGasHeadroom(4)).toBeCloseTo(5, 6);
  });

  it("floors the buffer so a near-free quote still leaves a real cushion", () => {
    expect(withGasHeadroom(0.01)).toBeCloseTo(0.01 + GAS_HEADROOM_MIN_USD, 6);
  });

  it("degrades an unquotable cost to the bare floor rather than to zero", () => {
    expect(withGasHeadroom(0)).toBeCloseTo(GAS_HEADROOM_MIN_USD, 6);
    expect(withGasHeadroom(Number.NaN)).toBeCloseTo(GAS_HEADROOM_MIN_USD, 6);
    expect(withGasHeadroom(-3)).toBeCloseTo(GAS_HEADROOM_MIN_USD, 6);
  });

  it("reports the quoted cost and the headroomed requirement separately", () => {
    const result = classifyOne({ nativeBalanceUsd: 5, gas: CROSS_CHAIN_GAS });

    expect(result.quotedGasUsd).toBeCloseTo(0.55, 6);
    expect(result.requiredGasUsd).toBeCloseTo(CROSS_CHAIN_REQUIRED, 6);
    expect(result.requiredGasUsd).toBeGreaterThan(result.quotedGasUsd);
  });

  it("reports the shortfall and the surplus, each floored at zero", () => {
    const short = classifyOne({ nativeBalanceUsd: 0.05, gas: SAME_CHAIN_GAS });
    expect(short.shortfallUsd).toBeCloseTo(SAME_CHAIN_REQUIRED - 0.05, 6);
    expect(short.surplusUsd).toBe(0);

    const flush = classifyOne({ nativeBalanceUsd: 5, gas: SAME_CHAIN_GAS });
    expect(flush.shortfallUsd).toBe(0);
    expect(flush.surplusUsd).toBeCloseTo(5 - SAME_CHAIN_REQUIRED, 6);
  });
});

describe("gas comes from the quote [R4]", () => {
  function quote(body: Record<string, unknown>): UniswapQuoteResponse {
    return { routing: "CLASSIC", quote: body } as UniswapQuoteResponse;
  }

  it("reads the top-level USD gas figure", () => {
    expect(quoteGasUsd(quote({ gasFeeUSD: 0.42 }))).toBeCloseTo(0.42, 6);
  });

  it("accepts the string form the API also returns", () => {
    expect(quoteGasUsd(quote({ gasFeeUSD: "0.42" }))).toBeCloseTo(0.42, 6);
  });

  it("falls back to the nested gasInfo block", () => {
    expect(quoteGasUsd(quote({ gasInfo: { gasFeeUSD: "1.25" } }))).toBeCloseTo(1.25, 6);
  });

  it("prefers the top-level figure over the nested one", () => {
    expect(quoteGasUsd(quote({ gasFeeUSD: 0.42, gasInfo: { gasFeeUSD: "9.99" } }))).toBeCloseTo(
      0.42,
      6,
    );
  });

  it("returns undefined for a missing, malformed or negative figure", () => {
    expect(quoteGasUsd(quote({}))).toBeUndefined();
    expect(quoteGasUsd(quote({ gasFeeUSD: "not-a-number" }))).toBeUndefined();
    expect(quoteGasUsd(quote({ gasFeeUSD: -1 }))).toBeUndefined();
    expect(quoteGasUsd(quote({ gasFeeUSD: Number.POSITIVE_INFINITY }))).toBeUndefined();
  });

  // A quote we could not price must not silently read as free AND must not block a funded wallet:
  // the requirement degrades to the bare headroom floor (UF-20 R6's fail-safe posture).
  it("degrades an unquoted route to the headroom floor without inventing a number", () => {
    const result = classifyOne({ nativeBalanceUsd: 5, gas: {} });

    expect(result.quotedGasUsd).toBe(0);
    expect(result.requiredGasUsd).toBeCloseTo(GAS_HEADROOM_MIN_USD, 6);
    expect(result.verdict).toBe("OK");
  });

  it("still blocks an empty wallet on an unquoted route", () => {
    expect(classifyOne({ nativeBalanceUsd: 0, gas: {} }).verdict).toBe("BLOCKED");
  });

  it("ignores a malformed leg rather than poisoning the total with NaN", () => {
    const result = classifyOne({
      nativeBalanceUsd: 5,
      gas: { swapUsd: 0.1, approvalUsd: Number.NaN, bridgeUsd: -2 },
    });

    expect(result.quotedGasUsd).toBeCloseTo(0.1, 6);
    expect(Number.isFinite(result.requiredGasUsd)).toBe(true);
  });
});

describe("purity [R6]", () => {
  it("does not mutate its input", () => {
    const input = [candidate({ nativeBalanceUsd: 0.05 })];
    const snapshot = structuredClone(input);

    classifyGasFeasibility(input);

    expect(input).toEqual(snapshot);
  });

  it("is deterministic across repeated calls", () => {
    const input = [candidate({ nativeBalanceUsd: 0.05, gas: CROSS_CHAIN_GAS })];

    expect(classifyGasFeasibility(input)).toEqual(classifyGasFeasibility(input));
  });
});

describe("every emitted i18n key exists in the source locale", () => {
  /** Resolve a dot path inside the `strategies` namespace. */
  function resolve(key: string): unknown {
    return key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
        enStrategies,
      );
  }

  it.each([
    ...Object.values(GAS_VERDICT_REASON_KEYS),
    ...Object.values(GAS_ESCAPE_LABEL_KEYS),
  ])("%s resolves to copy", (key) => {
    expect(typeof resolve(key)).toBe("string");
  });
});

/**
 * POO-1085 [F2-R2]. The user may ask to hold MORE native than the route strictly needs, and the
 * classifier's own figure is the floor under that ask: an undersized gas leg reverts on-chain, so a
 * choice below the requirement is ignored rather than honoured.
 */
describe("raiseTopUpToUsd", () => {
  /** A sized top-up: $1 of a 100-token holding worth $10, i.e. 10 base units per dollar. */
  function sizedTopUp(over: Partial<GasTopUpPlan> = {}): GasTopUpPlan {
    return {
      token: {
        symbol: "USDC",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        decimals: 6,
        balanceRaw: "10000000", // 10 USDC
        balanceUsd: 10,
      },
      amountRaw: "1000000", // 1 USDC
      amountUsd: 1,
      buyNativeUsd: 1,
      ...over,
    };
  }

  it("[F2-R2] raises the slice proportionally to a larger target", () => {
    const raised = raiseTopUpToUsd(sizedTopUp(), 5);

    expect(raised.buyNativeUsd).toBe(5);
    expect(raised.amountUsd).toBe(5);
    expect(raised.amountRaw).toBe("5000000");
  });

  it("[F2-R2] a target below the classifier's figure is IGNORED, not honoured", () => {
    // The floor is the whole point: below it the leg does not cover the transaction it pays for.
    expect(raiseTopUpToUsd(sizedTopUp(), 0.5)).toEqual(sizedTopUp());
  });

  it("[F2-R2] a target equal to the classifier's figure changes nothing", () => {
    expect(raiseTopUpToUsd(sizedTopUp(), 1)).toEqual(sizedTopUp());
  });

  it("[F2-R3] no target at all leaves the plan byte for byte as it was", () => {
    expect(raiseTopUpToUsd(sizedTopUp(), undefined)).toEqual(sizedTopUp());
    expect(raiseTopUpToUsd(sizedTopUp(), 0)).toEqual(sizedTopUp());
    expect(raiseTopUpToUsd(sizedTopUp(), Number.NaN)).toEqual(sizedTopUp());
    expect(raiseTopUpToUsd(sizedTopUp(), Number.POSITIVE_INFINITY)).toEqual(sizedTopUp());
  });

  it("caps at the holding and reports what the cap actually delivers", () => {
    // Asking for $25 out of a $10 holding: spend all of it, and say so. Reporting $25 would put a
    // figure on screen the swap cannot deliver.
    const raised = raiseTopUpToUsd(sizedTopUp(), 25);

    expect(raised.amountRaw).toBe("10000000");
    expect(raised.buyNativeUsd).toBe(10);
    expect(raised.amountUsd).toBe(10);
  });

  it("rounds the slice UP, so a raised top-up is never a hair short", () => {
    // $1 of a $3 holding of 1 token (18 decimals): raising to $2 lands on a repeating fraction.
    const raised = raiseTopUpToUsd(
      sizedTopUp({
        token: {
          symbol: "WETH",
          address: "0x4200000000000000000000000000000000000006",
          decimals: 18,
          balanceRaw: "1000000000000000000",
          balanceUsd: 3,
        },
        amountRaw: "333333333333333334",
        amountUsd: 1,
        buyNativeUsd: 1,
      }),
      2,
    );

    expect(BigInt(raised.amountRaw)).toBeGreaterThanOrEqual(BigInt("666666666666666667"));
    expect(BigInt(raised.amountRaw)).toBeLessThanOrEqual(BigInt("1000000000000000000"));
    expect(raised.buyNativeUsd).toBe(2);
  });

  it("leaves a malformed slice alone rather than deriving a new one from it", () => {
    const broken = sizedTopUp({ amountRaw: "not-a-number" });
    expect(raiseTopUpToUsd(broken, 5)).toEqual(broken);

    const zeroBase = sizedTopUp({ buyNativeUsd: 0 });
    expect(raiseTopUpToUsd(zeroBase, 5)).toEqual(zeroBase);
  });

  it("does not mutate the top-up it is given", () => {
    const original = sizedTopUp();
    const snapshot = structuredClone(original);
    raiseTopUpToUsd(original, 5);
    expect(original).toEqual(snapshot);
  });
});
