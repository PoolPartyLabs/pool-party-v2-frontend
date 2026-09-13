/**
 * @id PP-CORE-LIB-063 (POO-1132, POO-1153, POO-1573, POO-1599, POO-1603)
 * @name on-ramp quote + request-id + payment-methods schemas
 * @implements-rules-version v6 (POO-1603 rules v1) · v5 (POO-1599 rules v1) · v4 (POO-1573 rules v2) · v3 (POO-1153 / POO-1129 rules v3) · v2 (POO-1132 rules v2)
 *
 * The wire contract for the Paybis fiat on-ramp, one side of the `src/lib/onramp/` boundary. Pure
 * (zod only): validated on the way IN so a malformed action call fails here with a reason rather than
 * as a puzzling upstream 400, and on the way OUT so contract drift with pool-party-api surfaces as a
 * typed parse error instead of a silently-wrong figure. Client-importable: no `server-only`, no viem,
 * no I/O (`serverBoundary.test.ts` enforces it), so the sign-and-continue client can share these
 * types without pulling the transport into a bundle.
 *
 * ## The unit convention this decodes to (POO-1132 correction)
 *
 * Three money units coexist in this app: integer micro-dollars (`fundingSelection.ts`, for summing
 * many sources without float drift), `Decimal` (`depositQuote.ts`, for fee MATH), and display-grade
 * `number` (`provisioning/types.ts`, what `formatUsd` renders). This schema decodes the **fiat charge
 * to a display-grade `number` in whole USD units** ({@link OnRampQuotePaymentMethod.chargeUsd}), so
 * POO-1133 drops it into `formatUsd()` where the picker renders `route.shortfallUsd` today
 * (`FundingRoutePicker.tsx:137,141`) with no conversion. That is the right unit because the figure is
 * DISPLAYED, not summed (micro-dollars is an accumulation unit) and not arithmetic'd (Decimal is for
 * the fee solve pool-party-api already did); a fiat charge is cents-precision and therefore float-safe
 * (number-formatting skill §3). The authoritative decimal string is kept beside it
 * ({@link OnRampQuotePaymentMethod.chargeAmount}) so a base-unit consumer never has to re-parse a
 * display float.
 *
 * Crypto amounts stay decimal STRINGS ({@link OnRampQuotePaymentMethod.receiveAmount}): a token can
 * carry up to 18 decimals, which is not float-safe, and per [R4] / the epic's "balance-delta is truth"
 * rule the authoritative received amount is the observed on-chain wallet delta, never this figure. So
 * this is display/reference only and must not be coerced to a number.
 *
 * ## `amountTo` is Paybis pass-through, never asserted (POO-1139 caveat)
 *
 * `data.paymentMethods[].amountTo` is the crypto the user receives and `data.paymentMethods[].amountFrom`
 * is the TOTAL fiat charge including fees ([R10]). Paybis' docs say `amountTo` equals the requested
 * received amount, but that is THEIR pass-through behaviour and code cannot enforce it, so this schema
 * consumes `amountTo` as authoritative and NEVER asserts it equals what was requested. There is no such
 * comparison anywhere in this module by design.
 *
 * PP-NOTE: `src/features/deposit/lib/depositQuote.ts` is a SECOND, hand-rolled Paybis fee model still
 * shipping (its `computeDepositQuote` solves the received-fixed fee itself). This schema does NOT compute
 * fees — it consumes the charge pool-party-api already priced — so the two must never both drive a shown
 * figure. POO-1137 removes `depositQuote.ts` once the quote action is wired; the reference is here so a
 * reader sees the overlap rather than discovering it as two different "you pay" numbers.
 *
 * PP-INTEGRATION-POINT: shapes for pool-party-api `POST /api/v1/on-ramp/quote` +
 * `POST /api/v1/on-ramp/request-id` (Paybis behind them). Contract read from the merged POO-1139
 * backend (`on-ramp/dto/*`).
 */
import { z } from "zod";

/**
 * Which side of the trade `amount` fixes, matching the merged backend `QuoteDirection`
 * (`common/paybis/types.ts`). `"spend"` (default) fixes the fiat paid; `"receive"` (received-fixed)
 * fixes the crypto delivered and adds fees on top. The provisioning picker quotes `"receive"`: it
 * knows how much USDC has to LAND, and asks Paybis what that costs ([R10]).
 */
export const ON_RAMP_QUOTE_DIRECTIONS = ["spend", "receive"] as const;
export type OnRampQuoteDirection = (typeof ON_RAMP_QUOTE_DIRECTIONS)[number];

/**
 * POO-1573 [R5] (rules v2): the code the mint REFUSES an unpriceable `ETH-BASE` leg with.
 *
 * Not a wire value: it is our own `TxError.code`, thrown by `useProvisioningRail.mintOnRampRequest`
 * and read by both hosts, so `/deposit` can return the buyer to review with a reason and the in-flow
 * panel can name the same cause. It lives in this module because this module is the on-ramp's PURE
 * client-safe half (one of the two `CLIENT_ENTRIES` in `serverBoundary.test.ts`), so all three
 * surfaces can agree on one string instead of the three copies `ONRAMP_SETTLING_CODE` grew.
 *
 * Its own code, never a generic failure: the only useful thing to say at this point is "we could not
 * price ETH just now", and no shared failure copy says that.
 */
