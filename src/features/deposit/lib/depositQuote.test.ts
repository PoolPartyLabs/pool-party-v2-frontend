import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { computeDepositQuote, type PaybisFees } from "./depositQuote";

/** Paybis published model (POO-494 R3): 1.49% service (min $2) + per-method processing. */
const PIX: PaybisFees = { serviceRate: 0.0149, serviceMin: 2, processingRate: 0 };
const CARD: PaybisFees = { serviceRate: 0.0149, serviceMin: 2, processingRate: 0.0278 };

describe("computeDepositQuote", () => {
  // @rule POO-494 R3: spend-fixed deducts service (1.49%, min $2) + processing from the paid amount.
  it("computes a spend-fixed quote on the percentage branch", () => {
    const quote = computeDepositQuote(500, PIX, false);
    expect(quote.charged.toString()).toBe("500");
    expect(quote.fee.toString()).toBe("7.45");
    expect(quote.net.toString()).toBe("492.55");
  });

  // @rule POO-494 R3: the $2 service minimum binds on small spend-fixed deposits.
  it("applies the $2 service minimum on a spend-fixed quote", () => {
    const quote = computeDepositQuote(100, PIX, false);
    expect(quote.fee.toString()).toBe("2");
    expect(quote.net.toString()).toBe("98");
  });

  // @rule POO-494 R3: card adds the provider processing fee on top of the service fee.
  it("adds the card processing fee on a spend-fixed quote", () => {
    const quote = computeDepositQuote(100, CARD, false);
    expect(quote.fee.toString()).toBe("4.78"); // 2 (min service) + 2.78 (processing)
    expect(quote.net.toString()).toBe("95.22");
  });

  // @rule POO-494 R4: received-fixed solves charged on the percentage branch, rounded UP to the cent.
  it("computes a received-fixed quote on the percentage branch, rounded up to the cent", () => {
    const quote = computeDepositQuote(150, PIX, true);
    expect(quote.net.toString()).toBe("150");
    expect(quote.charged.toString()).toBe("152.27"); // ceil₂(150 / (1 − 0.0149))
    expect(quote.fee.toString()).toBe("2.27");
  });

  // @rule POO-494 R4: when the $2 minimum binds, charged = (target + min) / (1 − processing).
  it("computes a received-fixed quote on the minimum branch", () => {
    const quote = computeDepositQuote(50, PIX, true);
    expect(quote.net.toString()).toBe("50");
    expect(quote.charged.toString()).toBe("52");
    expect(quote.fee.toString()).toBe("2");
  });

  it("combines the minimum branch with a processing fee", () => {
    const quote = computeDepositQuote(50, CARD, true);
    expect(quote.charged.toString()).toBe("53.49"); // ceil₂((50 + 2) / (1 − 0.0278))
    expect(quote.fee.toString()).toBe("3.49");
    expect(quote.net.toString()).toBe("50");
  });

  // @rule POO-494 R4: the net NEVER lands below the target and charged is a payable 2-decimal amount.
  it("never delivers less than the target in received-fixed mode", () => {
    for (const target of [10, 33.33, 97.93, 149.99, 1234.56]) {
      for (const fees of [PIX, CARD]) {
        const quote = computeDepositQuote(target, fees, true);
        expect(quote.net.toNumber()).toBe(target);
        expect(quote.charged.minus(quote.fee).toNumber()).toBe(target);
        expect(quote.charged.decimalPlaces()).toBeLessThanOrEqual(2);
      }
    }
  });

  // @rule (number-formatting §3): the math runs in Decimal, so it does not inherit IEEE-754 drift.
  it("stays precise where a float would drift", () => {
    const quote = computeDepositQuote(
      0.1,
      { serviceRate: 0.2, serviceMin: 0, processingRate: 0 },
      false,
    );
    // 0.1 * (1 - 0.2) = 0.08 exactly (a float gives 0.08000000000000002).
    expect(quote.net.equals(new Decimal("0.08"))).toBe(true);
  });

  it("accepts Decimal inputs", () => {
    const quote = computeDepositQuote(new Decimal(500), PIX, false);
    expect(quote.fee.toString()).toBe("7.45");
    expect(quote.net.toString()).toBe("492.55");
  });
});
