/**
 * @id PP-CORE-LIB-097
 * @name fundingTarget tests
 * @implements-rules-version v2 (POO-1755 rules v1) · v1 (POO-1499 rules v1)
 *
 * POO-1499 [R49], [R52], [R53] and [R9]. Every amount on every screen of the provisioning flow
 * renders the output of this module, so these are the figures the rest of the epic is measured
 * against. [R50] (the disclosure copy) and [R51] (restarting past the buffer) are the screens' work
 * and are deliberately NOT covered here, so the rule-to-test mapping stays honest.
 *
 * The worked example is the Figma demo scenario with the two decisions taken 2026-08-10 applied:
 * the buffer stays at the shipped 5% rather than the spec's 3% (it was sized against POO-1042 [R7]'s
 * "the CTA must never flip from enabled to disabled underneath the user"), and the tokens route's gas
 * floor is $5 rather than the spec's $10 (POO-1084 [F1-R4]: $10 is the Paybis FIAT minimum, and the
 * tokens route swaps a holding rather than buying).
 */
import { describe, expect, it } from "vitest";
import { PAYBIS_MIN_USD } from "@/lib/provisioning";
import {
  BUY_ROUTE_NATIVE_RESERVE_USD,
  DEFAULT_SOURCE_BUFFER_RATE,
  routeGasComponentUsd,
  sourceTargetUsd,
} from "./fundingTarget";

describe("routeGasComponentUsd (POO-1499 [R53])", () => {
  // @rule R53 — the gas component differs by route, which is why `Buy` costs less than `Use your
  // tokens` for the same operation. It is deliberate, not a rounding artefact.
  it("[R53] charges the tokens route the USDC swap floor, not the card floor", () => {
    // @rule POO-1084 [F1-R4] — a swap out of an existing holding is not a purchase, so the Paybis
    // $10 fiat minimum does not apply. Forcing it would spend $10 of a balance to buy cents of gas.
    expect(routeGasComponentUsd("tokens", true)).toBe(5);
    expect(routeGasComponentUsd("tokens-plus-buy", true)).toBe(5);
  });

  // @rule R52 — a card purchase lands as ETH on Base, so the route holds a slice of it back for
  // signing rather than buying gas separately. That is why this route has no gas purchase at all.
  it("[R52] charges the buy route the native reserve it keeps back, not a gas purchase", () => {
    expect(routeGasComponentUsd("buy", true)).toBe(BUY_ROUTE_NATIVE_RESERVE_USD);
    expect(BUY_ROUTE_NATIVE_RESERVE_USD).toBe(2);
  });

  // @rule R9 — no gas needed, no gas component, and the heading shows the transaction alone.
  it("[R9] charges nothing on any route when no gas is needed", () => {
    expect(routeGasComponentUsd("tokens", false)).toBe(0);
    expect(routeGasComponentUsd("tokens-plus-buy", false)).toBe(0);
    expect(routeGasComponentUsd("buy", false)).toBe(0);
  });

  it("charges nothing on the deposit route, which settles its amount elsewhere", () => {
    expect(routeGasComponentUsd("deposit", true)).toBe(0);
    expect(routeGasComponentUsd("deposit", false)).toBe(0);
  });
});