export const ONRAMP_ETH_UNPRICED_CODE = "ONRAMP_ETH_UNPRICED";

/**
 * POO-1136, moved here by POO-1808: the code that routes a buy to the `settling` screen.
 *
 * The purchase was paid and has not landed. Never a failure and never a cancellation (ADR-0006): the
 * money may be in flight, so the panel shows the settling copy, offers no retry that would charge a
 * second card, and the observation window keeps watching through the intent record.
 *
 * It lives beside {@link ONRAMP_ETH_UNPRICED_CODE} for the reason that comment already gives: this
 * module is the on-ramp's pure client-safe half, so the surfaces that must agree on the string can
 * import it instead of growing the copies the comment names. Two now do: the Paybis rail throws it
 * from `ProvisioningPanel`'s own `onRampTerminalError`, and the Privy rail's buy step rejects with
 * it at the visible ceiling so the SAME settling screen takes over on both rails.
 */
export const ONRAMP_SETTLING_CODE = "ONRAMP_SETTLING";

/**
 * The backend's fiat floor on a SPEND-fixed quote amount. Below it the upstream 400s, so refuse
 * locally. Mirrors `QUOTE_MIN_FIAT_AMOUNT` in pool-party-api's `QuoteQueryDto`.
 *
 * POO-1573 / POO-1588: it applies to the `spend` direction ONLY, because that is the direction where
 * `amount` is fiat. In the `receive` direction `amount` is the CRYPTO being bought, and a
 * received-fixed ETH order is `usdAmount / ethUsd`: a flat 0.01 would refuse the entire band from the
 * app's own $10 floor up to `0.01 x ethUsd` ($25 at $2,500/ETH, and widening as ETH rises), which is
 * exactly where the typical `/deposit` amount and provisioning shortfall sit. The api made the bound
 * direction-aware first (`QuoteAmountFloorConstraint`); this mirrors it, and only a positive number is
 * required on the receive side because Paybis enforces its own minimum and a constant of ours would be
 * a second, weaker copy of theirs.
 */
export const ON_RAMP_MIN_QUOTE_AMOUNT = 0.01;

/** A non-negative decimal string, e.g. "100.00" or "0.032451". The wire form of every Paybis amount. */
const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "expected a non-negative decimal string");

/** A `{ amount, currencyCode }` money object as pool-party-api returns it (both decimal-string typed). */
const wireAmountSchema = z.object({
  amount: decimalString,
  currencyCode: z.string().min(1),
});

/**
 * One payment method's leg of a quote, as the backend `QuotePaymentMethodsResponseDto` returns it.
 * Only the fields this app consumes are declared; zod strips the rest (`fees`, `expiration`,
 * `exchangeRate`, …), so a backend that adds a field does not fail the parse.
 *
 * POO-1599: this is applied one ENTRY at a time (in {@link normalizeQuotePaymentMethods}), not as the
 * element type of the array. See {@link wireQuotePaymentMethodsSchema} for why.
 */
const wireQuotePaymentMethodSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** The crypto received. Consumed as authoritative; never compared to the requested amount. */
  amountTo: wireAmountSchema,
  /** The TOTAL fiat charge incl. fees. The [R10] figure the picker displays. */
  amountFrom: wireAmountSchema,
});

/**
 * `paymentMethods`, asserted as an ARRAY and tolerated per ENTRY (POO-1599).
 *
 * Pinned, this array held exactly one element, so a shape surprise cost one row and there was nothing
 * else in the payload to protect. Unpinned it holds one entry PER METHOD Paybis offers on the pair,
 * and no live unpinned response has ever been observed, so nobody knows what shape the weak entries
 * take. Declaring the array as `z.array(wireQuotePaymentMethodSchema)` therefore meant one vendor
 * entry missing `name`, or carrying an amount that is not a decimal string, would fail
 * {@link onRampQuoteResponseSchema} and take down the methods that priced CORRECTLY with it. That is
 * the strict-schema-on-one-field failure that once blanked a whole dashboard, and it is the same
 * reasoning {@link normalizeQuoteMethodErrors} already applies one field below.
 *
 * So the entries decode as `unknown` here and are shaped one at a time, dropping what cannot be read.
 * Two assertions survive, because neither costs a good row:
 *
 *   1. `paymentMethods` must BE an array. A response without one is not a quote, and there is nothing
 *      to publish from it.
 *   2. A NON-EMPTY array whose entries are ALL unreadable fails. That is not "some methods are
 *      unavailable", it is a payload this app can price nothing from, and the caller must get a
 *      failure it REPORTS (`useBuyRouteQuote` reports every non-ok quote) rather than an empty
 *      success it silently degrades on. An array that is genuinely EMPTY stays legal: Paybis offering
 *      nothing on a pair is a real answer.
 *
 * A refinement, deliberately, not a `.transform`: it leaves input === output, which is what keeps
 * {@link onRampQuoteResponseSchema} assignable to `apiFetch`'s `ZodType<T>` param.
 */
