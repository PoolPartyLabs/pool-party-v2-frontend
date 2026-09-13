/**
 * @id PP-CORE-MCK-003
 * @name on-ramp payment methods (mock)
 * @implements-rules-version v1 (POO-1513 rules v1)
 *
 * The fiat on-ramp's payment methods and per-method charge, for MOCK MODE only (premise 2).
 *
 * ## Why this fixture had to exist
 *
 * `/deposit`'s picker reads the live list through `useBuyRouteQuote`, which is gated on
 * `!isMockMode && isFeatureEnabled("fiatOnRamp")`, and there is no mock for
 * `getOnRampPaymentMethodsAction`. So in mock mode the dialog rendered "Paybis did not return any
 * payment options right now" permanently, the review always printed "Shown at checkout", and the
 * receipt omitted its Amount row. With no `.stories.tsx` for the modal either, there was NO
 * configuration in which anyone could see the designed picker at all: the visual harness could not
 * show the surface it exists to show.
 *
 * ## Maximum realism, and what each row is for
 *
 * Resolved currency is EUR, not USD. Since POO-1512 the list is fetched for the BUYER's own currency
 * and every figure carries its own code, and the defect that opened this issue was a European charged
 * in dollars; a dollar fixture would let that whole class of bug render as if it were fine.
 *
 * Three methods, so the picker's three behaviours are all exercisable by hand:
 *
 *   - a CARD (`poolparty-credit-card`, the identifier POO-1413 captured from a live
 *     `POST /v2/quote` on 2026-08-07, and the one `pickDefaultPaymentMethod` selects as the default),
 *   - a BANK TRANSFER (`poolparty-sepa`) whose floor sits ABOVE a typical order, so it renders
 *     BLOCKED (POO-1609) and activating it fires the blocked-intent event,
 *   - a LOCAL RAIL (`poolparty-ideal`, EUR-only by construction), so the list is visibly not the
 *     deleted `pix | card | applePay | bank` union.
 *
 * ## The charge model is a MOCK, and only a mock
 *
 * POO-1513 S3 deleted `depositQuote.ts` precisely because a local fee model is a second and wrong
 * source for a number the vendor already sends: it priced `bank: 0` while the buyer was charged
 * ~2.78% on a card. Nothing here weakens that. In real mode this module is never read; the only
 * figure /deposit prints is the vendor's own `amountFrom`. These rates exist so the mocked screen
 * shows a plausible number instead of a blank, which is the same job every other fixture in this
 * folder does, and they live behind the mock branch rather than beside the real one so they can never
 * be mistaken for a source of truth.
 *
 * PP-MOCK: static fixtures plus a derived charge, read only when `isMockMode` is on. The real seam is
 * the marked one on `useBuyRouteQuote` in `DepositScreen.tsx` (the live Paybis list + received-fixed
 * quote, PP-CORE-LIB-063); this is that seam's mock branch, not a second one.
 */
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import { simulateDelay } from "@/mocks/utils/simulate";

/**
 * The fiat the mocked buyer is resolved to. Both the list's minimums and the derived charge are
 * denominated in it, exactly as POO-1512 pins one resolution per flow.
 */
export const MOCK_ONRAMP_CURRENCY = "EUR";

/** Mocked EUR per 1 USDC. Plausible, and deliberately not 1, so a USD-pinned regression is visible. */
const MOCK_EUR_PER_USDC = 0.92;

/** The list `getOnRampPaymentMethodsAction` stands in for, in {@link MOCK_ONRAMP_CURRENCY}. */
/**
 * The `labels` here are taken from the LIVE sandbox capture (14/08), never invented (POO-1644: mock
 * mode is what design approves, and it has already shipped one label Paybis does not send).
 *
 * The whole observed vocabulary is `instant`, `low-fee` and `high-approval-rate`, all three POSITIVE.
 * A slow rail expresses itself by OMITTING `instant`, which is why SEPA below carries `low-fee` and
 * nothing about speed: there is no "1-2 business days" tag in this payload and writing one here would
 * put a claim on screen the vendor never made. One method carrying all three is the normal case.
 */
export const mockOnRampPaymentMethods: readonly OnRampPaymentMethod[] = [
  {
    paymentMethod: "poolparty-credit-card",
    displayName: "Credit Card",
    minUsd: 15,
    minCurrencyCode: MOCK_ONRAMP_CURRENCY,
    labels: ["instant", "high-approval-rate"],
  },
  {
    // Slow by nature, and the payload says so only by leaving `instant` out.
    paymentMethod: "poolparty-sepa",
    displayName: "SEPA Bank Transfer",
    minUsd: 200,
    minCurrencyCode: MOCK_ONRAMP_CURRENCY,
    labels: ["low-fee"],
  },
  {
    paymentMethod: "poolparty-ideal",
    displayName: "iDEAL",
    minUsd: 20,
    minCurrencyCode: MOCK_ONRAMP_CURRENCY,
    labels: ["instant", "low-fee", "high-approval-rate"],
  },
];

/**
 * Mocked per-method processing terms. A rate and a fixed component, because real providers charge
 * both and a rate-only model makes every method look identical at every order size.
 */
const MOCK_TERMS: Record<string, { rate: number; fixed: number }> = {
  "poolparty-credit-card": { rate: 0.0278, fixed: 0 },
  "poolparty-sepa": { rate: 0.0075, fixed: 0 },
  "poolparty-ideal": { rate: 0.012, fixed: 0.35 },
};

/**
 * The received-fixed charge for `amountToUsd` USDC on `paymentMethod`, in
 * {@link MOCK_ONRAMP_CURRENCY}, or `undefined` for a method this fixture does not price.
 *
 * Received-fixed (POO-729/POO-1139): the caller names the USDC to DELIVER and this answers what it
 * costs, which is the direction the real quote runs in. Cents are rounded, the precision the review
 * screen displays.
 */
export function mockOnRampCharge(amountToUsd: number, paymentMethod: string): number | undefined {
  const terms = MOCK_TERMS[paymentMethod];
  if (!terms || !Number.isFinite(amountToUsd) || amountToUsd <= 0) return undefined;
  const charge = amountToUsd * MOCK_EUR_PER_USDC * (1 + terms.rate) + terms.fixed;
  return Math.round(charge * 100) / 100;
}

/**
 * Resolve the mocked list, after a plausible round trip.
 *
 * The delay is what keeps the degraded state REACHABLE rather than theoretical: "unresolved" and
 * "unreadable" render the same informational caption by design (`PaymentMethodDialog`'s header), so
 * a fixture that appeared synchronously would have made the empty state impossible to see by hand
 * and would have quietly deleted the mock-mode assertions that pin it.
 */
export async function fetchMockOnRampPaymentMethods(): Promise<{
  methods: OnRampPaymentMethod[];
  currencyCodeFrom: string;
}> {
  await simulateDelay(180, 420);
  return {
    methods: mockOnRampPaymentMethods.map((method) => ({ ...method })),
    currencyCodeFrom: MOCK_ONRAMP_CURRENCY,
  };
}
