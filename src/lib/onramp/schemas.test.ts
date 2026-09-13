/**
 * @id PP-CORE-LIB-063 (POO-1132, POO-1573, POO-1599, POO-1603)
 * @name on-ramp schema tests
 * @implements-rules-version v6 (POO-1603 rules v1) · v5 (POO-1599 rules v1) · v4 (POO-1573 rules v2) · v3 (POO-1153 / POO-1129 rules v3) · v2 (POO-1132 rules v2)
 *
 * POO-1603 rules v1 (the payment-methods list carries more than three fields):
 *   [R1] `labels`, `icon` and `maxAmount` are declared and OPTIONAL. Absence never fails the parse.
 *   [R2] A value this app cannot read degrades to absence for that FIELD, never failing the method
 *        and never failing the array.
 *   [R3] `labels` is a plain `string[]`, carried verbatim. No enum, no mapping, no branching.
 *   [R4] `icon` is optional by contract; a blank string is absence.
 *   [R5] `maxAmount` normalizes as `minAmount` does, carrying its own currency (POO-1512).
 *   [R6] `fees`, `id` and `name` stay stripped.
 *   [R7] Additive only: every previously produced field keeps its name and value.
 *
 * Rules under test (POO-1132 rules v2 + the POO-1139 contract):
 *   [R10] the received-fixed quote surfaces `amountFrom` (total fiat charge) as the display figure, and
 *         `amountTo` (crypto received) as a decimal string.
 *   the normalizer decodes the fiat charge to a display-grade USD NUMBER (`chargeUsd`) and keeps the raw
 *         decimal string beside it; crypto stays a string. This is the stated unit convention.
 *   `amountTo` is consumed as authoritative and NEVER asserted equal to what was requested (Paybis
 *         pass-through). A quote whose `amountTo` differs from the request still parses.
 *   the response schema is tolerant of extra backend fields; inputs validate the way IN (`@Min(0.01)`,
 *         a `0x` hex signature) so a bad call fails locally, not as an upstream 400.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeOnRampPaymentMethods,
  normalizeOnRampQuote,
  ON_RAMP_MIN_QUOTE_AMOUNT,
  onRampEthTargetInputSchema,
  onRampPaymentMethodsInputSchema,
  onRampPaymentMethodsResponseSchema,
  onRampQuoteInputSchema,
  onRampQuoteResponseSchema,
  onRampRequestInputSchema,
  onRampRequestResponseSchema,
} from "./schemas";

/** The first element of a non-empty array, guarded against `noUncheckedIndexedAccess`. */
function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error("expected a non-empty array");
  return head;
}

/** A merged-backend `QuoteResponseDto` for a received-fixed USDC-on-Base quote, with extra fields. */
function backendQuote() {
  return {
    id: "quote_123",
    currencyCodeTo: "USDC-BASE",
    currencyCodeFrom: "USD",
    requestedAmountType: "destination",
    requestedAmount: { amount: "100.000000", currencyCode: "USDC-BASE" },
    exchangeRate: { from: "USD", to: "USDC-BASE", rate: "1.0" },
    exchangeRateCryptoToFiat: { from: "USDC-BASE", to: "USD", rate: "1.0" },
    paymentMethods: [
      {
        // POO-1413: the real token, captured from a live `POST /v2/quote` on 2026-08-07. The quote
        // echoes the SAME id the methods list and the quote query use; the previous `"pm_card"` here
        // modelled a separate namespace that does not exist, and `useProvisioningRail` matches on
        // this equality to decide whether a quote was priced at all.
        id: "poolparty-credit-card",
        name: "Credit/Debit Card",
        // amountTo = crypto received; amountFrom = TOTAL fiat charge incl. fees ([R10]).
        amountTo: { amount: "100.000000", currencyCode: "USDC-BASE" },
        amountFrom: { amount: "104.53", currencyCode: "USD" },
        amountToEquivalent: { amount: "100.00", currencyCode: "USD" },
        fees: {
          networkFee: { amount: "0.10", currencyCode: "USD" },
          serviceFee: { amount: "2.00", currencyCode: "USD" },
          totalFee: { amount: "4.53", currencyCode: "USD" },
        },
        feesInCrypto: {
          networkFee: { amount: "0.0001", currencyCode: "USDC-BASE" },
          serviceFee: { amount: "0", currencyCode: "USDC-BASE" },
          totalFee: { amount: "0.0001", currencyCode: "USDC-BASE" },
        },
        expiration: "2026-07-30T12:05:00Z",
        expiresAt: "2026-07-30T12:05:00Z",
      },
    ],
  };
}