const wireQuotePaymentMethodsSchema = z.array(z.unknown()).superRefine((entries, ctx) => {
  if (entries.length === 0) return;
  // `some` stops at the first readable entry, so the healthy case parses exactly one of them here.
  if (entries.some((entry) => wireQuotePaymentMethodSchema.safeParse(entry).success)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "no payment method in this quote could be read",
  });
});

/**
 * The raw `QuoteResponseDto` shape, narrowed to the fields consumed. Tolerant of extra keys. This is
 * the schema `apiFetch` validates the response against; {@link normalizeOnRampQuote} turns it into the
 * {@link OnRampQuote} callers consume. It is a plain object schema (input === output) rather than a
 * `.transform`, so it satisfies `apiFetch`'s `ZodType<T>` param — a transform schema's input type
 * differs from its output and would not.
 */
export const onRampQuoteResponseSchema = z.object({
  id: z.string().min(1),
  currencyCodeTo: z.string().min(1),
  currencyCodeFrom: z.string().min(1),
  /** Paybis pass-through label ("source"/"destination"); surfaced verbatim, never branched on. */
  requestedAmountType: z.string(),
  /**
   * POO-1599: an ARRAY is required, its ENTRIES are tolerated. One method the app cannot read must
   * not blank the ones it priced correctly. Shaped in {@link normalizeQuotePaymentMethods}; the two
   * cases that still fail the quote are documented on {@link wireQuotePaymentMethodsSchema}.
   */
  paymentMethods: wireQuotePaymentMethodsSchema,
  /**
   * POO-1599: why a method could NOT be priced, in Paybis' own words ("List of validation errors
   * returned if quote cannot be calculated for a certain payment method"). Only an UNPINNED quote
   * can carry it, so it is absent on every quote this app sent before POO-1599.
   *
   * Deliberately `unknown` HERE and shaped in {@link normalizeQuoteMethodErrors} instead. This is an
   * AUXILIARY explanation sitting in the same payload as the charge, and a strict schema on it would
   * take the charge down with it on any shape surprise: the exact failure mode that once blanked a
   * whole dashboard over a strict record on a dead field. A surprise must cost the entry, never the
   * quote, so the tolerance lives one layer in, per entry.
   */
  paymentMethodErrors: z.unknown().optional(),
});
/** The validated raw quote as pool-party-api returns it, before normalization. */
export type OnRampQuoteResponse = z.infer<typeof onRampQuoteResponseSchema>;

/** One payment method's figures, normalized to the units POO-1133 consumes directly. */
export interface OnRampQuotePaymentMethod {
  /**
   * Paybis payment-method id. This is the SAME token the payment-methods list calls `paymentMethod`
   * and the same one the quote query takes, e.g. `"poolparty-credit-card"`, NOT a separate internal
   * id. Captured live from `POST /v2/quote` on 2026-08-07 (POO-1413); the previous `"pm_001"` example
   * here was invented and it seeded three fixtures that modelled a namespace Paybis does not use.
   */
  id: string;
  /** Human name (e.g. "Credit/Debit Card"). */
  name: string;
  /** [R10] The total fiat charge incl. fees, as a display-grade USD number for `formatUsd`. */
  chargeUsd: number;
  /** The same charge, authoritative decimal string (currency in {@link chargeCurrencyCode}). */
  chargeAmount: string;
  /** Fiat currency of the charge (e.g. "USD"). */
  chargeCurrencyCode: string;
  /** Crypto received, decimal string (NOT a number: up to 18dp; the on-chain delta is truth). */
  receiveAmount: string;
  /** Crypto currency of the received amount (e.g. "USDC-BASE"). */
  receiveCurrencyCode: string;
}

/**
 * POO-1599: one method the quote could NOT price, as Paybis explained it.
 *
 * The vendor's own answer to "why is this method not on offer", which POO-1576 Q2 otherwise infers
 * by comparing a method's `minAmount` against a charge. Prefer this: arithmetic on two figures from
 * two calls is a guess, and this is the party that actually refused.
 */
export interface OnRampQuoteMethodError {
  /** The method that could not be priced. The SAME token as {@link OnRampPaymentMethod.paymentMethod}. */
  paymentMethod: string;
  /**
   * Paybis' machine code, when it sent one. The value set is UNDOCUMENTED, so this is surfaced and
   * never branched on, the same caution `labels` gets. A caller may show or log it; a caller may not
   * make a product decision by comparing it to a literal.
   */
  code?: string;
  /** Paybis' own message. Vendor text in one language: never rendered as product copy. */
  message?: string;
}

