/**
 * @id PP-CORE-LIB-101 — tests
 * @name on-ramp method-floor comparison — tests
 * @implements-rules-version v1 (POO-1609 rules v1)
 *
 * POO-1609 (murilo, 2026-08-14, second and standing reversal): the charge is never raised. A method
 * whose minimum exceeds the order renders BLOCKED instead. Two tiers, decided after two wrong drafts
 * (both recorded in the Linear issue so nobody rebuilds them):
 *
 *   Tier 1 — the row carries a charge (POO-1599 prices every method in one call): compare that
 *            charge to the row's own floor. Exact, no currency guard needed (both figures are
 *            denominated in the currency the flow resolved, by construction).
 *   Tier 2 — the row carries NO charge (the gas-first buyer, `pricingEnabled: false`): compare the
 *            entered amount to the floor. This is the common case for that buyer, not a fallback of
 *            convenience. The currency guard applies HERE ONLY: entered amount is USDC (~USD), and a
 *            floor in a different currency cannot be compared without an FX source (POO-333) — a
 *            method wrongly blocked removes an option the buyer could have used, so an incomparable
 *            row is never blocked.
 */
import { describe, expect, it } from "vitest";
import { isMethodBelowFloor, lowestFloor, sameFiat } from "./methodFloor";

describe("isMethodBelowFloor — tier 1 (row carries a charge)", () => {
  it("blocks when the row's own charge is below its own floor", () => {
    const method = { paymentMethod: "poolparty-sepa", minUsd: 300, minCurrencyCode: "EUR" };
    expect(
      isMethodBelowFloor({
        method,
        charge: { amount: 290.72, currencyCode: "EUR" },
        enteredAmount: 100,
      }),
    ).toBe(true);
  });

  it("does not block when the charge meets the floor exactly (only EXCEEDS blocks)", () => {
    const method = { paymentMethod: "poolparty-sepa", minUsd: 300, minCurrencyCode: "EUR" };
    expect(
      isMethodBelowFloor({
        method,
        charge: { amount: 300, currencyCode: "EUR" },
        enteredAmount: 100,
      }),
    ).toBe(false);
  });

  it("does not block when the charge clears the floor", () => {
    const method = { paymentMethod: "poolparty-sepa", minUsd: 300, minCurrencyCode: "EUR" };
    expect(
      isMethodBelowFloor({
        method,
        charge: { amount: 305, currencyCode: "EUR" },
        enteredAmount: 100,
      }),
    ).toBe(false);
  });

  // Frame 1 (4739:131): "Bank transfer / Min. $500.00" against a $100 order, priced, is blocked.
  it("matches the Figma frame 1 case: a priced method below a $500 floor blocks", () => {
    const method = { paymentMethod: "bank-transfer", minUsd: 500, minCurrencyCode: "USD" };
    expect(
      isMethodBelowFloor({
        method,
        charge: { amount: 104, currencyCode: "USD" },
        enteredAmount: 100,
      }),
    ).toBe(true);
  });
});

describe("isMethodBelowFloor — tier 2 (row carries no charge: the gas-first buyer)", () => {
  it("blocks on the ENTERED amount when there is no charge to compare", () => {
    const method = { paymentMethod: "poolparty-sepa", minUsd: 200, minCurrencyCode: "USD" };
    expect(isMethodBelowFloor({ method, enteredAmount: 100 })).toBe(true);
  });

  it("does not block when the entered amount meets or clears the floor", () => {
    const method = { paymentMethod: "poolparty-sepa", minUsd: 200, minCurrencyCode: "USD" };
    expect(isMethodBelowFloor({ method, enteredAmount: 200 })).toBe(false);
    expect(isMethodBelowFloor({ method, enteredAmount: 250 })).toBe(false);
  });

  // Frame 2 (7617:7351): gas-first, no charges anywhere. Blocking still applies via tier 2.
  it("matches the Figma frame 2 case: the gas-first buyer still blocks a method they cannot reach", () => {
    const method = { paymentMethod: "bank-transfer", minUsd: 500, minCurrencyCode: "USD" };
    expect(isMethodBelowFloor({ method, enteredAmount: 100 })).toBe(true);
  });

  it("is case- and padding-insensitive on the currency guard", () => {
    const method = { paymentMethod: "poolparty-sepa", minUsd: 200, minCurrencyCode: " usd " };
    expect(isMethodBelowFloor({ method, enteredAmount: 100 })).toBe(true);
  });

  // POO-333: no FX source. A method wrongly blocked removes an option the buyer could have used,
  // which is worse than a method wrongly offered (recoverable at checkout).
  it("never blocks on tier 2 when the floor is in a currency the entered amount cannot be compared to", () => {
    const method = { paymentMethod: "poolparty-sepa", minUsd: 200, minCurrencyCode: "EUR" };
    expect(isMethodBelowFloor({ method, enteredAmount: 1 })).toBe(false);
  });

  it("never blocks when the method carries no floor at all", () => {
    const method = { paymentMethod: "poolparty-card", minUsd: 0, minCurrencyCode: "USD" };
    expect(isMethodBelowFloor({ method, enteredAmount: 0 })).toBe(false);
  });
});

