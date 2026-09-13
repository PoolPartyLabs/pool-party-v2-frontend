/**
 * @id PP-CORE-LIB-066 (POO-1134)
 * @name on-ramp balance-delta computation — spec
 * @implements-rules-version v2 (POO-1129 rules v2)
 *
 * [R4] "the observed balance delta is the authoritative amount, never the requested amount." This
 * module derives that delta from two wallet snapshots. Pure, so the arithmetic (including the
 * exact-string path a downstream leg is sized from) is asserted without a widget or a network.
 */
import { describe, expect, it } from "vitest";
import type { TokenBalance } from "@/lib/balances/types";
import { computeTokenDeltas, hasPositiveDelta, selectPurchaseDeltas } from "./tokenDeltas";

/** A minimal Base USDC holding; overrides let each test set the moving parts. */
function usdc(over: Partial<TokenBalance> = {}): TokenBalance {
  return {
    symbol: "USDC",
    name: "USD Coin",
    amount: 0,
    decimals: 6,
    usd: 0,
    chainId: 8453,
    logoUrl: "",
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    isNative: false,
    ...over,
  };
}

/** Base native ETH. */
function eth(over: Partial<TokenBalance> = {}): TokenBalance {
  return {
    symbol: "ETH",
    name: "Ether",
    amount: 0,
    decimals: 18,
    usd: 0,
    chainId: 8453,
    logoUrl: "",
    address: "0x0000000000000000000000000000000000000000",
    isNative: true,
    ...over,
  };
}

describe("computeTokenDeltas", () => {
  // @rule R4 — a USDC balance that grew by the purchased amount surfaces as a positive delta.
  it("reports the increase for a token that grew", () => {
    const before = [usdc({ amount: 5, usd: 5 })];
    const after = [usdc({ amount: 105, usd: 105 })];
    const deltas = computeTokenDeltas(before, after);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ symbol: "USDC", chainId: 8453, amount: 100, usd: 100 });
  });

  // @rule R4 — the delta is the AUTHORITATIVE figure; a token absent from the baseline (the user
  // bought a currency they held none of) counts from zero, not as "unknown".
  it("treats a brand-new token as a delta from zero", () => {
    const deltas = computeTokenDeltas([], [usdc({ amount: 100, usd: 100 })]);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.amount).toBe(100);
  });

  it("keys by chain+address, so the same symbol on two chains is two rows", () => {
    const before = [usdc({ amount: 0, usd: 0 })];
    const after = [usdc({ amount: 100, usd: 100 }), usdc({ chainId: 42161, amount: 50, usd: 50 })];
    const deltas = computeTokenDeltas(before, after);
    expect(deltas).toHaveLength(2);
    expect(deltas.map((d) => d.chainId).sort((a, b) => a - b)).toEqual([8453, 42161]);
  });

  // @rule R4 — surplus stays in the wallet, but a DROP is never reported as a purchase: only
  // increases are deltas the settlement acts on.
  it("excludes tokens that stayed the same or dropped", () => {
    const before = [usdc({ amount: 100, usd: 100 }), eth({ amount: 1, usd: 3000 })];
    const after = [usdc({ amount: 100, usd: 100 }), eth({ amount: 0.4, usd: 1200 })];
    expect(computeTokenDeltas(before, after)).toEqual([]);
  });

  // @rule R4 — a downstream swap/bridge is sized in base units, so the exact-string delta must be
  // exact (never a re-derived float). Both snapshots carry `amountExact` on the real path.
  it("computes an exact decimal-string delta when both sides carry amountExact", () => {
    const before = [usdc({ amount: 5, amountExact: "5.000000", usd: 5 })];
    const after = [usdc({ amount: 105.5, amountExact: "105.500000", usd: 105.5 })];
    const [delta] = computeTokenDeltas(before, after);
    expect(delta?.amountExact).toBe("100.5");
  });

  it("derives the exact delta from zero for a new token that carries amountExact", () => {
    const [delta] = computeTokenDeltas(
      [],
      [usdc({ amount: 100, amountExact: "100.000000", usd: 100 })],
    );
    expect(delta?.amountExact).toBe("100");
  });

  // The degraded USDC-only read has no `amountExact`; the float delta still surfaces, exact is absent
  // rather than fabricated.
  it("omits amountExact when a side lacks it, keeping the float amount", () => {
    const before = [usdc({ amount: 5, usd: 5 })]; // no amountExact
    const after = [usdc({ amount: 105, amountExact: "105.000000", usd: 105 })];
    const [delta] = computeTokenDeltas(before, after);
    expect(delta?.amount).toBe(100);
    expect(delta?.amountExact).toBeUndefined();
  });

  // A false-zero poll (session cookie expired mid-widget → `[]`) must never read as "everything
  // dropped": with nothing in `after` there is no positive delta, so the poll keeps waiting.
  it("returns nothing when the after snapshot is empty", () => {
    expect(computeTokenDeltas([usdc({ amount: 100, usd: 100 })], [])).toEqual([]);
  });
});

describe("hasPositiveDelta", () => {
  it("is true when any token grew and false otherwise", () => {
    expect(hasPositiveDelta(computeTokenDeltas([], [usdc({ amount: 100, usd: 100 })]))).toBe(true);
    expect(hasPositiveDelta([])).toBe(false);
  });
});

describe("selectPurchaseDeltas", () => {
  /** One delta per candidate token, so the selector's job is purely to pick. */
  const deltas = computeTokenDeltas(
    [
      usdc({ amount: 5, usd: 5 }),
      eth({ amount: 0, usd: 0 }),
      usdc({ amount: 5, usd: 5, chainId: 42_161 }),
    ],
    [
      usdc({ amount: 105, usd: 105 }),
      eth({ amount: 0.05, usd: 150 }),
      usdc({ amount: 505, usd: 505, chainId: 42_161 }),
    ],
  );

  // @rule R4 — the delta that counts is the PURCHASE's. Paybis sells on Base only, so growth on any
  // other chain cannot be it, however well-timed it is inside the ten-minute reconcile window.
  it("keeps only the expected token on the on-ramp chain", () => {
    const picked = selectPurchaseDeltas(deltas, "USDC-BASE");
    expect(picked).toHaveLength(1);
    expect(picked[0]?.symbol).toBe("USDC");
    expect(picked[0]?.chainId).toBe(8453);
    expect(picked[0]?.amount).toBeCloseTo(100);
  });

  it("follows the order's currency code rather than guessing", () => {
    const picked = selectPurchaseDeltas(deltas, "ETH-BASE");
    expect(picked).toHaveLength(1);
    expect(picked[0]?.symbol).toBe("ETH");
    expect(picked[0]?.amount).toBeCloseTo(0.05);
  });

  it("returns nothing when only unrelated tokens grew", () => {
    const offChainOnly = computeTokenDeltas(
      [usdc({ amount: 5, usd: 5, chainId: 42_161 })],
      [usdc({ amount: 505, usd: 505, chainId: 42_161 })],
    );
    expect(selectPurchaseDeltas(offChainOnly, "USDC-BASE")).toEqual([]);
    expect(hasPositiveDelta(selectPurchaseDeltas(offChainOnly, "USDC-BASE"))).toBe(false);
  });

  // A snapshot that reports the symbol in another case must not slip past the scope.
  it("matches the symbol case-insensitively", () => {
    const lowercase = computeTokenDeltas(
      [usdc({ symbol: "usdc", amount: 5, usd: 5 })],
      [usdc({ symbol: "usdc", amount: 105, usd: 105 })],
    );
    expect(selectPurchaseDeltas(lowercase, "USDC-BASE")).toHaveLength(1);
  });
});