/** A normalized on-ramp quote: the id to carry into `request-id`, plus per-method figures. */
export interface OnRampQuote {
  /** Paybis quote id, passed to {@link createOnRampRequestAction} as `quoteId`. */
  quoteId: string;
  /** Fiat currency quoted (e.g. "USD"). */
  currencyCodeFrom: string;
  /** Crypto currency quoted (e.g. "USDC-BASE"). */
  currencyCodeTo: string;
  /** Paybis' echo of which side was fixed; surfaced verbatim, never asserted. */
  requestedAmountType: string;
  /**
   * One entry per payment method the quote covers. May be empty when Paybis offers none.
   *
   * POO-1599: a quote sent WITHOUT a pinned method carries one entry per method available for the
   * pair, so this is a list to compare, not a single answer wrapped in an array. A quote sent WITH
   * one still carries exactly that one.
   */
  paymentMethods: OnRampQuotePaymentMethod[];
  /**
   * POO-1599: the methods Paybis refused to price, with its reason. Always an ARRAY: empty when the
   * field is absent (every pinned quote), null, or a shape this app does not recognise. An empty
   * list therefore means "nothing to report", never "we could not read the answer".
   */
  paymentMethodErrors: OnRampQuoteMethodError[];
}

/**
 * The tolerant per-ENTRY shape of `paymentMethodErrors`. Every leaf is nullish-tolerant because none
 * of it is load-bearing: `paymentMethod` is the only field a caller can act on, and an entry without
 * it names nothing and is dropped.
 */
const wireQuoteMethodErrorSchema = z.object({
  paymentMethod: z.string().min(1),
  error: z.object({ code: z.string().nullish(), message: z.string().nullish() }).nullish(),
});

/**
 * Shape `paymentMethodErrors` defensively (POO-1599). Anything that is not an array of recognisable
 * entries yields `[]`, and one bad entry costs only itself.
 *
 * The tolerance is the point: this field rides in the same payload as the [R10] charge, it has never
 * been seen from the live production account (POO-1426 records there is no usable sandbox for it),
 * and it explains an absence rather than pricing anything. Failing the quote over it would trade the
 * number the user decides on for an explanation of a method they were not going to use.
 */
function normalizeQuoteMethodErrors(raw: unknown): OnRampQuoteMethodError[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = wireQuoteMethodErrorSchema.safeParse(entry);
    if (!parsed.success) return [];
    const { paymentMethod, error } = parsed.data;
    return [
      {
        paymentMethod,
        ...(error?.code == null ? {} : { code: error.code }),
        ...(error?.message == null ? {} : { message: error.message }),
      },
    ];
  });
}

/**
 * Shape `paymentMethods` one ENTRY at a time (POO-1599), dropping what cannot be read, exactly as
 * {@link normalizeQuoteMethodErrors} does one field over. A malformed entry costs its own row and
 * nothing else. An array whose entries are ALL malformed never reaches here: it already failed
 * {@link wireQuotePaymentMethodsSchema}, so an empty result out of a non-empty input is not a state
 * this app can be in.
 *
 * Order is preserved and `id` is carried through verbatim, which is what keeps the by-ID match in
 * `useBuyRouteQuote` and `useProvisioningRail` honest (POO-1413): dropping an entry must never shift
 * one method's charge under another method's label, and nothing here or there reads a position.
 *
 * `decimalString` inside {@link wireQuotePaymentMethodSchema} has already guaranteed `Number(...)` is
 * finite for every entry that survives, so the coercion cannot yield NaN.
 */
function normalizeQuotePaymentMethods(raw: readonly unknown[]): OnRampQuotePaymentMethod[] {
  return raw.flatMap((entry) => {
    const parsed = wireQuotePaymentMethodSchema.safeParse(entry);
    if (!parsed.success) return [];
    const { id, name, amountFrom, amountTo } = parsed.data;
    return [
      {
        id,
        name,
        chargeUsd: Number(amountFrom.amount),
        chargeAmount: amountFrom.amount,
        chargeCurrencyCode: amountFrom.currencyCode,
        receiveAmount: amountTo.amount,
        receiveCurrencyCode: amountTo.currencyCode,
      },
    ];
  });
}

/**
 * Normalize a validated raw quote to {@link OnRampQuote}. This is where the unit convention lives:
 * `amountFrom.amount` becomes the display-grade `chargeUsd` number while its decimal string is retained,
 * and `amountTo` stays a string. Pure, so the mapping is unit-tested without the transport; the action
 * composes `apiFetch` (validate) then this (normalize).
 */
export function normalizeOnRampQuote(raw: OnRampQuoteResponse): OnRampQuote {
  return {
    quoteId: raw.id,
    currencyCodeFrom: raw.currencyCodeFrom,
    currencyCodeTo: raw.currencyCodeTo,
    requestedAmountType: raw.requestedAmountType,
    // POO-1599: per-entry tolerance. One unreadable method costs its own row, never the quote.
    paymentMethods: normalizeQuotePaymentMethods(raw.paymentMethods),
    // POO-1599: absent is the normal case (every pinned quote), so it decodes to an empty list.
    paymentMethodErrors: normalizeQuoteMethodErrors(raw.paymentMethodErrors),
  };
}