describe("onRampQuoteResponseSchema (POO-1132)", () => {
  // @rule POO-1132: the response schema tolerates extra backend fields, so a backend addition is
  // not a breaking change for the picker.
  it("validates a real backend quote and tolerates its extra fields", () => {
    expect(onRampQuoteResponseSchema.safeParse(backendQuote()).success).toBe(true);
  });

  // @rule POO-1132: an empty `paymentMethods` is a legal quote (nothing on offer), not drift.
  it("is tolerant of a quote that offers no payment method", () => {
    const raw = backendQuote();
    raw.paymentMethods = [];
    expect(onRampQuoteResponseSchema.parse(raw).paymentMethods).toEqual([]);
  });

  // @rule POO-1139: every wire amount is a decimal string, so a non-decimal one is contract drift.
  it("rejects a non-decimal amount as contract drift (fails loud, not silently wrong)", () => {
    const raw = backendQuote();
    // biome-ignore lint/suspicious/noExplicitAny: forcing a drift shape the type forbids.
    (first(raw.paymentMethods).amountFrom as any).amount = "one hundred";
    expect(onRampQuoteResponseSchema.safeParse(raw).success).toBe(false);
  });
});

describe("normalizeOnRampQuote (POO-1132 [R10])", () => {
  // @rule R10 (POO-1129): the picker displays the QUOTE charge (`amountFrom`, fees included), never
  // the FE-computed shortfall.
  it("decodes the fiat charge (amountFrom) to a display-grade USD number and keeps the raw string", () => {
    const method = first(
      normalizeOnRampQuote(onRampQuoteResponseSchema.parse(backendQuote())).paymentMethods,
    );
    // [R10]: the picker displays this. It is amountFrom, NOT the FE-computed shortfall.
    expect(method.chargeUsd).toBe(104.53);
    expect(typeof method.chargeUsd).toBe("number");
    expect(method.chargeAmount).toBe("104.53");
    expect(method.chargeCurrencyCode).toBe("USD");
  });

  // @rule POO-1132: the unit convention. Fiat decodes to a display USD number, crypto stays an 18dp
  // decimal string (a `number` is not float-safe there).
  it("keeps the crypto received amount as a decimal string, not a number", () => {
    const method = first(
      normalizeOnRampQuote(onRampQuoteResponseSchema.parse(backendQuote())).paymentMethods,
    );
    expect(method.receiveAmount).toBe("100.000000");
    expect(typeof method.receiveAmount).toBe("string");
    expect(method.receiveCurrencyCode).toBe("USDC-BASE");
  });

  // @rule POO-1132: `createOnRampRequestAction` rides on this quote's id, so the normalizer has to
  // carry it (and the pair) through.
  it("surfaces the quote id and currency codes for the request-id follow-up", () => {
    const quote = normalizeOnRampQuote(onRampQuoteResponseSchema.parse(backendQuote()));
    expect(quote.quoteId).toBe("quote_123");
    expect(quote.currencyCodeTo).toBe("USDC-BASE");
    expect(quote.currencyCodeFrom).toBe("USD");
    expect(quote.requestedAmountType).toBe("destination");
  });

  // @rule POO-1139: `amountTo` is Paybis pass-through, consumed as authoritative and never asserted
  // equal to what was requested.
  it("NEVER asserts amountTo equals the requested amount (Paybis pass-through)", () => {
    const raw = backendQuote();
    // Paybis delivered LESS crypto than the 100 requested; this is legal pass-through and must survive.
    first(raw.paymentMethods).amountTo.amount = "99.812345";
    const quote = normalizeOnRampQuote(onRampQuoteResponseSchema.parse(raw));
    expect(first(quote.paymentMethods).receiveAmount).toBe("99.812345");
  });
});

