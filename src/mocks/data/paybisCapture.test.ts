/**
 * @id PP-CORE-MCK-007 (POO-1598 S5)
 * @name Paybis captured purchase (mock, wire-level ground truth), tests
 * @implements-rules-version v1 (POO-1598 rules v1)
 *
 * Locks in the ground truth `paybisCapture.ts` exists to carry. Two kinds of assertion:
 *
 *   1. **Contract compatibility.** Every captured wire body parses through this app's REAL, imported
 *      (never copied) `@/lib/onramp/schemas` zod schemas. If a future schema change breaks one of
 *      these, the capture and the live contract have drifted and that is exactly the signal to see.
 *   2. **The specific facts POO-1598 was opened to preserve** (module header, "The cases this capture
 *      exists to preserve"): the priced-and-refused pair, its refused/accepted v3/request outcomes,
 *      SEPA's non-instant labelling, the moving minimum, and the near-fixed low-amount service fee.
 *      Each one is a `// @rule` so a future edit that quietly "normalizes" one of these away fails
 *      here first, not in a support ticket.
 *
 * Plus the redaction contract (`CR-CORE-027`): no real quote/request id survives, the corrupted
 * exchange-rate string never appears, and the synthetic wallet is valid-format.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeOnRampPaymentMethods,
  normalizeOnRampQuote,
  onRampPaymentMethodsResponseSchema,
  onRampQuoteResponseSchema,
  onRampRequestResponseSchema,
} from "@/lib/onramp/schemas";
import {
  findPaybisCaptureQuoteById,
  MOCK_PAYBIS_CAPTURE_METHODS_ETH_BASE,
  MOCK_PAYBIS_CAPTURE_METHODS_USDC_BASE,
  MOCK_PAYBIS_CAPTURE_METHODS_USDC_BASE_REPEAT,
  MOCK_PAYBIS_CAPTURE_QUOTE_1USDC_CARD,
  MOCK_PAYBIS_CAPTURE_QUOTE_5USDC,
  MOCK_PAYBIS_CAPTURE_QUOTE_9USDC,
  MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_ALL,
  MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_CARD_A,
  MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_CARD_B,
  MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_GOOGLE_PAY,
  MOCK_PAYBIS_CAPTURE_QUOTE_11USDC_CARD_A,
  MOCK_PAYBIS_CAPTURE_QUOTE_11USDC_CARD_B,
  MOCK_PAYBIS_CAPTURE_QUOTE_100USDC,
  MOCK_PAYBIS_CAPTURE_QUOTE_105USDC,
  MOCK_PAYBIS_CAPTURE_QUOTE_205USDC,
  MOCK_PAYBIS_CAPTURE_QUOTE_255USDC,
  MOCK_PAYBIS_CAPTURE_QUOTES,
  MOCK_PAYBIS_CAPTURE_REQUEST_201,
  MOCK_PAYBIS_CAPTURE_REQUEST_422,
  MOCK_PAYBIS_CAPTURE_WALLET,
} from "./paybisCapture";

const CARD = "pool-party-credit-card";
const SEPA = "pool-party-manual-bank-transfer";

const ALL_METHOD_LISTS = [
  MOCK_PAYBIS_CAPTURE_METHODS_ETH_BASE,
  MOCK_PAYBIS_CAPTURE_METHODS_USDC_BASE,
  MOCK_PAYBIS_CAPTURE_METHODS_USDC_BASE_REPEAT,
];

describe("paybisCapture: contract compatibility with the real onramp schemas", () => {
  it.each(
    ALL_METHOD_LISTS.map((list, index) => [index, list] as const),
  )("method list %i parses through onRampPaymentMethodsResponseSchema", (_index, list) => {
    const parsed = onRampPaymentMethodsResponseSchema.safeParse(list);
    expect(parsed.success).toBe(true);
  });

  it("every method list has exactly 10 real Paybis method ids", () => {
    for (const list of ALL_METHOD_LISTS) {
      expect(list).toHaveLength(10);
      for (const method of list) {
        expect(method.paymentMethod.startsWith("pool-party")).toBe(true);
      }
    }
  });

  it("normalizes the USDC-BASE method list without dropping the vendor's own fields", () => {
    const parsed = onRampPaymentMethodsResponseSchema.parse(MOCK_PAYBIS_CAPTURE_METHODS_USDC_BASE);
    const normalized = normalizeOnRampPaymentMethods(parsed);
    const card = normalized.find((method) => method.paymentMethod === CARD);
    expect(card?.icon).toMatch(/^https:\/\//);
    expect(card?.labels).toContain("instant");
    expect(card?.maxUsd).toBeGreaterThan(0);
  });

  it.each(
    MOCK_PAYBIS_CAPTURE_QUOTES.map((record) => [record.sourceIndex, record] as const),
  )("quote record (source index %i) parses through onRampQuoteResponseSchema", (_sourceIndex, record) => {
    const parsed = onRampQuoteResponseSchema.safeParse(record.responseBody);
    expect(parsed.success).toBe(true);
  });

  it("normalizes the priced-and-refused quote to one method with a chargeUsd and one error", () => {
    const parsed = onRampQuoteResponseSchema.parse(
      MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_CARD_B.responseBody,
    );
    const quote = normalizeOnRampQuote(parsed);
    expect(quote.paymentMethods).toHaveLength(1);
    expect(quote.paymentMethods[0]?.chargeUsd).toBeCloseTo(10.53, 2);
    expect(quote.paymentMethodErrors).toHaveLength(1);
    expect(quote.paymentMethodErrors[0]?.message).toContain("10.003001");
  });

  it("the accepted (201) request response parses through onRampRequestResponseSchema", () => {
    const parsed = onRampRequestResponseSchema.safeParse(
      MOCK_PAYBIS_CAPTURE_REQUEST_201.responseBody,
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.requestId).toBe("mock-poo1598-request-11usdc-card-201");
  });
});

describe("paybisCapture: case 1, a method priced AND refused in the same response (POO-1666)", () => {
  // @rule the 10 USDC card quote lists `pool-party-credit-card` in BOTH paymentMethods and
  // paymentMethodErrors, which is POO-1666's root cause and must never be "cleaned up" away.
  it("10 USDC card quote (B) prices the card AND refuses it in the same response", () => {
    const { responseBody } = MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_CARD_B;
    const priced = responseBody.paymentMethods.find((method) => method.id === CARD);
    expect(priced?.amountFrom).toEqual({ amount: "10.53", currencyCode: "EUR" });
    const refused = responseBody.paymentMethodErrors?.find((entry) => entry.paymentMethod === CARD);
    expect(refused?.error.message).toBe(
      "You have to buy or sell at least 10.003001 USDC per order",
    );
  });

  // @rule the 10 USDC card quote (A), the first attempt at the same amount/method, shows the same
  // priced-and-refused shape (not a one-off): only the vendor minimum's exact digits differ over time.
  it("10 USDC card quote (A) is the same shape as its (B) twin", () => {
    const { responseBody } = MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_CARD_A;
    expect(responseBody.paymentMethods.find((method) => method.id === CARD)).toBeDefined();
    expect(
      responseBody.paymentMethodErrors?.find((entry) => entry.paymentMethod === CARD)?.error
        .message,
    ).toContain("USDC per order");
  });

  // @rule the 10 USDC Google Pay quote is a second, independent instance of the same priced-and-refused
  // shape on a DIFFERENT payment method, proving this is not card-specific.
  it("10 USDC Google Pay quote is priced AND refused too", () => {
    const { responseBody } = MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_GOOGLE_PAY;
    const method = "pool-party-google-pay-credit-card";
    expect(responseBody.paymentMethods.find((entry) => entry.id === method)).toBeDefined();
    expect(
      responseBody.paymentMethodErrors?.find((entry) => entry.paymentMethod === method),
    ).toBeDefined();
  });

  // @rule the 11 USDC twin carries NO paymentMethodErrors: one USDC apart is the entire difference
  // between a refused and an accepted order on this payment method.
  it("11 USDC card quotes (A and B) carry NO paymentMethodErrors", () => {
    expect(
      MOCK_PAYBIS_CAPTURE_QUOTE_11USDC_CARD_A.responseBody.paymentMethodErrors,
    ).toBeUndefined();
    expect(
      MOCK_PAYBIS_CAPTURE_QUOTE_11USDC_CARD_B.responseBody.paymentMethodErrors,
    ).toBeUndefined();
    expect(
      MOCK_PAYBIS_CAPTURE_QUOTE_11USDC_CARD_B.responseBody.paymentMethods.find(
        (method) => method.id === CARD,
      ),
    ).toBeDefined();
  });

  // @rule the 422 v3/request replays the (B) quote's synthetic id, refused for exactly the reason a
  // priced-but-under-minimum method produces at mint time.
  it("the 422 request references the 10 USDC card (B) quote id and fails on that ground", () => {
    expect(MOCK_PAYBIS_CAPTURE_REQUEST_422.requestBody.quoteId).toBe(
      MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_CARD_B.responseBody.id,
    );
    expect(MOCK_PAYBIS_CAPTURE_REQUEST_422.status).toBe(422);
    expect(MOCK_PAYBIS_CAPTURE_REQUEST_422.responseBody.errors[0]?.message).toBe(
      "There are no available payment/payout methods in Quote",
    );
  });

  // @rule the 201 v3/request replays the (B) 11 USDC quote's synthetic id and mints a requestId: the
  // exact controlled pair the module header promises.
  it("the 201 request references the 11 USDC card (B) quote id and mints a requestId", () => {
    expect(MOCK_PAYBIS_CAPTURE_REQUEST_201.requestBody.quoteId).toBe(
      MOCK_PAYBIS_CAPTURE_QUOTE_11USDC_CARD_B.responseBody.id,
    );
    expect(MOCK_PAYBIS_CAPTURE_REQUEST_201.status).toBe(201);
    expect(MOCK_PAYBIS_CAPTURE_REQUEST_201.responseBody.requestId).toMatch(/^mock-/);
  });
});

describe("paybisCapture: case 2, SEPA is non-instant by omission", () => {
  // @rule SEPA carries `low-fee` only, never `instant`; this is the entire real evidence behind the
  // A7-b instant-only rule and must not gain an invented speed label.
  it("SEPA's labels are exactly low-fee, on every captured list", () => {
    for (const list of ALL_METHOD_LISTS) {
      const sepa = list.find((method) => method.paymentMethod === SEPA);
      expect(sepa?.labels).toEqual(["low-fee"]);
    }
  });

  it("SEPA's own minimum is EUR 200, well above a typical order", () => {
    const sepa = MOCK_PAYBIS_CAPTURE_METHODS_USDC_BASE.find(
      (method) => method.paymentMethod === SEPA,
    );
    expect(sepa?.minAmount).toEqual({ amount: "200.00", currencyCode: "EUR" });
  });

  // @rule the SEPA per-order USDC floor (~231 USDC) is why every quote up to 205 USDC refuses it, and
  // 255 USDC is the first captured amount that clears it.
  it("SEPA is refused on every quote below 255 USDC and clears at 255", () => {
    for (const quote of [MOCK_PAYBIS_CAPTURE_QUOTE_105USDC, MOCK_PAYBIS_CAPTURE_QUOTE_205USDC]) {
      expect(
        quote.responseBody.paymentMethodErrors?.some((entry) => entry.paymentMethod === SEPA),
      ).toBe(true);
    }
    expect(
      MOCK_PAYBIS_CAPTURE_QUOTE_255USDC.responseBody.paymentMethodErrors?.some(
        (entry) => entry.paymentMethod === SEPA,
      ),
    ).not.toBe(true);
  });
});

describe("paybisCapture: case 3, the vendor minimum moves", () => {
  // @rule three distinct minimum-amount observations for the SAME card-family methods, kept as the
  // literal strings Paybis sent: 10.002, 10.002, then 10.003001, never averaged into one constant.
  it("reads 10.002 on the 9 USDC and 5 USDC listing quotes", () => {
    for (const quote of [MOCK_PAYBIS_CAPTURE_QUOTE_9USDC, MOCK_PAYBIS_CAPTURE_QUOTE_5USDC]) {
      const error = quote.responseBody.paymentMethodErrors?.find(
        (entry) => entry.paymentMethod === CARD,
      );
      expect(error?.error.message).toBe("You have to buy or sell at least 10.002 USDC per order");
    }
  });

  it("moves to 10.003001 on every 10 USDC quote taken a minute or more later", () => {
    for (const quote of [
      MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_ALL,
      MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_CARD_A,
      MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_CARD_B,
    ]) {
      const error = quote.responseBody.paymentMethodErrors?.find(
        (entry) => entry.paymentMethod === CARD,
      );
      expect(error?.error.message).toBe(
        "You have to buy or sell at least 10.003001 USDC per order",
      );
    }
  });

  it("reads 10.002 again on the 1 USDC quote taken roughly half an hour later", () => {
    const error = MOCK_PAYBIS_CAPTURE_QUOTE_1USDC_CARD.responseBody.paymentMethodErrors?.find(
      (entry) => entry.paymentMethod === CARD,
    );
    expect(error?.error.message).toBe("You have to buy or sell at least 10.002 USDC per order");
  });
});

describe("paybisCapture: case 4, the service fee is near-fixed below ~40 USDC", () => {
  const cardServiceFeeEur = (
    quote: (typeof MOCK_PAYBIS_CAPTURE_QUOTES)[number],
  ): number | undefined => {
    const method = quote.responseBody.paymentMethods.find((entry) => entry.id === CARD);
    return method ? Number(method.fees.serviceFee.amount) : undefined;
  };

  // @rule at 1, 5, 9, 10 and 11 USDC the card's service fee stays within a EUR 1.86-1.88 band: near
  // fixed, not proportional, at low order sizes.
  it("stays within EUR 1.86-1.88 for 1, 5, 9, 10 and 11 USDC", () => {
    const lowAmountQuotes = [
      MOCK_PAYBIS_CAPTURE_QUOTE_1USDC_CARD,
      MOCK_PAYBIS_CAPTURE_QUOTE_5USDC,
      MOCK_PAYBIS_CAPTURE_QUOTE_9USDC,
      MOCK_PAYBIS_CAPTURE_QUOTE_10USDC_ALL,
      MOCK_PAYBIS_CAPTURE_QUOTE_11USDC_CARD_B,
    ];
    for (const quote of lowAmountQuotes) {
      const fee = cardServiceFeeEur(quote);
      expect(fee).toBeGreaterThanOrEqual(1.86);
      expect(fee).toBeLessThanOrEqual(1.88);
    }
  });

  // @rule above ~40 USDC the fee scales with the order (roughly 4.4% of amountFrom), clearly out of the
  // near-fixed band the low-amount quotes sit in.
  it("scales well above the near-fixed band for 100, 105, 205 and 255 USDC", () => {
    const higherAmountQuotes = [
      MOCK_PAYBIS_CAPTURE_QUOTE_100USDC,
      MOCK_PAYBIS_CAPTURE_QUOTE_105USDC,
      MOCK_PAYBIS_CAPTURE_QUOTE_205USDC,
      MOCK_PAYBIS_CAPTURE_QUOTE_255USDC,
    ];
    for (const quote of higherAmountQuotes) {
      expect(cardServiceFeeEur(quote)).toBeGreaterThan(3.5);
    }
  });
});

describe("paybisCapture: redaction contract (CR-CORE-027)", () => {
  const RAW_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it("no quote id is a raw UUID; every one is a self-labelled mock- token", () => {
    for (const record of MOCK_PAYBIS_CAPTURE_QUOTES) {
      expect(record.responseBody.id).toMatch(/^mock-poo1598-/);
      expect(RAW_UUID.test(record.responseBody.id)).toBe(false);
    }
  });

  /**
   * Asserted by SHAPE, never against the real value. Writing the captured `requestId` here as a
   * "must not equal" literal would publish, in this repo's public mirror, the exact identifier
   * `CR-CORE-027` requires to be synthetic before a capture is committed. A negative assertion is
   * still a disclosure.
   */
  it("the minted requestId is a self-labelled mock- token", () => {
    const id = MOCK_PAYBIS_CAPTURE_REQUEST_201.responseBody.requestId;
    expect(id).toMatch(/^mock-poo1598-/);
    // A raw Paybis id is a bare UUID; a mock token can never be mistaken for one.
    expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("the wallet is valid-format (0x + 40 hex) and carries no boundary-redaction placeholder", () => {
    expect(MOCK_PAYBIS_CAPTURE_WALLET).toMatch(/^0x[0-9a-f]{40}$/);
    expect(MOCK_PAYBIS_CAPTURE_REQUEST_422.requestBody.cryptoWalletAddress.address).toBe(
      MOCK_PAYBIS_CAPTURE_WALLET,
    );
    expect(MOCK_PAYBIS_CAPTURE_REQUEST_201.requestBody.cryptoWalletAddress.address).toBe(
      MOCK_PAYBIS_CAPTURE_WALLET,
    );
  });

  it("the untouched boundary-redaction markers survive verbatim (they are not this module's job)", () => {
    for (const request of [MOCK_PAYBIS_CAPTURE_REQUEST_422, MOCK_PAYBIS_CAPTURE_REQUEST_201]) {
      expect(request.requestBody.userIp).toBe("[redacted:user-ip]");
      expect(request.requestBody.email).toBe("[redacted:email]");
      expect(request.requestBody.partnerUserId).toBe("[redacted:partner-user-id]");
    }
  });

  it("findPaybisCaptureQuoteById resolves every exported quote id and nothing else", () => {
    for (const record of MOCK_PAYBIS_CAPTURE_QUOTES) {
      expect(findPaybisCaptureQuoteById(record.responseBody.id)).toBe(record);
    }
    expect(findPaybisCaptureQuoteById("not-a-real-id")).toBeUndefined();
  });
});