describe("sourceTargetUsd (POO-1499 [R49], [R52], [R53])", () => {
  // The Figma demo scenario: invest $200.00 in Stable Yield on Arbitrum.
  const TRANSACTION = 200;

  // @rule R49 — token selection targets MORE than the operation needs, so a $200 investment lands
  // as $200 rather than as $194 after the market moved between selection and settlement.
  it("[R49] buffers transaction plus gas on the tokens route", () => {
    // (200 + 5) * 1.05
    expect(
      sourceTargetUsd({ transactionUsd: TRANSACTION, routeKind: "tokens", gasNeeded: true }),
    ).toBe(215.25);
  });

  // @rule R52 — the reserve is held BACK from ETH already bought, not bought on top, so it sits
  // outside the buffer: there is no price move to protect a number that is denominated in the thing
  // the user just received.
  it("[R52] adds the buy route's reserve outside the buffer, not inside it", () => {
    // (200 * 1.05) + 2
    expect(
      sourceTargetUsd({ transactionUsd: TRANSACTION, routeKind: "buy", gasNeeded: true }),
    ).toBe(212);
  });

  // @rule R53 — the whole point of the split: the same operation costs less to buy than to convert.
  it("[R53] leaves the buy route cheaper than the tokens route for one operation", () => {
    const tokens = sourceTargetUsd({
      transactionUsd: TRANSACTION,
      routeKind: "tokens",
      gasNeeded: true,
    });
    const buy = sourceTargetUsd({ transactionUsd: TRANSACTION, routeKind: "buy", gasNeeded: true });

    expect(buy).toBeLessThan(tokens);
  });

  // @rule R9 — with no gas to cover, both routes collapse to the buffered transaction.
  it("[R9] charges the buffered transaction alone when no gas is needed", () => {
    expect(
      sourceTargetUsd({ transactionUsd: TRANSACTION, routeKind: "tokens", gasNeeded: false }),
    ).toBe(210);
    expect(
      sourceTargetUsd({ transactionUsd: TRANSACTION, routeKind: "buy", gasNeeded: false }),
    ).toBe(210);
  });

  // D9, decided 2026-08-10: the rate is the SERVER's to set, so it has to be overridable here. The
  // constant is the fallback for a quote that has not arrived or does not carry one.
  it("[D9] takes the buffer rate from the caller, falling back to the shipped default", () => {
    expect(
      sourceTargetUsd({
        transactionUsd: TRANSACTION,
        routeKind: "tokens",
        gasNeeded: false,
        bufferRate: 0.03,
      }),
    ).toBe(206);
    expect(DEFAULT_SOURCE_BUFFER_RATE).toBe(0.05);
  });

  it("[D9] ignores a malformed rate rather than propagating NaN into the CTA's comparison", () => {
    // A NaN target compares false against everything, which would silently OPEN the CTA. The
    // shipped default is the safe reading, because over-asking is the deliberate direction.
    for (const bufferRate of [Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
      expect(
        sourceTargetUsd({
          transactionUsd: TRANSACTION,
          routeKind: "tokens",
          gasNeeded: false,
          bufferRate,
        }),
      ).toBe(210);
    }
  });

  it("rounds UP to the cent, so a sub-cent gap never reads as covered", () => {
    // 33.33 * 1.05 = 34.9965, which must not present as 34.99.
    expect(sourceTargetUsd({ transactionUsd: 33.33, routeKind: "tokens", gasNeeded: false })).toBe(
      35,
    );
  });

  it("returns zero for a malformed transaction instead of NaN", () => {
    // Zero left this list in POO-1755 [R1]: it is the non-spending ops' legitimate cost and now
    // prices the gas component alone (its own describe below).
    for (const transactionUsd of [-10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sourceTargetUsd({ transactionUsd, routeKind: "tokens", gasNeeded: true })).toBe(0);
    }
  });

  it("charges the deposit route nothing to source, since its amount is settled elsewhere", () => {
    expect(
      sourceTargetUsd({ transactionUsd: TRANSACTION, routeKind: "deposit", gasNeeded: true }),
    ).toBe(0);
  });

  // POO-1542 [A]: the exact case named in the issue. A $3 gas-only top-up buys at (3 * 1.05) + 2 =
  // 5.15, an amount Paybis will not sell: the smallest real order this app can place is the $10
  // floor, so the row must never claim less. The floor closes gaps in the QUOTE too: the subtitle
  // that carries the real charge disappears on any quote failure (always in mock mode, where the
  // quote hook is gated off; reachable in production on a throttle, timeout or unsold pair. POO-1626:
  // "every dev environment, no USDC-BASE pair" stood here and POO-1605 made it false), leaving the
  // title as the ONLY figure on screen.
  describe("[A] the buy route never prints below PAYBIS_MIN_USD (POO-1542)", () => {
    it("floors a small gas-only top-up that would otherwise print $5.15", () => {
      expect(sourceTargetUsd({ transactionUsd: 3, routeKind: "buy", gasNeeded: true })).toBe(
        PAYBIS_MIN_USD,
      );
    });

    it("floors a small requirement even with no gas component at all", () => {
      // 3 * 1.05 = 3.15, still under the floor.
      expect(sourceTargetUsd({ transactionUsd: 3, routeKind: "buy", gasNeeded: false })).toBe(
        PAYBIS_MIN_USD,
      );
    });

    it("leaves a figure already above the floor untouched", () => {
      // The worked $200 example: (200 * 1.05) + 2 = 212, well above $10.
      expect(
        sourceTargetUsd({ transactionUsd: TRANSACTION, routeKind: "buy", gasNeeded: true }),
      ).toBe(212);
    });

    it("never floors the tokens route: converting a holding carries no Paybis minimum", () => {
      // (3 + 5) * 1.05 = 8.4, below $10, and must stay 8.4 - this is not a fiat purchase.
      expect(sourceTargetUsd({ transactionUsd: 3, routeKind: "tokens", gasNeeded: true })).toBe(
        8.4,
      );
    });
  });

  /**
   * POO-1755 [R1]: zero is a LEGITIMATE transaction cost, not a malformed input.
   *
   * The five non-spending ops (withdraw / collect / compound / move-range / close) carry
   * `opRequiredUsdc: 0` by definition (POO-1042 [R3]), and POO-1033 [R2] deliberately routes them
   * into the wizard when their gas can only come from another chain. What such a route must source
   * is the gas component alone. Treating zero as malformed is what left the route picker's D1
   * skeleton waiting forever on a figure nothing was computing (production, v1.5.0 through v1.6.3).
   */
  describe("[R1] a zero-cost operation still sources its gas (POO-1755)", () => {
    it("prices the gas component alone on the token routes", () => {
      // (0 + 5) * 1.05
      expect(sourceTargetUsd({ transactionUsd: 0, routeKind: "tokens", gasNeeded: true })).toBe(
        5.25,
      );
      expect(
        sourceTargetUsd({ transactionUsd: 0, routeKind: "tokens-plus-buy", gasNeeded: true }),
      ).toBe(5.25);
    });

    it("floors the buy route at the Paybis minimum, the smallest order the rail sells", () => {
      // (0 * 1.05) + 2 = 2, floored at 10.
      expect(sourceTargetUsd({ transactionUsd: 0, routeKind: "buy", gasNeeded: true })).toBe(
        PAYBIS_MIN_USD,
      );
    });

    it("still returns 0 when there is nothing to source at all (zero transaction, no gas)", () => {
      // No floor either: a $10 purchase of nothing is not a smaller version of any real order.
      expect(sourceTargetUsd({ transactionUsd: 0, routeKind: "tokens", gasNeeded: false })).toBe(0);
      expect(sourceTargetUsd({ transactionUsd: 0, routeKind: "buy", gasNeeded: false })).toBe(0);
    });

    it("still refuses a malformed transaction outright, gas need or not", () => {
      for (const transactionUsd of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
        expect(sourceTargetUsd({ transactionUsd, routeKind: "tokens", gasNeeded: true })).toBe(0);
        expect(sourceTargetUsd({ transactionUsd, routeKind: "buy", gasNeeded: true })).toBe(0);
      }
    });
  });
});