/**
 * One payment method for a pair, as `PaymentMethodsResponseDto` returns it (POO-1153, POO-1603). Only
 * the fields this app consumes are declared; zod strips the rest (`fees`, `id`, `name`), so a backend
 * that adds a field does not fail the parse.
 *
 * `paymentMethod` is the identifier the quote query requires (e.g. `"poolparty-credit-card"`), NOT the
 * Paybis `id` / `name`: `on-ramp/quote`'s `QuoteQueryDto.paymentMethod` is exactly this token. `minAmount`
 * is the method's OWN floor, which can exceed the app's `PAYBIS_MIN_USD` — the picker surfaces it so a
 * user is told the real minimum rather than having Paybis reject the order.
 *
 * ## POO-1603: three fields the wire always carried and this schema discarded
 *
 * `labels`, `icon` and `maxAmount` were never missing upstream (`PaymentMethodsResponseDto` declares
 * all three, and `PaybisService.getPaymentMethods` passes the vendor payload through). They were
 * dropped ON ARRIVAL, by not being declared here, exactly as POO-1599's required `paymentMethod` hid
 * that Paybis prices every method. Declaring them is what lets a consumer see them at all.
 *
 * They are declared as `z.unknown()` and shaped one field at a time in
 * {@link normalizeOnRampPaymentMethods}, which is this module's established posture for a field that
 * is AUXILIARY to the load-bearing one (see {@link onRampQuoteResponseSchema.paymentMethodErrors} and
 * {@link wireQuotePaymentMethodsSchema}). Two reasons, and both matter here:
 *
 *   1. A shape surprise must cost that FIELD, never the method and never the array. This array is
 *      parsed strictly per entry, so a strict `z.array(z.string())` on a decorative `labels` would
 *      fail the whole list and leave the buyer with no payment methods at all: a chip taking down
 *      the picker. That is the strict-schema-on-one-field failure that once blanked a dashboard.
 *   2. `input === output` is required: `onRampPaymentMethodsResponseSchema` is handed to `apiFetch`'s
 *      `ZodType<T>` parameter, which a `.transform` or a `.catch` (whose input widens to `unknown`)
 *      would not satisfy. Tolerance therefore lives in the normalizer, not in a wrapper here.
 *
 * `fees` stays stripped ([R6]). It is the fee MODEL (`{ amount, isPercent }`, a rate or a flat
 * component), not a charge, and the charge is already answered authoritatively per method by the
 * quote's `amountFrom` (POO-1599). POO-1513 S3 deleted this app's own copy of exactly such a model
 * because it priced `bank: 0` while the buyer paid ~2.78% on a card; carrying the vendor's copy on a
 * DIFFERENT object from the priced total is how a consumer ends up printing a rate where the charge
 * belongs, and no consumer has asked for it. `id` / `name` stay stripped because neither is the token
 * the quote takes.
 */
const wirePaymentMethodSchema = z.object({
  paymentMethod: z.string().min(1),
  displayName: z.string().min(1),
  minAmount: wireAmountSchema,
  /** POO-1603 [R3]: the vendor's tags. Declared to survive the strip; shaped in the normalizer. */
  labels: z.unknown().optional(),
  /**
   * POO-1603 [R4]: the method's logo URL. Nullable by contract, so never assume a string, and only an
   * absolute `https:` value survives the normalizer ({@link wireIconSchema}).
   */
  icon: z.unknown().optional(),
  /** POO-1603 [R5]: the method's own ceiling, `minAmount`'s shape. A method without one is normal. */
  maxAmount: z.unknown().optional(),
});

/**
 * POO-1603 [R3]: `labels` as a plain array of strings, and deliberately nothing more.
 *
 * The value set is UNDOCUMENTED. Only `high-approval-rate` and `instant` have ever been observed, and
 * POO-1426 records there is no usable sandbox to enumerate the rest from, so any claim about which
 * labels Paybis returns would be invented. Modelling this as an enum would therefore drop every value
 * nobody happened to have seen, and branching on one would make the product behave differently because
 * of a vendor string whose meaning we cannot pin. Whether provisioning may filter on `"instant"` is an
 * OPEN decision (POO-1606), which this module must not pre-empt by encoding an opinion in the type.
 *
 * A blank entry fails the array, so an unreadable `labels` yields no chips for that method rather than
 * a chip with no text. All-or-nothing per METHOD is the accepted cost: the field is decorative, the
 * blast radius is one row's tags, and per-entry filtering would buy a partial list of a field on which
 * nothing may branch.
 */
const wireLabelsSchema = z.array(z.string().min(1));