describe("paybisCapture: the corrupted exchange rate is never copied verbatim (POO-1668)", () => {
  const CORRUPTED = "1.[redacted:card-number]";
  const SUBSTITUTED_INTACT_RATE = "1.1572441341898636";

  it("no quote record carries the corrupted rate string anywhere", () => {
    for (const record of MOCK_PAYBIS_CAPTURE_QUOTES) {
      expect(record.responseBody.exchangeRate.rate).not.toBe(CORRUPTED);
      expect(JSON.stringify(record.responseBody)).not.toContain("card-number");
    }
  });

  // @rule the four records whose rate was corrupted by redaction carry the nearest-in-time INTACT rate
  // this same capture observed, not a fabricated value and not left corrupted.
  it("the four affected records carry the substituted intact rate", () => {
    for (const quote of [
      MOCK_PAYBIS_CAPTURE_QUOTE_100USDC,
      MOCK_PAYBIS_CAPTURE_QUOTE_9USDC,
      MOCK_PAYBIS_CAPTURE_QUOTE_5USDC,
      MOCK_PAYBIS_CAPTURE_QUOTE_255USDC,
    ]) {
      expect(quote.responseBody.exchangeRate.rate).toBe(SUBSTITUTED_INTACT_RATE);
    }
  });

  it("the other quote records keep their own, genuinely different, intact rates", () => {
    const rates = new Set(
      MOCK_PAYBIS_CAPTURE_QUOTES.map((record) => record.responseBody.exchangeRate.rate),
    );
    // at least the substituted rate plus two other genuinely distinct intact rates from the capture
    expect(rates.size).toBeGreaterThanOrEqual(3);
    expect(rates.has("1.1573782452263905")).toBe(true);
    expect(rates.has("1.1575123873503157")).toBe(true);
  });
});
