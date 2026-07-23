/**
 * @id PP-DEP-LIB-001 (POO-229, POO-494)
 * @name depositQuote
 * @implements-rules-version v2
 *
 * The fiat-deposit fee math, in Decimal (never JS float — number-formatting skill §1). The fee model
 * mirrors Paybis' published structure (POO-494 R3): a service fee (rate with a USD minimum) plus the
 * payment provider's processing fee. Two quote directions (the caller picks per deposit):
 * - SPEND-fixed: the field is what you PAY, so USDC received = pay minus fee.
 * - RECEIVED-fixed (all deposits today, POO-729; and the invest top-up, POO-281/POO-494): the field
 *   is the exact USDC to receive, so the fee is added ON TOP. The solve has two branches: percentage
 *   (service rate binds) and minimum (the USD minimum binds); the charged amount is rounded UP to the
 *   cent (POO-494 R4) so "you'll receive" never lands below the target.
 *
 * Pure (no React) so the precision is unit-tested independently of the screen. Callers convert each
 * Decimal to a number only at the formatting / analytics edge (display-only floats).
 *
 * PP-INTEGRATION-POINT: the fee model values are Paybis' published numbers, entered statically
 * (DepositScreen). The real hosted-checkout quote replaces this math when the ramp is wired; the
 * received-fixed direction maps to Paybis' `amountTo` (POO-281 R6).
 */
import Decimal from "decimal.js";

/** The Paybis fee model for one payment method, all rates as fractions and the minimum in USD. */
export interface PaybisFees {
  /** Paybis service fee rate (e.g. `0.0149` for 1.49%; includes FX). */
  serviceRate: Decimal.Value;
  /** Minimum service fee in USD (e.g. `2`). */
  serviceMin: Decimal.Value;
  /** The payment provider's processing rate for the chosen method (e.g. `0.0278` for cards). */
  processingRate: Decimal.Value;
}

/** A deposit fee breakdown, all in USD, kept as Decimal until the display edge. */
export interface DepositQuote {
  /** What the investor pays (debited). */
  charged: Decimal;
  /** USDC the investor receives after the fee. */
  net: Decimal;
  /** The fee (`charged − net`). */
  fee: Decimal;
}

/** The service fee for a given charged amount: `max(charged × rate, minimum)`. */
function serviceFeeFor(charged: Decimal, serviceRate: Decimal, serviceMin: Decimal): Decimal {
  return Decimal.max(charged.times(serviceRate), serviceMin);
}

/**
 * Compute a deposit fee breakdown.
 *
 * @param amount The field value (USD): what you pay when `receivedFixed` is false, what you receive when true.
 * @param fees The Paybis fee model for the chosen payment method.
 * @param receivedFixed `true` for the invest top-up (fee on top); `false` for a direct deposit (fee deducted).
 */
export function computeDepositQuote(
  amount: Decimal.Value,
  fees: PaybisFees,
  receivedFixed: boolean,
): DepositQuote {
  const value = new Decimal(amount);
  const serviceRate = new Decimal(fees.serviceRate);
  const serviceMin = new Decimal(fees.serviceMin);
  const processingRate = new Decimal(fees.processingRate);

  if (!receivedFixed) {
    const charged = value;
    const fee = serviceFeeFor(charged, serviceRate, serviceMin).plus(charged.times(processingRate));
    return { charged, net: charged.minus(fee), fee };
  }

  // RECEIVED-fixed: solve `charged − fee(charged) = net` for the target net. On the percentage
  // branch the service rate binds; on the minimum branch the flat minimum binds. The branch is
  // picked by checking which regime the candidate charged actually falls in (they meet at the
  // boundary).
  const net = value;
  const pctCandidate = net.dividedBy(new Decimal(1).minus(serviceRate).minus(processingRate));
  const usePctBranch = pctCandidate.times(serviceRate).greaterThanOrEqualTo(serviceMin);
  const exactCharged = usePctBranch
    ? pctCandidate
    : net.plus(serviceMin).dividedBy(new Decimal(1).minus(processingRate));
  // POO-494 R4: round the payable amount UP to the cent so the net never lands below the target.
  const charged = exactCharged.toDecimalPlaces(2, Decimal.ROUND_UP);
  return { charged, net, fee: charged.minus(net) };
}