/**
 * POO-1603 [R4]: the method's logo URL, required to be an ABSOLUTE `https:` URL so that everything
 * else (a `""`, another scheme, a relative or protocol-relative path) decodes to absence.
 *
 * The type must admit absence: the redesign's fallback glyph is a design decision, and a consumer that
 * assumed a URL would render a broken image for a method the vendor sent no icon for. A blank string is
 * the same answer as a missing key, and the only difference is whether it reaches an `img` src.
 *
 * Length-only validation was the trap. This is VENDOR-CONTROLLED text documented to a consumer as "a
 * URL", so a `javascript:` value, a `data:image/svg+xml,...` payload, a protocol-relative
 * `//evil.tld/px.gif` or a plain `http:` link would all satisfy `.min(1)` and be handed onward under
 * that promise. POO-1643 disarmed the trap this paragraph was written about (`PaymentMethodList` now
 * reads `.icon`, through the proxy), and the check is kept because it is still the cheapest place to
 * refuse a value: two things that look like they would cover it do not:
 * zod's `.url()` delegates to `new URL()`, which happily accepts `javascript:`; and this app's
 * `img-src` is the wide `'self' data: blob: https:`, so CSP narrows neither `data:` nor the scheme a
 * non-`img` consumer might follow. Hence an explicit `https://` test here, at the decode.
 *
 * The tradeoff, stated plainly: an icon served over another scheme, or sent as a relative path,
 * decodes to ABSENCE and the consumer renders its fallback glyph. A method loses its logo rather than
 * the app forwarding a value it cannot vouch for. This costs the FIELD only, per [R2]: `icon` is
 * `z.unknown()` on the wire entry, so a rejected icon never fails the method and never fails the list.
 *
 * PP-INTEGRATION-POINT: this URL is a Paybis CDN address and is NEVER handed to a browser as-is.
 * POO-1643 settled the disclosure this note used to defer (`CR-TOK-011`): a consumer renders it
 * through `buildMethodIconProxyUrl` (`methodIconProxy.ts`, `PP-CORE-SEC-003`), which yields a
 * relative path to our own origin, and our server does the vendor fetch. So the buyer's IP never
 * reaches the payment venue, and no `images.remotePatterns` entry or `img-src` host exists for
 * Paybis anywhere in this app. This schema's own job is unchanged and deliberately narrow: it stops
 * the value being thrown away, and only ever hands on an absolute `https:` one. It is the FIRST of
 * two independent checks, not the only one, since the proxy re-validates whatever arrives at it.
 */
const wireIconSchema = z.string().refine((value) => /^https:\/\/[^\s]+$/.test(value), {
  message: "icon must be an absolute https URL",
});

/**
 * The `GET /on-ramp/payment-methods` response: a bare array of methods for the requested pair. Not
 * wrapped in `{ data }`, so `apiFetch`'s `unwrapData` leaves it untouched. 404s for an unsupported pair,
 * meaning a code outside the two this app buys (`USDT-BASE` say, which the sandbox map does not
 * touch, so the vendor answers for it honestly): that is a handled failure the caller
 * degrades on, never a broken endpoint. POO-1626: `USDC-BASE` on dev is NO LONGER an example of it,
 * because pool-party-api maps our two production codes onto their sandbox equivalents at the vendor
 * boundary (POO-1605), so the pair lists and quotes there.
 */
export const onRampPaymentMethodsResponseSchema = z.array(wirePaymentMethodSchema);
export type OnRampPaymentMethodsResponse = z.infer<typeof onRampPaymentMethodsResponseSchema>;

/**
 * A normalized payment method: the identifier to quote with, its label, its own minimum, and since
 * POO-1603 the three fields the vendor always sent and this app used to discard (its tags, its logo
 * and its ceiling). The four original fields are always present; the POO-1603 ones are optional
 * because absence is a normal answer for every one of them, not a degraded one.
 */
export interface OnRampPaymentMethod {
  /** The identifier the quote query requires (e.g. `"poolparty-credit-card"`). */
  paymentMethod: string;
  /** Human label shown beside the [R10] charge (e.g. `"Credit Card"`). */
  displayName: string;
  /**
   * The method's own minimum purchase, as a display-grade number (cents precision, float-safe:
   * same convention as {@link OnRampQuotePaymentMethod.chargeUsd}). Denominated in
   * {@link minCurrencyCode}, the `currencyFrom` the list was fetched for (POO-1512), so it is NOT
   * necessarily dollars and not USD-comparable to `PAYBIS_MIN_USD`; the name is historical.
   */
  minUsd: number;
  /** Fiat currency of the minimum (e.g. `"USD"`, `"EUR"`). */
  minCurrencyCode: string;
  /**
   * POO-1603 [R3]: the vendor's own tags for this method, verbatim.
   *
   * ANY string, in the order Paybis sent it. Absent when the vendor sent none or sent a shape this app
   * could not read, which are the same answer to a consumer: nothing to show. The value set is
   * undocumented ({@link wireLabelsSchema}), so a consumer may RENDER a label and may not BRANCH on
   * one: nothing may behave differently because a label reads `"instant"`.
   *
   * This is also the only speed signal that exists. Processing time was dropped from scope on
   * 2026-08-07 for being prose with no API field, so a tag reading "1-2 business days" because bank
   * transfers are generally slow is the forbidden thing this field replaces.
   */
  labels?: string[];
  /**
   * POO-1603 [R4]: the method's logo URL, when the vendor sent one and it was an absolute `https:` one.
   *
   * OPTIONAL BY CONTRACT, not defensively: a consumer must handle absence with a neutral fallback and
   * may never assume a URL. This is either an absolute `https:` URL or nothing: a blank string, another
   * scheme (`javascript:`, `data:`, plain `http:`), and a relative or protocol-relative path all decode
   * to absence, so the tradeoff a consumer sees is a fallback glyph rather than a value this app cannot
   * vouch for ({@link wireIconSchema}).
   */
  icon?: string;
  /**
   * POO-1603 [R5]: the method's own MAXIMUM purchase, the mirror of {@link minUsd} and in the same
   * display-grade unit. Absent when the vendor sent no ceiling, which is normal.
   *
   * Denominated in {@link maxCurrencyCode}, and since POO-1512 that is the BUYER's currency, so it is
   * not necessarily dollars (the name mirrors `minUsd`, whose name is likewise historical). This is
   * what lets a method the order EXCEEDS be shown as blocked with its ceiling rather than looking
   * identical to one the order fits: PIX caps around 3,000 where a card reaches 20,000, so a buyer
   * asking for 5,000 sees the difference often.
   */
  maxUsd?: number;
  /** Fiat currency of the ceiling. Set together with {@link maxUsd}, or neither is set. */
  maxCurrencyCode?: string;
}