describe("isMethodBelowFloor — an unreadable charge falls back to tier 2, never treated as free", () => {
  it("falls back to the entered amount when the charge is exactly zero", () => {
    const method = { paymentMethod: "poolparty-sepa", minUsd: 200, minCurrencyCode: "USD" };
    expect(
      isMethodBelowFloor({
        method,
        charge: { amount: 0, currencyCode: "USD" },
        enteredAmount: 100,
      }),
    ).toBe(true);
  });

  it("falls back to the entered amount when the charge is negative", () => {
    const method = { paymentMethod: "poolparty-sepa", minUsd: 200, minCurrencyCode: "USD" };
    expect(
      isMethodBelowFloor({
        method,
        charge: { amount: -5, currencyCode: "USD" },
        enteredAmount: 250,
      }),
    ).toBe(false);
  });
});

describe("lowestFloor", () => {
  it("names the lowest positive floor across the list, for method.allBlocked's {amount}", () => {
    const methods = [
      { paymentMethod: "a", minUsd: 500, minCurrencyCode: "USD" },
      { paymentMethod: "b", minUsd: 200, minCurrencyCode: "USD" },
      { paymentMethod: "c", minUsd: 300, minCurrencyCode: "USD" },
    ];
    expect(lowestFloor(methods)?.paymentMethod).toBe("b");
  });

  it("ignores methods with no floor (minUsd <= 0)", () => {
    const methods = [
      { paymentMethod: "a", minUsd: 0, minCurrencyCode: "USD" },
      { paymentMethod: "b", minUsd: 200, minCurrencyCode: "USD" },
    ];
    expect(lowestFloor(methods)?.paymentMethod).toBe("b");
  });

  it("returns undefined for an empty list or a list with no floor at all", () => {
    expect(lowestFloor([])).toBeUndefined();
    expect(
      lowestFloor([{ paymentMethod: "a", minUsd: 0, minCurrencyCode: "USD" }]),
    ).toBeUndefined();
  });
});

/**
 * POO-1632: the ONE currency-equality rule for the on-ramp, now exported.
 *
 * There were two, and they disagreed on the case that matters most. `onRampMethodRows.ts` kept its
 * own copy and its comment named this file as the intended shared home "which the deposit lane owns
 * and has not landed" — it landed as PP-CORE-LIB-101 and the comment went stale, which is exactly the
 * drift POO-1632 exists to stop.
 *
 * The convergence takes the STRICTER of the two: a blank code names no currency, so it can never
 * license a comparison. The old copy here answered `true` for two blanks, because `"" === ""`. That
 * was unreachable from its own call site (the second operand is the literal `"USD"`), and it is a
 * live trap on the ROW builder's call site, where BOTH operands come off the wire: `minCurrencyCode`
 * rides the METHODS call and `chargeCurrencyCode` rides the QUOTE, so a payload with both codes empty
 * would have licensed a subtraction across two figures whose denomination nothing established, and
 * this app has no FX source at all (POO-333).
 */
describe("sameFiat — one currency-equality rule, and blank is not a currency", () => {
  it("folds case and padding, because a currency code is an identifier", () => {
    expect(sameFiat("usd", "USD")).toBe(true);
    expect(sameFiat(" EUR ", "eur")).toBe(true);
  });

  it("refuses two different currencies", () => {
    expect(sameFiat("EUR", "USD")).toBe(false);
  });

  it("refuses a BLANK pair, which the pre-convergence copy in this file accepted", () => {
    expect(sameFiat("", "")).toBe(false);
    expect(sameFiat("   ", "")).toBe(false);
  });

  it("refuses an absent code on either side", () => {
    expect(sameFiat(undefined, "USD")).toBe(false);
    expect(sameFiat("USD", undefined)).toBe(false);
    expect(sameFiat(undefined, undefined)).toBe(false);
  });
});