describe("onRampRequestResponseSchema (POO-1132)", () => {
  // @rule POO-1132: the widget opens on `requestId`; `oneTimeToken` is optional upstream.
  it("accepts requestId with an optional oneTimeToken", () => {
    expect(onRampRequestResponseSchema.parse({ requestId: "req_1" })).toEqual({
      requestId: "req_1",
    });
    expect(onRampRequestResponseSchema.parse({ requestId: "req_1", oneTimeToken: "otp" })).toEqual({
      requestId: "req_1",
      oneTimeToken: "otp",
    });
  });

  // @rule POO-1132: with no `requestId` there is nothing to open, so its absence is drift.
  it("rejects a missing requestId", () => {
    expect(onRampRequestResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("onRampQuoteInputSchema (POO-1132)", () => {
  // @rule POO-1139: `direction: "receive"` is received-fixed ("charge whatever N crypto costs").
  // @rule POO-1512 [R1]: USD is NO LONGER the only fiat we quote from, and the schema no longer
  // defaults to it. An omitted `currencyCodeFrom` must survive parsing as `undefined` so the action
  // can tell "the caller did not choose" apart from "the caller chose USD" ([R6] needs that
  // distinction: it is the one caller that genuinely means USD).
  it("accepts a received-fixed quote request and leaves an omitted currencyCodeFrom unset", () => {
    const parsed = onRampQuoteInputSchema.parse({
      currencyCodeTo: "USDC-BASE",
      amount: 100,
      paymentMethod: "credit_card",
      direction: "receive",
    });
    expect(parsed.currencyCodeFrom).toBeUndefined();
    expect(parsed.direction).toBe("receive");
  });

  // @rule POO-1512 [R6]: an explicit currency is preserved verbatim, because the spend-fixed leg
  // depends on it staying USD.
  it("preserves an explicit currencyCodeFrom", () => {
    const parsed = onRampQuoteInputSchema.parse({
      currencyCodeTo: "ETH-BASE",
      amount: 100,
      paymentMethod: "credit_card",
      currencyCodeFrom: "USD",
    });
    expect(parsed.currencyCodeFrom).toBe("USD");
  });

  /**
   * @rule POO-1573 / POO-1588: the floor follows the DIRECTION, because the field changes unit.
   *
   * `amount` is fiat when spend-fixed and CRYPTO when received-fixed, and a received-fixed ETH order
   * is `usdAmount / ethUsd`: a flat 0.01 would refuse every order under `0.01 x ethUsd` ($25 at
   * $2,500/ETH) while the app's own fiat floor is $10. pool-party-api made the same bound
   * direction-aware first (`QuoteAmountFloorConstraint`, merged); this mirrors it, API first.
   */
  it("accepts a received-fixed amount far below the spend-fixed fiat floor", () => {
    const parsed = onRampQuoteInputSchema.parse({
      currencyCodeTo: "ETH-BASE",
      amount: 0.0042,
      paymentMethod: "poolparty-credit-card",
      direction: "receive",
    });
    expect(parsed.amount).toBe(0.0042);
  });

  // @rule POO-1588: "> 0" is the whole receive-direction rule (Paybis enforces its own minimum, so a
  // constant of ours would be a second, weaker copy of theirs). Zero is still refused.
  it("rejects a zero or negative received-fixed amount", () => {
    for (const amount of [0, -1]) {
      expect(
        onRampQuoteInputSchema.safeParse({
          currencyCodeTo: "ETH-BASE",
          amount,
          paymentMethod: "poolparty-credit-card",
          direction: "receive",
        }).success,
      ).toBe(false);
    }
  });

  // @rule POO-1132: inputs validate the way IN (`@Min(0.01)`), so a bad call fails locally rather
  // than as an upstream 400.
  it("rejects an amount below the backend's 0.01 minimum", () => {
    expect(
      onRampQuoteInputSchema.safeParse({
        currencyCodeTo: "USDC-BASE",
        amount: ON_RAMP_MIN_QUOTE_AMOUNT / 2,
        paymentMethod: "credit_card",
      }).success,
    ).toBe(false);
  });

  // @rule POO-1132: same, for the required wire fields.
  it("rejects an empty currencyCodeTo or paymentMethod", () => {
    expect(
      onRampQuoteInputSchema.safeParse({ currencyCodeTo: "", amount: 100, paymentMethod: "card" })
        .success,
    ).toBe(false);
    expect(
      onRampQuoteInputSchema.safeParse({
        currencyCodeTo: "USDC-BASE",
        amount: 100,
        paymentMethod: "",
      }).success,
    ).toBe(false);
  });

  // @rule POO-1139: `direction` is exactly `"spend" | "receive"` (omitted meaning `"spend"`).
  it("rejects a direction outside spend|receive", () => {
    expect(
      onRampQuoteInputSchema.safeParse({
        currencyCodeTo: "USDC-BASE",
        amount: 100,
        paymentMethod: "card",
        direction: "sideways",
      }).success,
    ).toBe(false);
  });
});

/**
 * POO-1599 (rules-v1). Paybis lists `paymentMethod` as OPTIONAL on `POST /v2/quote` and, omitted,
 * returns "Array of quotes calculated for each available payment method" (docs.payb.is, read
 * 2026-08-14). Our own schema made it mandatory, so every quote we ever sent pinned one method and
 * every response came back with exactly one entry: measured 2026-08-14, one method requested, one
 * method priced. The narrow list was our request, not their answer.
 *
 * pool-party-api's `QuoteQueryDto` dropped the same constraint first (deploy order: API before FE).
 */
describe("onRampQuoteInputSchema unpinned listing quote (POO-1599 @rules-v1)", () => {
  it("accepts a quote request with NO paymentMethod, leaving it undefined", () => {
    const parsed = onRampQuoteInputSchema.parse({
      currencyCodeTo: "USDC-BASE",
      amount: 210,
      direction: "receive",
    });
    expect(parsed.paymentMethod).toBeUndefined();
  });

  it("still preserves a pinned paymentMethod (POO-1578's threading is unchanged)", () => {
    const parsed = onRampQuoteInputSchema.parse({
      currencyCodeTo: "USDC-BASE",
      amount: 210,
      paymentMethod: "poolparty-trustly",
      direction: "receive",
    });
    expect(parsed.paymentMethod).toBe("poolparty-trustly");
  });

  // Absent means "price every method". BLANK means the caller built a broken identifier, and
  // promoting that to "every method" would hide the bug and change what the buyer is billed on.
  // (Also asserted above, and pinned here because the two now mean different things.)
  it("still rejects an EMPTY paymentMethod, which is not the same as an absent one", () => {
    expect(
      onRampQuoteInputSchema.safeParse({
        currencyCodeTo: "USDC-BASE",
        amount: 210,
        paymentMethod: "",
      }).success,
    ).toBe(false);
  });

  // The floor is the direction's, not the method's: dropping the pin must not drop the guard.
  it("still applies the spend-fixed fiat floor when no method is pinned", () => {
    expect(
      onRampQuoteInputSchema.safeParse({
        currencyCodeTo: "USDC-BASE",
        amount: ON_RAMP_MIN_QUOTE_AMOUNT / 2,
      }).success,
    ).toBe(false);
  });
});

/**
 * POO-1599: the response of an UNPINNED quote. Two things arrive that a pinned quote never carried:
 * one priced entry per available method, and `paymentMethodErrors`, which is Paybis' own reason a
 * method could not be priced ("List of validation errors returned if quote cannot be calculated for
 * a certain payment method").
 *
 * The errors are surfaced, never branched on: the `code` value set is undocumented, the same caution
 * `labels` already gets. And the field is AUXILIARY, so no shape of it may cost the quote: the
 * charge is the money figure, and blanking it over an explanation would be a strictly worse defect
 * than not having the explanation.
 */
describe("unpinned quote response: every method priced (POO-1599 @rules-v1)", () => {
  /** A live-shaped unpinned quote: two methods priced, a third refused with the vendor's reason. */
  function unpinnedQuote() {
    const base = backendQuote();
    return {
      ...base,
      paymentMethods: [
        first(base.paymentMethods),
        {
          ...first(base.paymentMethods),
          id: "poolparty-trustly",
          name: "Bank Transfer",
          amountFrom: { amount: "101.20", currencyCode: "USD" },
        },
      ],
      paymentMethodErrors: [
        {
          paymentMethod: "poolparty-pix",
          error: { code: "amount_too_low", message: "Minimum is 100 BRL" },
        },
      ],
    };
  }

  it("normalizes EVERY priced method, not just the first", () => {
    const quote = normalizeOnRampQuote(onRampQuoteResponseSchema.parse(unpinnedQuote()));

    expect(quote.paymentMethods.map((method) => [method.id, method.chargeUsd])).toEqual([
      ["poolparty-credit-card", 104.53],
      ["poolparty-trustly", 101.2],
    ]);
  });

  it("carries the vendor's own reason a method could not be priced", () => {
    const quote = normalizeOnRampQuote(onRampQuoteResponseSchema.parse(unpinnedQuote()));

    expect(quote.paymentMethodErrors).toEqual([
      { paymentMethod: "poolparty-pix", code: "amount_too_low", message: "Minimum is 100 BRL" },
    ]);
  });

  // The pinned quote (and the sandbox) never sends the field at all. Absent is BENIGN.
  it("is an empty list when the field is absent, null, or not an array", () => {
    for (const paymentMethodErrors of [undefined, null, "nope", {}]) {
      const raw = { ...unpinnedQuote(), paymentMethodErrors };
      const quote = normalizeOnRampQuote(onRampQuoteResponseSchema.parse(raw));

      expect(quote.paymentMethodErrors).toEqual([]);
      // and the charge survives every one of them
      expect(first(quote.paymentMethods).chargeUsd).toBe(104.53);
    }
  });

  /**
   * The defect this shape is written against: a strict schema on an auxiliary field takes the whole
   * payload down with it (a strict record on a dead field once blanked the entire portfolio).
   * A surprise here costs the ENTRY, never the quote.
   */
  it("drops an unrecognisable error entry without failing the quote", () => {
    const raw = {
      ...unpinnedQuote(),
      paymentMethodErrors: [
        "a bare string",
        { error: { message: "no method named" } },
        { paymentMethod: "poolparty-pix", error: { message: "Minimum is 100 BRL" } },
      ],
    };

    const parsed = onRampQuoteResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);

    const quote = normalizeOnRampQuote(onRampQuoteResponseSchema.parse(raw));
    expect(quote.paymentMethodErrors).toEqual([
      { paymentMethod: "poolparty-pix", message: "Minimum is 100 BRL" },
    ]);
    expect(first(quote.paymentMethods).chargeUsd).toBe(104.53);
  });

  // An entry with no code and no message still names the method that could not be priced, which is
  // the half a caller acts on.
  it("keeps an entry whose error carries neither code nor message", () => {
    const raw = { ...unpinnedQuote(), paymentMethodErrors: [{ paymentMethod: "poolparty-pix" }] };
    const quote = normalizeOnRampQuote(onRampQuoteResponseSchema.parse(raw));

    expect(quote.paymentMethodErrors).toEqual([{ paymentMethod: "poolparty-pix" }]);
  });

  /**
   * pool-party-api's `QuotePaymentMethodErrorDetailDto` (POO-1599, `fix/poo-1599-optional-quote-
   * payment-method`) declares BOTH `code` and `message` `@IsOptional()`, and the endpoint is
   * pass-through, so a refusal that names a code and no message is a shape the wire can send.
   * Pinned here because the normalizer must not require the half the vendor may omit.
   */
  it("keeps an entry whose error carries a code but NO message", () => {
    const raw = {
      ...unpinnedQuote(),
      paymentMethodErrors: [{ paymentMethod: "poolparty-pix", error: { code: "amount_too_low" } }],
    };
    const quote = normalizeOnRampQuote(onRampQuoteResponseSchema.parse(raw));

    expect(quote.paymentMethodErrors).toEqual([
      { paymentMethod: "poolparty-pix", code: "amount_too_low" },
    ]);
  });
});

/**
 * POO-1599: `paymentMethods` gets the SAME per-entry tolerance `paymentMethodErrors` already has.
 *
 * Pinned, that array held exactly one element, so a shape surprise cost one row and there was nothing
 * else in the payload to protect. Unpinned it holds one entry per method the pair offers, and no live
 * unpinned response has ever been observed, so nobody knows what shape the weak entries take. Under
 * `z.array(wireQuotePaymentMethodSchema)` a single vendor entry missing `name`, or carrying a
 * non-decimal amount, failed the WHOLE response and took the methods that priced correctly with it.
 *
 * What stays strict is the pair of assertions that cost no good row: `paymentMethods` must BE an
 * array, and a non-empty array that is entirely unreadable is a failure the caller reports, never an
 * empty success it degrades on silently.
 */
describe("paymentMethods tolerance is per ENTRY (POO-1599 @rules-v1)", () => {
  /** `backendQuote()`'s card, re-idded and re-priced, so each entry is distinguishable by both. */
  function pricedMethod(id: string, name: string, charge: string) {
    return {
      ...first(backendQuote().paymentMethods),
      id,
      name,
      amountFrom: { amount: charge, currencyCode: "USD" },
    };
  }

  it("drops one malformed entry and still publishes the methods that priced", () => {
    const raw = {
      ...backendQuote(),
      paymentMethods: [
        pricedMethod("poolparty-credit-card", "Credit/Debit Card", "104.53"),
        // No `name`: unreadable. Under the old array schema this alone blanked the other two.
        { ...pricedMethod("poolparty-sepa", "SEPA", "101.20"), name: undefined },
        pricedMethod("poolparty-trustly", "Bank Transfer", "101.20"),
      ],
    };

    const parsed = onRampQuoteResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);

    const quote = normalizeOnRampQuote(onRampQuoteResponseSchema.parse(raw));
    expect(quote.paymentMethods.map((method) => [method.id, method.chargeUsd])).toEqual([
      ["poolparty-credit-card", 104.53],
      ["poolparty-trustly", 101.2],
    ]);
  });

  /**
   * The guarantee POO-1413 bought: a charge is matched to its method BY ID, never by position. It is
   * what dropping an entry threatens most directly, because dropping shifts every index after it. So
   * the same three methods are normalized in two different orders, one of them missing its middle
   * entry, and each surviving id keeps ITS OWN charge in both.
   */
  it("keeps each charge with its own id when the array order changes", () => {
    const card = pricedMethod("poolparty-credit-card", "Credit/Debit Card", "104.53");
    const sepa = pricedMethod("poolparty-sepa", "SEPA", "99.80");
    const trustly = pricedMethod("poolparty-trustly", "Bank Transfer", "101.20");

    const forwards = normalizeOnRampQuote(
      onRampQuoteResponseSchema.parse({
        ...backendQuote(),
        paymentMethods: [card, sepa, trustly],
      }),
    );
    // Reversed, AND with the (now middle) SEPA entry corrupted, so every index moves.
    const backwards = normalizeOnRampQuote(
      onRampQuoteResponseSchema.parse({
        ...backendQuote(),
        paymentMethods: [
          trustly,
          { ...sepa, amountFrom: { amount: "ninety", currencyCode: "USD" } },
          card,
        ],
      }),
    );

    const chargeById = (
      quote: { paymentMethods: { id: string; chargeUsd: number }[] },
      id: string,
    ) => quote.paymentMethods.find((method) => method.id === id)?.chargeUsd;

    expect(chargeById(forwards, "poolparty-credit-card")).toBe(104.53);
    expect(chargeById(forwards, "poolparty-trustly")).toBe(101.2);
    expect(chargeById(backwards, "poolparty-credit-card")).toBe(104.53);
    expect(chargeById(backwards, "poolparty-trustly")).toBe(101.2);
    // The corrupted entry is gone from the answer, not repriced from a neighbour.
    expect(chargeById(backwards, "poolparty-sepa")).toBeUndefined();
  });

  /**
   * All-bad is NOT an empty success. There is no charge to publish and nothing partial to salvage, so
   * it has to reach the caller as a failed quote: `useBuyRouteQuote` reports every non-ok quote
   * (`onramp.listing_quote_unavailable`) and keeps the neutral caption, whereas a silently empty
   * `paymentMethods` would render the same plausible screen with nothing in Sentry.
   */
  it("fails the quote when EVERY entry is unreadable", () => {
    const raw = {
      ...backendQuote(),
      paymentMethods: [
        { ...pricedMethod("poolparty-sepa", "SEPA", "101.20"), name: undefined },
        { ...pricedMethod("poolparty-pix", "Pix", "0.00"), amountTo: undefined },
      ],
    };

    expect(onRampQuoteResponseSchema.safeParse(raw).success).toBe(false);
  });

  // A quote is still a quote only if it HAS the array. Nothing to publish otherwise, so this is drift
  // that must fail loud rather than normalize to an empty offer.
  it("still rejects a paymentMethods that is not an array at all", () => {
    for (const paymentMethods of [undefined, null, "poolparty-credit-card", {}]) {
      expect(
        onRampQuoteResponseSchema.safeParse({ ...backendQuote(), paymentMethods }).success,
      ).toBe(false);
    }
  });
});

describe("onRampRequestInputSchema (POO-1132)", () => {
  const base = {
    signature: "0xabcdef0123456789",
    message: "Pool Party On-Ramp Verification\nWallet: 0x1\nTimestamp: 2026-07-30T12:00:00.000Z",
    currencyCode: "USDC-BASE",
  };

  // @rule POO-1132: the `0x` hex signature is validated locally, and `locale` defaults so the
  // widget always receives one.
  it("accepts a 0x hex signature and defaults locale to en", () => {
    const parsed = onRampRequestInputSchema.parse(base);
    expect(parsed.locale).toBe("en");
  });

  // @rule POO-1132: a malformed signature fails here, not as an upstream bad-signature 400.
  it("rejects a signature that is not a 0x hex string", () => {
    expect(
      onRampRequestInputSchema.safeParse({ ...base, signature: "not-a-signature" }).success,
    ).toBe(false);
    expect(onRampRequestInputSchema.safeParse({ ...base, signature: "0xZZZ" }).success).toBe(false);
  });

  // @rule POO-1132: same, for the message the backend replay-checks and the pair it buys.
  it("rejects an empty message or currencyCode", () => {
    expect(onRampRequestInputSchema.safeParse({ ...base, message: "" }).success).toBe(false);
    expect(onRampRequestInputSchema.safeParse({ ...base, currencyCode: "" }).success).toBe(false);
  });

  // @rule POO-1132: the wallet comes from `getSessionWallet()`, never the caller. The field does
  // not exist on the wire, which is stronger than validating it.
  it("has no recipient/wallet field: identity cannot be supplied by the caller", () => {
    // `.parse` takes `unknown`, so an injected wallet needs no cast: the schema strips it.
    const parsed = onRampRequestInputSchema.parse({ ...base, recipientAddress: "0xattacker" });
    expect(parsed).not.toHaveProperty("recipientAddress");
  });
});

/** A `PaymentMethodsResponseDto[]` for USD -> USDC-BASE, with extra fields the schema must tolerate. */
function backendPaymentMethods() {
  return [
    {
      paymentMethod: "poolparty-credit-card",
      displayName: "Credit Card",
      id: "cc_001",
      name: "Visa/Mastercard",
      icon: "https://example.com/cc.png",
      minAmount: { amount: "10.00", currencyCode: "USD" },
      maxAmount: { amount: "10000.00", currencyCode: "USD" },
      fees: { amount: "2.50", isPercent: false },
      labels: ["instant", "popular"],
    },
    {
      paymentMethod: "poolparty-trustly",
      displayName: "Trustly",
      id: "tr_001",
      name: "Trustly",
      icon: "https://example.com/tr.png",
      minAmount: { amount: "30.00", currencyCode: "USD" },
      maxAmount: { amount: "5000.00", currencyCode: "USD" },
      fees: { amount: "1.00", isPercent: true },
      labels: ["bank"],
    },
  ];
}

describe("onRampPaymentMethodsResponseSchema (POO-1153)", () => {
  // @rule POO-1153: a bare array of methods, tolerant of the DTO's extra fields (icon, fees, labels,
  // maxAmount, id, name), so a backend addition is not a breaking change.
  it("validates a real backend payment-methods array and tolerates extra fields", () => {
    expect(onRampPaymentMethodsResponseSchema.safeParse(backendPaymentMethods()).success).toBe(
      true,
    );
  });

  // @rule POO-1153: an empty list is legal (a pair with nothing on offer), not drift.
  it("accepts an empty methods array", () => {
    expect(onRampPaymentMethodsResponseSchema.parse([])).toEqual([]);
  });

  // @rule POO-1153: the fields the picker depends on are required — a method with no identifier or no
  // minimum could not be quoted against or surfaced, so it is drift, not a tolerated omission.
  it("rejects a method missing the identifier or the minimum", () => {
    const [card] = backendPaymentMethods();
    const noId = [{ ...card, paymentMethod: "" }];
    const noMin = backendPaymentMethods().map(({ minAmount: _min, ...rest }) => rest);
    expect(onRampPaymentMethodsResponseSchema.safeParse(noId).success).toBe(false);
    expect(onRampPaymentMethodsResponseSchema.safeParse(noMin).success).toBe(false);
  });
});

describe("normalizeOnRampPaymentMethods (POO-1153)", () => {
  // @rule POO-1153: `minAmount.amount` becomes a display-grade USD number; the identifier and label
  // are carried through verbatim for the quote query and the [R10] label.
  // @rule POO-1603 [R1]/[R5]/[R7]: `labels`, `icon` and `maxAmount` now ride along; every field this
  // normalizer produced BEFORE keeps exactly the value it had, which is what "additive only" means.
  // The input is PARSED first, deliberately: the defect POO-1603 fixes was zod stripping the three
  // fields before the normalizer ever saw them, so feeding a raw literal here would assert nothing
  // about the [R1] claim. Composing schema THEN normalizer is the only assertion that proves the
  // fields survive the parse, and it is the composition the action actually runs.
  it("decodes minAmount to a display-grade USD number and keeps the identifier + label", () => {
    const methods = normalizeOnRampPaymentMethods(
      onRampPaymentMethodsResponseSchema.parse(backendPaymentMethods()),
    );
    expect(methods).toEqual([
      {
        paymentMethod: "poolparty-credit-card",
        displayName: "Credit Card",
        minUsd: 10,
        minCurrencyCode: "USD",
        labels: ["instant", "popular"],
        icon: "https://example.com/cc.png",
        maxUsd: 10000,
        maxCurrencyCode: "USD",
      },
      {
        paymentMethod: "poolparty-trustly",
        displayName: "Trustly",
        minUsd: 30,
        minCurrencyCode: "USD",
        labels: ["bank"],
        icon: "https://example.com/tr.png",
        maxUsd: 5000,
        maxCurrencyCode: "USD",
      },
    ]);
  });
});

describe("normalizeOnRampPaymentMethods labels/icon/maxAmount (POO-1603)", () => {
  /** The card row with the three POO-1603 fields removed, i.e. the minimum a method can carry. */
  function bareCard() {
    const {
      labels: _labels,
      icon: _icon,
      maxAmount: _maxAmount,
      ...rest
    } = first(backendPaymentMethods());
    return rest;
  }

  // @rule POO-1603 [R1]: absence must never fail the parse. A method with no `labels`, no `icon` and
  // no `maxAmount` is a normal method, not drift: a method without a ceiling exists, and `icon` is
  // nullable by contract. The old "declare only what we consume" posture protected exactly this, and
  // declaring the three fields must not cost it.
  it("normalizes a method carrying no labels, no icon and no maxAmount", () => {
    const parsed = onRampPaymentMethodsResponseSchema.safeParse([bareCard()]);
    expect(parsed.success).toBe(true);

    const method = first(normalizeOnRampPaymentMethods([bareCard()]));
    expect(method.paymentMethod).toBe("poolparty-credit-card");
    expect(method.minUsd).toBe(10);
    expect(method).not.toHaveProperty("labels");
    expect(method).not.toHaveProperty("icon");
    expect(method).not.toHaveProperty("maxUsd");
    expect(method).not.toHaveProperty("maxCurrencyCode");
  });

  // @rule POO-1603 [R1]: an explicit `null` is the same answer as an absent key. `icon` is nullable by
  // CONTRACT, so a null must decode to absence rather than to a null a consumer could render.
  it("treats an explicit null labels/icon/maxAmount as absence", () => {
    const method = first(
      normalizeOnRampPaymentMethods([{ ...bareCard(), labels: null, icon: null, maxAmount: null }]),
    );
    expect(method).not.toHaveProperty("labels");
    expect(method).not.toHaveProperty("icon");
    expect(method).not.toHaveProperty("maxUsd");
  });

  // @rule POO-1603 [R3]: `labels` has NO documented value set; only "high-approval-rate" and "instant"
  // have ever been observed. So an unknown string survives to the UI untouched, and nothing in this
  // module maps, filters or branches on a value. POO-1606 (may provisioning filter on "instant"?) is
  // an OPEN decision and this lane must not pre-empt it.
  it("carries an undocumented label string through verbatim", () => {
    const method = first(
      normalizeOnRampPaymentMethods([
        { ...bareCard(), labels: ["high-approval-rate", "a-label-nobody-has-documented"] },
      ]),
    );
    expect(method.labels).toEqual(["high-approval-rate", "a-label-nobody-has-documented"]);
  });

  // @rule POO-1603 [R5]: the ceiling normalizes exactly as the floor does, and it carries its OWN
  // currency. Since POO-1512 the list is fetched for the BUYER's currency, so a cap is not necessarily
  // dollars: the brief's own case is a Brazilian whose PIX caps around R$ 3,000 while a card does not.
  it("decodes maxAmount to a display-grade number in its own currency", () => {
    const method = first(
      normalizeOnRampPaymentMethods([
        {
          ...bareCard(),
          minAmount: { amount: "20.00", currencyCode: "BRL" },
          maxAmount: { amount: "3000.00", currencyCode: "BRL" },
        },
      ]),
    );
    expect(method.maxUsd).toBe(3000);
    expect(method.maxCurrencyCode).toBe("BRL");
  });

  // @rule POO-1603 [R2]: a value this app cannot READ degrades to absence for that FIELD. It must not
  // cost the method (its identifier and floor still quote) and it must not cost the ARRAY, which is
  // the failure that once blanked a whole dashboard over one strict schema on one field.
  it("drops an unreadable labels/icon/maxAmount without failing the method or the list", () => {
    const wire = [
      { ...bareCard(), labels: "instant", icon: 42, maxAmount: { amount: "not-a-number" } },
      { ...first(backendPaymentMethods()), paymentMethod: "poolparty-sepa" },
    ];
    expect(onRampPaymentMethodsResponseSchema.safeParse(wire).success).toBe(true);

    const methods = normalizeOnRampPaymentMethods(wire);
    expect(methods).toHaveLength(2);
    const [broken, healthy] = [first(methods), methods[1]];
    expect(broken.paymentMethod).toBe("poolparty-credit-card");
    expect(broken.minUsd).toBe(10);
    expect(broken).not.toHaveProperty("labels");
    expect(broken).not.toHaveProperty("icon");
    expect(broken).not.toHaveProperty("maxUsd");
    expect(healthy?.labels).toEqual(["instant", "popular"]);
  });

  // @rule POO-1603 [R4]: a BLANK icon is absence, not a URL. Declaring the type as possibly-absent is
  // pointless if a "" reaches a consumer that would put it in an `img` src.
  it("treats a blank icon as absence", () => {
    const method = first(normalizeOnRampPaymentMethods([{ ...bareCard(), icon: "" }]));
    expect(method).not.toHaveProperty("icon");
  });

  // @rule POO-1603 [R4]: the icon is documented to a consumer as a URL, so only an ABSOLUTE https one
  // decodes. This is vendor-controlled text: `.min(1)` would have admitted `javascript:`, a `data:`
  // payload, a protocol-relative `//host`, plain `http:` and a relative path, and handed each onward
  // under that promise. zod's `.url()` would not have helped (it delegates to `new URL()`, which
  // accepts `javascript:`) and neither would CSP (`img-src` here is the wide `'self' data: blob:
  // https:`). Per [R2] the refusal costs the FIELD only: the method still quotes and the list stands.
  it("drops an icon that is not an absolute https URL, without costing the method or the list", () => {
    const rejected = [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "//evil.tld/px.gif",
      "http://evil.tld/px.gif",
      "/relative/icon.png",
      "https://evil.tld/px .gif",
    ];
    const wire = [
      ...rejected.map((icon, index) => ({
        ...bareCard(),
        paymentMethod: `poolparty-method-${index}`,
        icon,
      })),
      { ...bareCard(), icon: "https://icons.paybis.com/cc.png" },
    ];
    expect(onRampPaymentMethodsResponseSchema.safeParse(wire).success).toBe(true);

    const methods = normalizeOnRampPaymentMethods(wire);
    expect(methods).toHaveLength(rejected.length + 1);
    for (const [index] of rejected.entries()) {
      const method = methods[index];
      expect(method).not.toHaveProperty("icon");
      // The method itself is untouched: it still carries the token the quote needs and its floor.
      expect(method?.paymentMethod).toBe(`poolparty-method-${index}`);
      expect(method?.minUsd).toBe(10);
    }
    expect(methods[rejected.length]?.icon).toBe("https://icons.paybis.com/cc.png");
  });

  // @rule POO-1603 [R6]: `fees`, `id` and `name` stay stripped. `fees` is the per-method fee MODEL
  // (a rate or a flat amount), not a charge: the quote's `amountFrom` is the priced total (POO-1599),
  // and POO-1513 S3 deleted our own copy of exactly that model. Two fee sources in one object is how a
  // consumer prints a rate where the charge belongs.
  it("still strips fees, id and name", () => {
    const method = first(normalizeOnRampPaymentMethods(backendPaymentMethods()));
    expect(method).not.toHaveProperty("fees");
    expect(method).not.toHaveProperty("id");
    expect(method).not.toHaveProperty("name");
  });
});

describe("onRampPaymentMethodsInputSchema (POO-1153)", () => {
  // @rule POO-1153: the pair to price; `currencyCodeTo` is required.
  // @rule POO-1512 [R1]: `currencyCodeFrom` no longer defaults to USD. This is the call whose currency
  // decides WHICH PAYMENT METHODS the buyer is offered, so a silent USD default is what kept SEPA away
  // from Europeans and Pix away from Brazilians.
  it("requires currencyCodeTo and leaves an omitted currencyCodeFrom unset", () => {
    expect(onRampPaymentMethodsInputSchema.parse({ currencyCodeTo: "USDC-BASE" })).toEqual({
      currencyCodeTo: "USDC-BASE",
    });
    expect(onRampPaymentMethodsInputSchema.safeParse({ currencyCodeFrom: "USD" }).success).toBe(
      false,
    );
  });
});

describe("onRampEthTargetInputSchema (POO-1573)", () => {
  // @rule POO-1573 [R1]: the recipe crosses the `"use server"` boundary, so it validates there like
  // every other action input: two non-negative decimal STRINGS, the convention `fiatAmount` already
  // carries (no float).
  it("accepts a decimal-string recipe", () => {
    expect(onRampEthTargetInputSchema.parse({ gasFloorEth: "0.001", fundingUsd: "50.00" })).toEqual(
      {
        gasFloorEth: "0.001",
        fundingUsd: "50.00",
      },
    );
  });

  // @rule POO-1573 [R2]: a number, a negative, or an empty string is not a decimal string. Refusing
  // here is what keeps a malformed recipe from reaching the ETH arithmetic on a money path.
  it("rejects anything that is not a non-negative decimal string", () => {
    for (const recipe of [
      { gasFloorEth: 0.001, fundingUsd: "50.00" },
      { gasFloorEth: "-0.001", fundingUsd: "50.00" },
      { gasFloorEth: "0.001", fundingUsd: "" },
      { gasFloorEth: "0.001" },
    ]) {
      expect(onRampEthTargetInputSchema.safeParse(recipe).success).toBe(false);
    }
  });
});