/**
 * Normalize the raw payment-methods array to {@link OnRampPaymentMethod}[]. `minAmount.amount` becomes
 * the display-grade `minUsd` number; `decimalString` has already guaranteed `Number(...)` is finite, so
 * the coercion cannot yield NaN. Pure, so it is unit-tested without the transport.
 *
 * POO-1603: `labels`, `icon` and `maxAmount` are shaped HERE, one field at a time, so an unreadable
 * value costs that field and nothing else (the reasoning is on {@link wirePaymentMethodSchema}). Each
 * is spread in only when it parsed, the same way {@link normalizeQuoteMethodErrors} carries its
 * optional fields, so absence is a MISSING KEY rather than an `undefined` a consumer has to
 * distinguish. `maxUsd` and `maxCurrencyCode` come from one parse of one money object and are
 * therefore always both present or both absent: a ceiling without its currency is not a figure anyone
 * can render, least of all since POO-1512 made the currency the buyer's own.
 *
 * `wireAmountSchema` applies `decimalString` to the ceiling exactly as it does to the floor, so the
 * `Number(...)` coercion cannot yield NaN there either.
 *
 * Additive only ([R7]): the four fields this returned before keep their values and their names, so no
 * existing consumer changes behaviour.
 */
export function normalizeOnRampPaymentMethods(
  raw: OnRampPaymentMethodsResponse,
): OnRampPaymentMethod[] {
  return raw.map((method) => {
    const labels = wireLabelsSchema.safeParse(method.labels);
    const icon = wireIconSchema.safeParse(method.icon);
    const maxAmount = wireAmountSchema.safeParse(method.maxAmount);
    return {
      paymentMethod: method.paymentMethod,
      displayName: method.displayName,
      minUsd: Number(method.minAmount.amount),
      minCurrencyCode: method.minAmount.currencyCode,
      ...(labels.success ? { labels: labels.data } : {}),
      ...(icon.success ? { icon: icon.data } : {}),
      ...(maxAmount.success
        ? {
            maxUsd: Number(maxAmount.data.amount),
            maxCurrencyCode: maxAmount.data.currencyCode,
          }
        : {}),
    };
  });
}

/**
 * The payment-methods action input, validated at the trust boundary. The wallet is NOT here: the list
 * is per-pair, not per-identity.
 *
 * POO-1512 [R1]: `currencyCodeFrom` is OPTIONAL, not defaulted to "USD". Omitted, the action resolves
 * the buyer's own currency server-side ([R2]); a value here is a deliberate override, which today is
 * only [R6]'s spend-fixed leg. The old `.default("USD")` was the defect: it silently made every buyer
 * in every country dollar-denominated, and because this is the key the method list is fetched by, it
 * also meant a European was never offered SEPA and a Brazilian never offered Pix.
 */
export const onRampPaymentMethodsInputSchema = z.object({
  currencyCodeTo: z.string().min(1),
  currencyCodeFrom: z.string().min(1).optional(),
  /**
   * POO-1618 [R2]: the currency the BUYER chose, straight off the browser.
   *
   * A separate field from {@link currencyCodeFrom} because the two carry opposite trust and must not
   * be told apart by guesswork: `currencyCodeFrom` is the app pinning a currency it resolved itself
   * and short-circuits the resolution, while this one is a PROPOSAL that the server matches against
   * the supported set before it can decide anything. It is validated as a bare string here on
   * purpose - the shape check and the supported-set check both live in `resolveOnRampCurrency`,
   * where the set is, and a refusal there falls back to the resolved default rather than failing the
   * request, because a currency this app cannot offer is not a reason to refuse someone a purchase.
   */
  proposedCurrencyCodeFrom: z.string().optional(),
});
export type OnRampPaymentMethodsInput = z.input<typeof onRampPaymentMethodsInputSchema>;

/**
 * POO-1621: the supported-fiat action's input. Just the pair, because coverage is per PAIR: the same
 * fiat can buy one target and not another, so the answer is meaningless without the target.
 */
export const onRampSupportedCurrenciesInputSchema = z.object({
  currencyCodeTo: z.string().min(1),
});
export type OnRampSupportedCurrenciesInput = z.input<typeof onRampSupportedCurrenciesInputSchema>;

/** The request-id response (`RequestIdResponseDto`): what the Paybis widget needs to initialize. */
export const onRampRequestResponseSchema = z.object({
  /** The purchase id passed to `PartnerExchangeWidget.open({ requestId })`. */
  requestId: z.string().min(1),
  /** Optional one-time token for automatic widget login, when the backend returns one. */
  oneTimeToken: z.string().optional(),
});
export type OnRampRequest = z.infer<typeof onRampRequestResponseSchema>;

/**
 * The {@link getOnRampQuoteAction} input, validated at the trust boundary. `direction` is omitted →
 * the backend's spend-fixed default. The wallet is NOT here: a price quote carries no identity.
 *
 * POO-1599 [R1]: `paymentMethod` is OPTIONAL, and omitting it is the LISTING quote. Paybis lists the
 * parameter as optional on `POST /v2/quote` and, omitted, prices every method available for the pair
 * ("Array of quotes calculated for each available payment method", docs.payb.is, read 2026-08-14).
 * This schema required it, so every quote this app has ever sent pinned exactly one method and every
 * response came back with exactly one entry, measured 2026-08-14: one method requested, one method
 * priced. Nobody could compare two prices because nobody ever asked about two.
 *
 * The mandatory version was OUR constraint, one notch tighter than the vendor's, the third instance
 * of that shape after POO-1588 and POO-1601. An EMPTY string is still refused: absent means "price
 * every method", blank means the caller built a broken identifier.
 *
 * Requires pool-party-api's matching `QuoteQueryDto` change, which is why that side deploys FIRST:
 * omitting a field the deployed API still requires is a 400 on every listing quote.
 *
 * POO-1512 [R1]: `currencyCodeFrom` is OPTIONAL rather than defaulted to "USD", and omitting it makes
 * the action resolve the buyer's own currency ([R2]). A value here is a deliberate override, and the
 * reason it must stay possible is [R6]: a SPEND-fixed order's `amount` IS a USD-denominated figure,
 * so sending it as EUR would charge EUR 208 where 208 was computed as dollars.
 *
 * POO-1573 [R1]: both legs are received-fixed now (the gas-first one against an ETH target), so the
 * override is no longer the ETH leg's normal path — it is what that leg DEGRADES to when ETH cannot
 * be priced ([R5]), where pinning USD is again the only correct answer.
 */
export const onRampQuoteInputSchema = z
  .object({
    currencyCodeTo: z.string().min(1),
    // Positive in BOTH directions; the fiat floor is applied below, where `direction` is in scope.
    amount: z.number().finite().positive(),
    // POO-1599: absent = price EVERY method for the pair. Blank is still a refusal, not a listing.
    paymentMethod: z.string().min(1).optional(),
    direction: z.enum(ON_RAMP_QUOTE_DIRECTIONS).optional(),
    currencyCodeFrom: z.string().min(1).optional(),
  })
  .refine((input) => input.direction === "receive" || input.amount >= ON_RAMP_MIN_QUOTE_AMOUNT, {
    path: ["amount"],
    message: `a spend-fixed amount must not be less than ${ON_RAMP_MIN_QUOTE_AMOUNT}`,
  });
export type OnRampQuoteInput = z.input<typeof onRampQuoteInputSchema>;

/**
 * The {@link getOnRampEthTargetAction} input (POO-1573 [R1]): the `ETH-BASE` order's target RECIPE,
 * validated at the trust boundary like every other action input.
 *
 * Two non-negative decimal STRINGS, the `ProvisioningOrder.fiatAmount` convention (no float), so a
 * malformed recipe fails here with a reason rather than reaching the ETH arithmetic on a money path.
 */
export const onRampEthTargetInputSchema = z.object({
  gasFloorEth: decimalString,
  fundingUsd: decimalString,
});
export type OnRampEthTargetInput = z.infer<typeof onRampEthTargetInputSchema>;

/**
 * The {@link createOnRampRequestAction} input, validated at the trust boundary. `signature` and
 * `message` are produced by the client's `personal_sign` over {@link buildOnRampSignatureMessage};
 * the signature must be a `0x` hex string (the backend rejects anything else, `RequestIdQueryDto`).
 * The recipient wallet is deliberately ABSENT: it comes from the SIWE session, never the caller.
 */
export const onRampRequestInputSchema = z.object({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, "signature must be a 0x hex string"),
  message: z.string().min(1),
  currencyCode: z.string().min(1),
  quoteId: z.string().min(1).optional(),
  paymentMethod: z.string().min(1).optional(),
  /** BCP-47 UI language for the Paybis widget. Defaults to "en" (the only reviewed copy). */
  locale: z.string().min(1).default("en"),
});
export type OnRampRequestInput = z.input<typeof onRampRequestInputSchema>;
