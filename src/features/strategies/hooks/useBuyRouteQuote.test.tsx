/**
 * @id PP-CORE-HOK-026 (POO-1153, POO-1578, POO-1513, POO-1596, POO-1599, POO-1629)
 * @name useBuyRouteQuote tests
 * @implements-rules-version v9 (POO-1629 rules v2) · v8 (POO-1596 rules v1) · v7 (POO-1599 rules v1) · v6 (POO-1513 rules v1) · v5 (POO-1578 rules v1) · v3 (POO-1153 / POO-1129 rules v3)
 *
 * Rules under test (POO-1153 / POO-1129 rules v3):
 *   [R10] the picker shows the received-fixed QUOTE charge (`amountFrom`), never the FE-computed
 *         shortfall: the hook returns the quote's `chargeUsd`, not the `amountToUsd` it requested.
 *   the quote is received-fixed (`direction: "receive"`), priced against a DEFAULT method chosen from
 *         the pair's methods, and the [R10] figure is LABELLED with that method's name.
 *   graceful degradation: ANY failure (unsupported pair / 404 / empty methods / empty quote) yields
 *         no figure (undefined), never an error state and never a blocker.
 *
 * The two server actions are mocked: this is about the hook's orchestration (default-method choice,
 * received-fixed request shaping, degradation), not the transport (the actions' own suite).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isExpectedNonOutage } from "@/lib/observability/expectedFailure";
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import { pickDefaultPaymentMethod, useBuyRouteQuote } from "./useBuyRouteQuote";

const mocks = vi.hoisted(() => ({
  getMethods: vi.fn(),
  getQuote: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@/lib/observability/reportClientError", () => ({
  reportClientError: mocks.report,
}));

vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: mocks.getMethods,
  getOnRampQuoteAction: mocks.getQuote,
}));

const CARD: OnRampPaymentMethod = {
  paymentMethod: "poolparty-credit-card",
  displayName: "Credit Card",
  minUsd: 10,
  minCurrencyCode: "USD",
};
const TRUSTLY: OnRampPaymentMethod = {
  paymentMethod: "poolparty-trustly",
  displayName: "Trustly",
  minUsd: 30,
  minCurrencyCode: "USD",
};

/** A normalized quote whose `amountFrom` (chargeUsd) deliberately differs from what was requested. */
function quoteCharging(chargeUsd: number) {
  return {
    ok: true as const,
    quote: {
      quoteId: "quote_1",
      currencyCodeFrom: "USD",
      currencyCodeTo: "USDC-BASE",
      requestedAmountType: "destination",
      paymentMethods: [
        {
          id: "poolparty-credit-card",
          name: "Credit Card",
          chargeUsd,
          chargeAmount: chargeUsd.toFixed(2),
          chargeCurrencyCode: "USD",
          receiveAmount: "210.000000",
          receiveCurrencyCode: "USDC-BASE",
        },
      ],
    },
  };
}

/**
 * The body {@link getOnRampQuoteAction} was called with on call `index`, guarded against
 * `noUncheckedIndexedAccess`. POO-1599 asserts on the ABSENCE of a key, which `objectContaining`
 * cannot express, so the call body is read directly.
 */
function quoteCallBody(index = 0): Record<string, unknown> {
  const call = mocks.getQuote.mock.calls[index] as [Record<string, unknown>] | undefined;
  if (!call) throw new Error(`expected a quote call at index ${index}`);
  return call[0];
}

afterEach(() => {
  mocks.getMethods.mockReset();
  mocks.getQuote.mockReset();
  mocks.report.mockReset();
});

describe("pickDefaultPaymentMethod (POO-1153)", () => {
  // @rule POO-1153: a card is the sensible universal default (and the verified one), so it wins even
  // when it is not first in the list.
  it("prefers a credit-card method over others", () => {
    expect(pickDefaultPaymentMethod([TRUSTLY, CARD])).toBe(CARD);
  });

  // @rule POO-1153: with no card on offer, the first method the backend returns is the default.
  it("falls back to the first method when no card is present", () => {
    expect(pickDefaultPaymentMethod([TRUSTLY])).toBe(TRUSTLY);
  });

  it("returns undefined for an empty list", () => {
    expect(pickDefaultPaymentMethod([])).toBeUndefined();
  });
});

describe("useBuyRouteQuote (POO-1153)", () => {
  // @rule R10: the hook prices a received-fixed quote against the default method and returns the
  // quote's charge, labelled — the figure the picker shows.
  it("quotes received-fixed against the default method and returns the labelled charge", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD, TRUSTLY],
    });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
    expect(result.current).toEqual({
      chargeUsd: 214.3,
      // POO-1513: what this charge was priced FOR. Published with the figure, never inferred.
      pricedFor: { amountToUsd: 210, paymentMethod: "poolparty-credit-card" },
      // POO-1512 [R7]: the currency the charge is billed in, carried from the quote so the picker can
      // print it instead of assuming dollars.
      chargeCurrency: "USD",
      methodLabel: "Credit Card",
      methodMinUsd: 10,
      // POO-1512 [R7]: the minimum's own currency rides beside its figure for the same reason.
      methodMinCurrency: "USD",
      // POO-1578 S1: the FULL list, no longer narrowed to the one method that was priced.
      methods: [CARD, TRUSTLY],
      currencyCodeFrom: "USD",
      // POO-1576: the list has landed, so nothing is in flight. Published always, so a picker can
      // tell "still arriving" from "the provider returned nothing" without inspecting an absence.
      methodsLoading: false,
      // POO-1612: the full priced quote, verbatim, alongside the narrowed fields above.
      quote: quoteCharging(214.3).quote,
    });
    // Received-fixed: amountTo is what must LAND, direction "receive", and NO pinned method.
    //
    // POO-1599: the listing quote sends no `paymentMethod` at all, so Paybis prices every method
    // available for the pair in this one call. It used to pin the default, which is why exactly one
    // method ever came back priced and no surface could compare two prices. The default is still
    // chosen, but now only to decide which of the returned entries is LABELLED and published.
    expect(mocks.getQuote).toHaveBeenCalledWith({
      currencyCodeTo: "USDC-BASE",
      // POO-1512, POO-1578: ONE currency resolution per flow. The quote PINS the currency the methods
      // call resolved rather than letting the server resolve a second time, so the list's per-method
      // minimums and this charge cannot end up denominated differently across a cache expiry or a
      // profile write. `resolveWidgetPrefill` pins `flowCurrency` for exactly this reason.
      currencyCodeFrom: "USD",
      amount: 210,
      direction: "receive",
    });
  });

  // @rule R10: the displayed figure is the quote's `amountFrom`, NEVER the requested amount. Here the
  // request is 210 but Paybis charges 214.30, and it is the 214.30 the hook surfaces.
  it("[R10] surfaces the quote charge, never the requested amount", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
    expect(result.current.chargeUsd).toBe(214.3);
    expect(result.current.chargeUsd).not.toBe(210);
  });

  // @rule POO-1153: the failing-quote path. The hook yields NO figure, so the picker keeps its
  // neutral caption. Explicitly covered.
  //
  // @rule POO-1629 [R1]/[R5] rules v2: this is the QUOTE, and the quote CANNOT answer
  // `ONRAMP_PAIR_UNAVAILABLE`. Rules v1 swapped all six fixtures to that one code; review caught
  // that two of them sit on a different endpoint. `throwIfPairUnavailable` is reachable only from
  // `getPaymentMethods` (api `paybis.service.ts:161`), while `POST /on-ramp/quote` runs through
  // `asQuoteFailure` (`:393`), which maps an upstream 4xx to `ONRAMP_UPSTREAM_REJECTED` (422) and a
  // 5xx, a timeout or no response to `ONRAMP_QUOTE_FAILED` (502). `on-ramp.service.ts:29` passes the
  // DTO straight through, so there is no other seam.
  //
  // The split is deliberate, decided by Rafael on 2026-08-14 and recorded verbatim in api `13c4c5b`
  // so it is not "harmonised" later as a bug: the methods URL names the pair and nothing else, so a
  // 404 there has exactly one meaning, whereas a quote also carries an amount and a payment method,
  // so a refusal there CANNOT be attributed to the pair. "Leave the quote path at 422."
  //
  // Nothing on this path branches on the value, so the degrade itself was never wrong; it had simply
  // only ever been exercised against a contract no service serves, and swapping in the METHODS code
  // would have left it exactly there under a new name.
  it("degrades to no figure when the quote is rejected (422)", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    mocks.getQuote.mockResolvedValue({
      ok: false,
      code: "ONRAMP_UPSTREAM_REJECTED",
      message: "no",
    });

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    // Wait on the rendered VALUE, not on a mock call count: a call count says nothing about React
    // having committed the setState the assertions below read.
    await waitFor(() => expect(result.current.methods).toBeDefined());
    // ...and on the quote having actually been attempted, so "no figure" is the FAILURE's doing
    // rather than the quote simply not having run yet.
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalled());
    expect(result.current.chargeUsd).toBeUndefined();
    // POO-1596 F1 means the LABEL and the MINIMUM come from the methods list, so they legitimately
    // survive a quote that produced no charge - that is the design's "Min. $500.00" row, and it is
    // why the label assertion that used to sit here was relaxed. What must NOT survive is
    // `pricedFor`, the tag `/deposit`'s raise-to-minimum requires before it does arithmetic across
    // the (amount, method) pair.
    expect(result.current.pricedFor).toBeUndefined();
    // POO-1578 S1: the methods themselves resolved, so they stand. This assertion used to be
    // `toEqual({})`, which conflated "no charge" with "nothing at all"; a picker that blanked its list
    // on a pricing failure would empty the step exactly when the user still has to choose.
    expect(result.current.methods).toEqual([CARD]);
  });

  // @rule POO-1153: methods themselves can 404 (unsupported pair). No default to quote, so no figure,
  // and the quote is never attempted.
  // @rule POO-1629 [R1]: and this is the read that genuinely answers `ONRAMP_PAIR_UNAVAILABLE`.
  // `throwIfPairUnavailable` is called from `getPaymentMethods` alone (api `paybis.service.ts:161`),
  // so the METHODS fixture keeps the code while the quote fixture above carries the 422 its own path
  // maps to.
  it("degrades to no figure when payment-methods fails, without quoting", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: false,
      code: "ONRAMP_PAIR_UNAVAILABLE",
      message: "no",
    });

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    await waitFor(() => expect(mocks.getMethods).toHaveBeenCalled());
    // POO-1576: the failed call is FINISHED, which is the whole point of publishing the flag - the
    // picker's informational state (Q3) is correct here and a skeleton would never resolve.
    await waitFor(() => expect(result.current.methodsLoading).toBe(false));
    expect(result.current).toEqual({ methodsLoading: false });
    expect(mocks.getQuote).not.toHaveBeenCalled();
  });

  // @rule POO-1153: a quote that priced no method is not a figure either.
  it("degrades to no figure when the quote returns no priced method", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    mocks.getQuote.mockResolvedValue({
      ok: true,
      quote: {
        quoteId: "q",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "destination",
        paymentMethods: [],
      },
    });

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    // The rendered value, then the call: see "degrades to no figure when the quote fails" above.
    await waitFor(() => expect(result.current.methods).toBeDefined());
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalled());
    expect(result.current.chargeUsd).toBeUndefined();
    // POO-1578 S1: an unpriced quote costs the figure, not the list.
    expect(result.current.methods).toEqual([CARD]);
  });

  /**
   * @rule POO-1413 — never display another method's charge under our method's label.
   *
   * The read was positional (`const [priced] = paymentMethods`) on the reasoning "we requested exactly
   * one method, so the quote answers for it". When Paybis answers about a DIFFERENT method that
   * displays its charge beside `CARD.displayName`, and this figure is the [R10] number the user
   * decides on. Silence is the correct degrade: the picker already has a neutral caption for it.
   */
  it("[POO-1413] shows no figure when the quote priced a DIFFERENT method", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    mocks.getQuote.mockResolvedValue({
      ok: true,
      quote: {
        quoteId: "q",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "destination",
        paymentMethods: [
          {
            id: "poolparty-trustly",
            name: "Trustly",
            chargeUsd: 999.99,
            chargeAmount: "999.99",
            chargeCurrencyCode: "USD",
            receiveAmount: "210.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    });

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    // The rendered value, then the call: see "degrades to no figure when the quote fails" above.
    await waitFor(() => expect(result.current.methods).toBeDefined());
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalled());
    // Not `999.99` labelled "Credit Card". THIS is the assertion the issue exists for.
    expect(result.current.chargeUsd).toBeUndefined();
    // POO-1596 F1 means the LABEL and the MINIMUM come from the methods list, so they legitimately
    // survive a quote that produced no charge - that is the design's "Min. $500.00" row, and it is
    // why the label assertion that used to sit here was relaxed. It is still OUR method's name that
    // survives, never the one Paybis answered about, so the case still pins WHOSE label it is.
    expect(result.current.methodLabel).toBe(CARD.displayName);
    // What must NOT survive is `pricedFor`, the tag `/deposit`'s raise-to-minimum requires before it
    // does arithmetic across the (amount, method) pair.
    expect(result.current.pricedFor).toBeUndefined();
    // POO-1578 S1: refusing the wrong figure never meant refusing the list.
    expect(result.current.methods).toEqual([CARD]);
  });

  // @rule POO-1153: disabled (crypto-only cut, mock mode, no buy route) makes no calls at all.
  it("makes no network calls when disabled", async () => {
    renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: false }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.getMethods).not.toHaveBeenCalled();
    expect(mocks.getQuote).not.toHaveBeenCalled();
  });

  // @rule POO-1153: a non-positive amount is not a purchase to price.
  it("makes no network calls for a non-positive amount", async () => {
    renderHook(() => useBuyRouteQuote({ amountToUsd: 0, enabled: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.getMethods).not.toHaveBeenCalled();
    expect(mocks.getQuote).not.toHaveBeenCalled();
  });

  // @rule POO-1153: the run-id race guard, the half that REFUSES a write. The amount changes while a
  // quote is in flight (the user's requirement moved, or the route was re-resolved), the fresh quote
  // answers first, and the stale one lands afterwards priced for an amount nobody is funding any more.
  // Without the guard that stale charge overwrites the fresh one and the user reads a figure for the
  // wrong purchase.
  it("refuses a superseded quote that answers after a fresher one", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });

    // The FIRST quote hangs until this test releases it; every later call resolves at once.
    let releaseStale: (value: ReturnType<typeof quoteCharging>) => void = () => {};
    const stale = new Promise<ReturnType<typeof quoteCharging>>((resolve) => {
      releaseStale = resolve;
    });
    mocks.getQuote.mockReturnValueOnce(stale).mockResolvedValue(quoteCharging(320.5));

    const { result, rerender } = renderHook(
      ({ amountToUsd }) => useBuyRouteQuote({ amountToUsd, enabled: true }),
      { initialProps: { amountToUsd: 210 } },
    );
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalledTimes(1));

    // The amount changes mid-flight; the second run resolves while the first is still pending.
    rerender({ amountToUsd: 320 });
    await waitFor(() => expect(result.current.chargeUsd).toBe(320.5));

    // Now the stale run finally answers. `act` flushes whatever it schedules, so a write from the
    // superseded run WOULD land here: the assertion below is what refuses it.
    await act(async () => {
      releaseStale(quoteCharging(214.3));
      await stale;
    });
    expect(result.current.chargeUsd).toBe(320.5);
  });

  // @rule POO-1153: the other half of the guard. A fresh run CLEARS to the fallback before it fetches,
  // so a figure on screen always matches the amount currently being funded, or is absent. Without this
  // the previous amount's charge stays visible, labelled, while a different amount is being priced.
  it("clears the charge while a new amount is being priced", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    mocks.getQuote.mockResolvedValueOnce(quoteCharging(214.3));

    const { result, rerender } = renderHook(
      ({ amountToUsd }) => useBuyRouteQuote({ amountToUsd, enabled: true }),
      { initialProps: { amountToUsd: 210 } },
    );
    await waitFor(() => expect(result.current.chargeUsd).toBe(214.3));
    mocks.getMethods.mockClear();

    // The second quote never settles, so what is asserted is purely the clear-first behaviour.
    mocks.getQuote.mockReturnValue(new Promise(() => {}));
    rerender({ amountToUsd: 320 });

    // POO-1578 S1: the CHARGE half clears, and only that. This assertion used to be `toEqual({})`,
    // written when one effect owned everything; the methods are not a function of the amount, so
    // blanking the list here would empty the picker on every keystroke of the funding figure. Same
    // narrowing the three degradation cases above already went through.
    expect(result.current.chargeUsd).toBeUndefined();
    // POO-1596 F1 means the LABEL and the MINIMUM come from the methods list, so they legitimately
    // survive a quote that produced no charge - that is the design's "Min. $500.00" row, and it is
    // why the label assertion that used to sit here was relaxed. What must NOT survive is
    // `pricedFor`, the tag `/deposit`'s raise-to-minimum requires before it does arithmetic across
    // the (amount, method) pair, and here it would be the PREVIOUS amount's tag.
    expect(result.current.pricedFor).toBeUndefined();
    // The minimum SURVIVES the re-price (POO-1596 F1): it belongs to the method, not to the amount,
    // so blanking it here would flicker the disclosure off on every keystroke of the funding figure -
    // the same reason POO-1578 S1 stopped blanking the list.
    expect(result.current.methodMinUsd).toBe(10);
    expect(result.current.methods).toEqual([CARD]);
    expect(result.current.currencyCodeFrom).toBe("USD");
    // And the list is not RE-fetched either: the pair did not change, so nothing was spent relisting.
    expect(mocks.getMethods).not.toHaveBeenCalled();
  });
});

/**
 * POO-1578: the list stops being an internal detail of choosing ONE method to price.
 *
 * The hook already fetched every method the pair offers and discarded all but the one
 * `pickDefaultPaymentMethod` chose. Both pickers (POO-1576, POO-1513) need that list, and the charge
 * is deliberately secondary: names + minimums render without a quote, and a per-method charge is shown
 * only when the quote we already make happens to carry it.
 */
describe("useBuyRouteQuote method list + caller selection (POO-1578)", () => {
  // @rule POO-1578 S1: the picker renders names and minimums, which come from the METHODS call. A
  // quote failure must not blank them, or the step goes empty exactly when pricing is degraded, which
  // is the one time the user still needs to be able to choose.
  it("keeps the resolved methods when the quote fails", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD, TRUSTLY],
    });
    mocks.getQuote.mockResolvedValue({ ok: false, code: "ONRAMP_UNSUPPORTED", message: "no pair" });

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    await waitFor(() => expect(result.current.methods).toBeDefined());
    expect(result.current.methods).toEqual([CARD, TRUSTLY]);
    expect(result.current.currencyCodeFrom).toBe("USD");
    // No figure: the charge is opportunistic, never invented.
    expect(result.current.chargeUsd).toBeUndefined();
    // POO-1596 F1 means the LABEL and the MINIMUM come from the methods list, so they legitimately
    // survive a quote that produced no charge - that is the design's "Min. $500.00" row, and it is
    // why the label assertion that used to sit here was relaxed. What must NOT survive is
    // `pricedFor`, the tag `/deposit`'s raise-to-minimum requires before it does arithmetic across
    // the (amount, method) pair.
    expect(result.current.pricedFor).toBeUndefined();
  });

  // @rule POO-1578 S2: a caller-chosen method is PRICED, so the figure on screen belongs to the method
  // the user picked rather than the card the app would have defaulted to.
  it("prices the caller's selected method instead of the card default", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD, TRUSTLY],
    });
    mocks.getQuote.mockResolvedValue({
      ok: true,
      quote: {
        quoteId: "quote_1",
        currencyCodeFrom: "EUR",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "destination",
        paymentMethods: [
          {
            id: "poolparty-trustly",
            name: "Trustly",
            chargeUsd: 201.4,
            chargeAmount: "201.40",
            chargeCurrencyCode: "EUR",
            receiveAmount: "210.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    });

    const { result } = renderHook(() =>
      useBuyRouteQuote({
        amountToUsd: 210,
        enabled: true,
        paymentMethod: "poolparty-trustly",
      }),
    );

    await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
    expect(mocks.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: "poolparty-trustly" }),
    );
    expect(result.current.chargeUsd).toBe(201.4);
    expect(result.current.chargeCurrency).toBe("EUR");
    // Labelled with the CHOSEN method, never the default's name over the choice's figure.
    expect(result.current.methodLabel).toBe("Trustly");
    expect(result.current.methodMinUsd).toBe(30);
  });

  /**
   * @rule POO-1578 S4 + POO-1599: with no selection, `pickDefaultPaymentMethod` still chooses which
   * figure is PUBLISHED, but it no longer decides what is ASKED. The request goes out unpinned, so
   * every method comes back priced and the default merely picks the entry to label.
   */
  it("asks unpinned when the caller selects nothing, and still labels the default's figure", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [TRUSTLY, CARD],
    });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
    expect(quoteCallBody()).not.toHaveProperty("paymentMethod");
    expect(result.current.methodLabel).toBe("Credit Card");
    expect(result.current.pricedFor).toEqual({
      amountToUsd: 210,
      paymentMethod: "poolparty-credit-card",
    });
  });

  /**
   * @rule POO-1578 S1: the list OUTLIVES the quote, including across a selection change.
   *
   * The selection is what a picker changes, and it was a dependency of the single effect whose first
   * statement cleared everything. So every tap on a method blanked `methods` and `currencyCodeFrom`
   * for a whole methods round trip, emptying the picker the user was mid-click in, and defeating the
   * guarantee this hook documents at "blanking the list on a pricing failure would empty the step
   * exactly when the user still has to be able to choose".
   *
   * The synchronous assertion right after `rerender` is the one that matters: that is the render the
   * blanked list was visible in.
   */
  it("keeps the method list across a selection change, without relisting", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD, TRUSTLY],
    });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    const { result, rerender } = renderHook(
      ({ paymentMethod }) => useBuyRouteQuote({ amountToUsd: 210, enabled: true, paymentMethod }),
      { initialProps: { paymentMethod: "poolparty-credit-card" } },
    );
    // The FIRST quote has to have gone out before the selection moves, or the debounce (POO-1513)
    // simply coalesces the two into one call and the count below stops measuring anything.
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalledTimes(1));
    expect(result.current.methods).toBeDefined();
    mocks.getMethods.mockClear();

    rerender({ paymentMethod: "poolparty-trustly" });

    // Synchronously, in the very render the change lands in: still there.
    expect(result.current.methods).toEqual([CARD, TRUSTLY]);
    expect(result.current.currencyCodeFrom).toBe("USD");
    // And still there once the new method has been re-quoted.
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalledTimes(2));
    expect(result.current.methods).toEqual([CARD, TRUSTLY]);
    expect(mocks.getQuote).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentMethod: "poolparty-trustly" }),
    );
    // The list is a function of the PAIR, never of the choice: choosing costs no methods call.
    expect(mocks.getMethods).not.toHaveBeenCalled();
  });

  /**
   * @rule POO-1513: the published charge NAMES the (amount, method) it was priced for.
   *
   * Without the tag a consumer holds two numbers with nothing to say whether they belong together,
   * and this state deliberately publishes the charge one commit behind the input that changed it
   * (the clear-first `setCharge` lands in the NEXT commit, not the one the effect runs in). A
   * consumer doing arithmetic across the pair (`/deposit`'s `minimum / charge` raise ratio) then
   * computes on the previous amount's charge and scales the new order by a factor nobody asked for.
   * The tag is what lets it refuse.
   */
  it("[POO-1513] tags the charge with the amount and method it was priced for", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD, TRUSTLY],
    });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    const { result, rerender } = renderHook(
      ({ amountToUsd }) => useBuyRouteQuote({ amountToUsd, enabled: true }),
      { initialProps: { amountToUsd: 210 } },
    );

    await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
    expect(result.current.pricedFor).toEqual({
      amountToUsd: 210,
      paymentMethod: "poolparty-credit-card",
    });

    // The tag rides with the figure, so it clears with it: a charge in flight is not a priced pair.
    mocks.getQuote.mockReturnValue(new Promise(() => {}));
    rerender({ amountToUsd: 320 });
    expect(result.current.pricedFor).toBeUndefined();
  });

  /**
   * @rule POO-1513: one quote per settled amount, not one per keystroke.
   *
   * The quote is a POST to `pool-party-api`, which throttles per API KEY and shares that bucket with
   * v1 (not per IP), so a buyer typing "1", "10", "100" spent three of everyone's requests to price
   * two amounts nobody was funding. The clear-first behaviour is deliberately NOT debounced: a stale
   * figure must leave the screen the instant the amount moves, whatever the network does next.
   */
  it("[POO-1513] debounces the quote so a keystroke does not cost one upstream POST", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    const { result, rerender } = renderHook(
      ({ amountToUsd }) => useBuyRouteQuote({ amountToUsd, enabled: true }),
      { initialProps: { amountToUsd: 210 } },
    );
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalledTimes(1));

    // Three keystrokes inside one debounce window.
    rerender({ amountToUsd: 211 });
    rerender({ amountToUsd: 212 });
    rerender({ amountToUsd: 213 });
    // Synchronously: the figure is already gone, and nothing has been spent upstream.
    expect(result.current.chargeUsd).toBeUndefined();
    expect(mocks.getQuote).toHaveBeenCalledTimes(1);

    // One call, for the amount the buyer stopped on.
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalledTimes(2));
    expect(mocks.getQuote).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 213 }));
  });

  /**
   * @rule POO-1578 S4: a selection the pair does not offer is not a reason to price nothing. It falls
   * back rather than dead-ending, on the same "degrades, never blocks" posture as every other path
   * here: the list can legitimately change under a selection when the resolved currency changes.
   *
   * @rule POO-1599: and the request goes UNPINNED in that case, never pinned to the fallback. Pinning
   * a method the buyer did not choose is the one thing worse than not pinning: it spends the call on
   * a single method that nobody asked about, where unpinned prices all of them including the one
   * that will be labelled.
   */
  it("asks unpinned, and still labels the default, when the selected method is not on offer", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    const { result } = renderHook(() =>
      useBuyRouteQuote({ amountToUsd: 210, enabled: true, paymentMethod: "poolparty-pix" }),
    );

    await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
    expect(quoteCallBody()).not.toHaveProperty("paymentMethod");
    expect(result.current.methodLabel).toBe("Credit Card");
  });

  /**
   * POO-1599 (rules-v1). The premise the picker was built on was false: Paybis' `POST /v2/quote`
   * lists `paymentMethod` as optional and, omitted, returns "Array of quotes calculated for each
   * available payment method". Measured 2026-08-14: pinned, one method requested, one method priced.
   * The list was narrow because WE asked narrow.
   *
   * So ONE call now carries every method's figure. This suite pins the two halves that matter to the
   * money surfaces downstream: the whole set arrives, and the entry that gets published is still
   * matched BY ID (POO-1413), never by position.
   */
  describe("the unpinned listing quote (POO-1599 @rules-v1)", () => {
    /** A quote answering for BOTH methods, with the default deliberately NOT first in the array. */
    const twoMethodQuote = {
      ok: true as const,
      quote: {
        quoteId: "quote_1",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "destination",
        paymentMethods: [
          {
            id: "poolparty-trustly",
            name: "Trustly",
            chargeUsd: 201.4,
            chargeAmount: "201.40",
            chargeCurrencyCode: "USD",
            receiveAmount: "210.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
          {
            id: "poolparty-credit-card",
            name: "Credit Card",
            chargeUsd: 214.3,
            chargeAmount: "214.30",
            chargeCurrencyCode: "USD",
            receiveAmount: "210.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
        paymentMethodErrors: [],
      },
    };

    it("prices every method the pair offers in ONE upstream call", async () => {
      mocks.getMethods.mockResolvedValue({
        ok: true,
        currencyCodeFrom: "USD",
        methods: [CARD, TRUSTLY],
      });
      mocks.getQuote.mockResolvedValue(twoMethodQuote);

      const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

      await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
      expect(mocks.getQuote).toHaveBeenCalledTimes(1);
      expect(quoteCallBody()).not.toHaveProperty("paymentMethod");
    });

    // @rule POO-1413, and it matters MORE now: an unpinned answer carries several entries, so a
    // positional read would publish whichever method Paybis happened to list first under the
    // default's name. The charge is the number the buyer decides on.
    it("publishes the DEFAULT method's entry, matched by id and not by position", async () => {
      mocks.getMethods.mockResolvedValue({
        ok: true,
        currencyCodeFrom: "USD",
        methods: [CARD, TRUSTLY],
      });
      mocks.getQuote.mockResolvedValue(twoMethodQuote);

      const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

      await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
      // 214.30 (the card), NOT 201.40 (Trustly, which is first in the response).
      expect(result.current.chargeUsd).toBe(214.3);
      expect(result.current.methodLabel).toBe("Credit Card");
    });

    // @rule POO-1612: a picker rendering every row's own charge, and the mint's own offered-methods
    // check (`pricedQuoteMethodsById`, POO-1666), both need the WHOLE answer, not just the one entry
    // published above. Exposed verbatim so a caller passes it to those functions unadapted. (POO-1577
    // was the original requester; its Best price comparison is deleted, POO-1639.)
    it("exposes the full quote, so every row's own charge is readable, not just the published one's", async () => {
      mocks.getMethods.mockResolvedValue({
        ok: true,
        currencyCodeFrom: "USD",
        methods: [CARD, TRUSTLY],
      });
      mocks.getQuote.mockResolvedValue(twoMethodQuote);

      const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

      await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
      expect(result.current.quote?.paymentMethods).toEqual(twoMethodQuote.quote.paymentMethods);
      expect(result.current.quote?.paymentMethodErrors).toEqual([]);
    });

    /**
     * @rule POO-1513: `pricedFor` names the method the PUBLISHED charge belongs to, which is exactly
     * what it named before. Unpinning changed the REQUEST, not the tag: `/deposit`'s now-deleted
     * raise-to-minimum (POO-1609) compared this against the method it was showing before computing
     * `minimum / charge`, and that guard is what stopped a freshly typed 5000 becoming a 5159.61 order.
     */
    it("still tags the charge with the method it belongs to, though nothing was pinned", async () => {
      mocks.getMethods.mockResolvedValue({
        ok: true,
        currencyCodeFrom: "USD",
        methods: [CARD, TRUSTLY],
      });
      mocks.getQuote.mockResolvedValue(twoMethodQuote);

      const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

      await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
      expect(result.current.pricedFor).toEqual({
        amountToUsd: 210,
        paymentMethod: "poolparty-credit-card",
      });
    });

    /**
     * @rule POO-1576 — the whole per-method answer reaches a picker, tagged with what it prices.
     *
     * `chargeUsd` publishes ONE figure. A step that prices every row and marks the cheapest needs
     * the rest of the payload, and re-fetching it there would spend a second POST against a
     * per-API-key throttle for a payload this hook already holds.
     */
    it("[POO-1576] publishes the whole listing quote, tagged with the amount it prices", async () => {
      mocks.getMethods.mockResolvedValue({
        ok: true,
        currencyCodeFrom: "USD",
        methods: [CARD, TRUSTLY],
      });
      mocks.getQuote.mockResolvedValue(twoMethodQuote);

      const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

      await waitFor(() => expect(result.current.quote).toBeDefined());
      expect(result.current.pricedFor?.amountToUsd).toBe(210);
      expect(result.current.quote?.paymentMethods.map((entry) => entry.id)).toEqual([
        "poolparty-trustly",
        "poolparty-credit-card",
      ]);
    });

    /**
     * @rule POO-1576 — an unpinned quote that skipped the DEFAULT method has very likely priced the
     * others, and the picker's whole reason to exist is that comparison. Blanking every row over the
     * caption's own method would discard exactly what POO-1599 fetched.
     */
    it("[POO-1576] keeps the quote payload when it priced no entry for the default method", async () => {
      mocks.getMethods.mockResolvedValue({
        ok: true,
        currencyCodeFrom: "USD",
        methods: [CARD, TRUSTLY],
      });
      mocks.getQuote.mockResolvedValue({
        ok: true,
        quote: {
          ...twoMethodQuote.quote,
          paymentMethods: [twoMethodQuote.quote.paymentMethods[0]],
        },
      });

      const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

      await waitFor(() => expect(result.current.quote).toBeDefined());
      // No caption figure (POO-1413: nothing was priced for the method we would label), and the
      // comparison survives anyway.
      expect(result.current.chargeUsd).toBeUndefined();
      expect(result.current.quote?.paymentMethods).toHaveLength(1);
    });

    // @rule POO-1578 (unchanged): once the BUYER has chosen, the quote is pinned to their choice.
    // The threading POO-1578 built must not regress into "we ask about everything now".
    it("still pins the quote to the method the buyer chose", async () => {
      mocks.getMethods.mockResolvedValue({
        ok: true,
        currencyCodeFrom: "USD",
        methods: [CARD, TRUSTLY],
      });
      mocks.getQuote.mockResolvedValue(twoMethodQuote);

      const { result } = renderHook(() =>
        useBuyRouteQuote({
          amountToUsd: 210,
          enabled: true,
          paymentMethod: "poolparty-trustly",
        }),
      );

      await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
      expect(mocks.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethod: "poolparty-trustly" }),
      );
      expect(result.current.chargeUsd).toBe(201.4);
      expect(result.current.pricedFor).toEqual({
        amountToUsd: 210,
        paymentMethod: "poolparty-trustly",
      });
    });

    // The vendor's `paymentMethodErrors` rides in the same payload. It explains an ABSENCE, so it can
    // never cost the charge that is present: a method refused for one buyer is normal.
    it("publishes the charge even when the quote reports methods it could not price", async () => {
      mocks.getMethods.mockResolvedValue({
        ok: true,
        currencyCodeFrom: "USD",
        methods: [CARD, TRUSTLY],
      });
      mocks.getQuote.mockResolvedValue({
        ok: true,
        quote: {
          ...twoMethodQuote.quote,
          paymentMethods: [twoMethodQuote.quote.paymentMethods[1]],
          paymentMethodErrors: [
            {
              paymentMethod: "poolparty-trustly",
              code: "amount_too_low",
              message: "Minimum is 300 USD",
            },
          ],
        },
      });

      const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

      await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
      expect(result.current.chargeUsd).toBe(214.3);
      // The list is never narrowed by what could not be priced: the buyer still sees every method.
      expect(result.current.methods).toEqual([CARD, TRUSTLY]);
    });
  });
});

/**
 * POO-1599 cross-lane F1: this hook degraded in total silence.
 *
 * `if (!quoteResult.ok) return` swallowed every failure, and the file contained no
 * `reportClientError`, `logError` or `track` call at all. That was survivable while the quote was
 * always pinned and its only realistic failure was dev's absent `USDC-BASE` pair (past tense twice
 * over: POO-1605 later mapped that pair into the sandbox, so dev quotes now resolve). It stopped being
 * survivable when POO-1599 made the LISTING quote unpinned: `ProvisioningPanel` never pins, and
 * `/deposit` does not pin on first paint, so a frontend deployed ahead of the API that still requires
 * `paymentMethod` 400s on EVERY quote - and the user sees a plausible screen with no figure while
 * nothing reaches Sentry. That is the exact shape that let POO-1601 run for five days.
 */
describe("useBuyRouteQuote reports its degrades (POO-1599 F1)", () => {
  it("reports a failed quote, naming whether the request was pinned", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    mocks.getQuote.mockResolvedValue({ ok: false, code: "ONRAMP_INVALID_REQUEST", message: "no" });

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    await waitFor(() => expect(result.current.methods).toBeDefined());
    await waitFor(() => expect(mocks.report).toHaveBeenCalled());
    const call = mocks.report.mock.calls[0];
    expect(call).toBeDefined();
    const [event, , fields] = call as [string, unknown, Record<string, unknown>];
    expect(event).toBe("onramp.listing_quote_unavailable");
    // `pinned: false` is the whole point: it is what tells on-call this is the unpinned listing
    // quote hitting an API that still requires the field, rather than an unsupported pair.
    expect(fields).toMatchObject({ code: "ONRAMP_INVALID_REQUEST", pinned: false });
  });

  // @rule POO-1629 [R1]/[R2]
  it("reports a failed methods read", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: false,
      code: "ONRAMP_PAIR_UNAVAILABLE",
      message: "no",
    });

    renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    await waitFor(() => expect(mocks.report).toHaveBeenCalled());
    expect(mocks.report.mock.calls[0]?.[0]).toBe("onramp.methods_unavailable");
    // PP-DEBT(SEV:LOW): POO-1673 — the FE half of the 404 suppression. The assertion at the end of
    // this test PINS A KNOWN DEFECT rather than a desired behaviour, and it FLIPS to `true` when
    // POO-1673 lands. That is expected: whoever implements it should update this line, not treat the
    // red as a regression. Tagged so the comment-tag sweep and `tech-debt-scanner` can see it,
    // because naming POO-1673 in prose alone makes it findable by nobody.
    //
    // POO-1629, drift on [R2]. The issue reasoned that pp-api's 404 closes this Sentry noise on its
    // own, because `isExpectedNonOutage` gates on `status === 404`. It does not, and pp-api's own
    // source says so (`paybis.service.ts`, POO-1619: "What this does NOT do is silence the FRONTEND").
    // `reportOnce` hands `reportClientError` a SYNTHETIC `new Error("<event>: <code>")` carrying the
    // code in its MESSAGE and no `status`/`code` PROPERTY, and the predicate duck-types off exactly
    // those properties, so it returns false and `captureException` still fires. Pinned here rather
    // than left implicit, so nobody later records this path as silent on the strength of the API fix.
    // Behaviour is deliberately unchanged: POO-1629 [R2] forbids a source change, and the API ticket
    // defers the frontend half to a separate change (POO-1673).
    const reported = mocks.report.mock.calls[0]?.[1];
    expect(reported).toBeInstanceOf(Error);
    expect(isExpectedNonOutage(reported)).toBe(false);
  });

  // The hook re-runs per amount change (debounced). Reporting every failure would put a permanent
  // noise floor under the error rate, which is precisely what `isExpectedNonOutage` exists to
  // prevent. One report per distinct failure per mount is enough to make a wrong deploy order loud.
  it("reports each distinct failure once per mount, not once per attempt", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    mocks.getQuote.mockResolvedValue({ ok: false, code: "ONRAMP_INVALID_REQUEST", message: "no" });

    const { result, rerender } = renderHook(
      ({ amountToUsd }) => useBuyRouteQuote({ amountToUsd, enabled: true }),
      { initialProps: { amountToUsd: 210 } },
    );
    await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));

    rerender({ amountToUsd: 320 });
    await waitFor(() => expect(result.current.methods).toBeDefined());
    await act(async () => {});

    expect(mocks.report).toHaveBeenCalledTimes(1);
  });
});

/**
 * POO-1596 cross-lane F1: suppressing the PRICE must not suppress the MINIMUM.
 *
 * `methodLabel`, `methodMinUsd` and `methodMinCurrency` were set only inside the quote effect, so
 * `pricingEnabled: false` (the gas-first leg, where a dollar figure says nothing about an ETH target)
 * emptied all three. The picker gates its minimum note on the label AND the minimum being present, so
 * the disclosure went dark on exactly the leg that still needs it.
 *
 * They come from the METHODS list, not from the quote. They must survive.
 */
describe("useBuyRouteQuote keeps the minimum when pricing is suppressed (POO-1596 F1)", () => {
  it("still reports the method label and its minimum with pricingEnabled false", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD, TRUSTLY],
    });

    const { result } = renderHook(() =>
      useBuyRouteQuote({ amountToUsd: 210, enabled: true, pricingEnabled: false }),
    );

    await waitFor(() => expect(result.current.methods).toBeDefined());
    // The price is deliberately absent...
    expect(result.current.chargeUsd).toBeUndefined();
    // ...the disclosure is not.
    expect(result.current.methodLabel).toBe("Credit Card");
    expect(result.current.methodMinUsd).toBe(10);
    expect(result.current.methodMinCurrency).toBe("USD");
    // And no quote was spent asking for a figure that could not be expressed.
    expect(mocks.getQuote).not.toHaveBeenCalled();
  });

  it("names the SELECTED method's minimum, not the default's, when one is chosen", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD, TRUSTLY],
    });

    const { result } = renderHook(() =>
      useBuyRouteQuote({
        amountToUsd: 210,
        enabled: true,
        pricingEnabled: false,
        paymentMethod: "poolparty-trustly",
      }),
    );

    await waitFor(() => expect(result.current.methods).toBeDefined());
    expect(result.current.methodLabel).toBe("Trustly");
    expect(result.current.methodMinUsd).toBe(30);
  });

  /**
   * The quote's label wins over the fallback's, and this is the case where they DISAGREE.
   *
   * With one method selected they cannot: the fallback is `chosen ?? pickDefaultPaymentMethod(list)`
   * and the quote effect computes that same expression from that same list, so any test where the
   * selection is stable asserts an identity and would stay green with the guard deleted. The two
   * candidates only ever part company on the render where the SELECTION has moved and the quote
   * effect has not yet cleared the charge it priced for the previous one: the charge on screen is
   * still Trustly's while the list's default is a card.
   *
   * Publishing the fallback's name there is a charge under the wrong method's name, which is
   * POO-1413's failure class arriving through the merge instead of through a positional read. So the
   * invariant is asserted over EVERY render rather than the last one: whenever a charge is present,
   * the label beside it names the method that charge was `pricedFor`.
   */
  it("never labels a charge with a method other than the one it was priced for", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD, TRUSTLY],
    });
    // Paybis prices the PINNED method, so the quote's own label is "Trustly" while
    // `pickDefaultPaymentMethod([CARD, TRUSTLY])` is the card: the two candidates genuinely differ.
    mocks.getQuote.mockResolvedValue({
      ok: true,
      quote: {
        quoteId: "quote_1",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "destination",
        paymentMethods: [
          {
            id: TRUSTLY.paymentMethod,
            name: TRUSTLY.displayName,
            chargeUsd: 214.3,
            chargeAmount: "214.30",
            chargeCurrencyCode: "USD",
            receiveAmount: "210.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    });

    const labelOf = new Map([CARD, TRUSTLY].map((m) => [m.paymentMethod, m.displayName]));
    const seen: ReturnType<typeof useBuyRouteQuote>[] = [];
    const { result, rerender } = renderHook(
      (props: { paymentMethod?: string }) => {
        const state = useBuyRouteQuote({ amountToUsd: 210, enabled: true, ...props });
        seen.push(state);
        return state;
      },
      { initialProps: { paymentMethod: TRUSTLY.paymentMethod } as { paymentMethod?: string } },
    );

    await waitFor(() => expect(result.current.chargeUsd).toBeDefined());
    // The quote's label, not the card the list would have defaulted to.
    expect(result.current.methodLabel).toBe(TRUSTLY.displayName);
    expect(result.current.methodMinUsd).toBe(TRUSTLY.minUsd);

    // The buyer clears their selection. The Trustly charge is still on screen for one render, and
    // the fallback's candidate is now the card: exactly the disagreement the guard arbitrates.
    rerender({ paymentMethod: undefined });

    for (const state of seen) {
      if (state.chargeUsd === undefined) continue;
      expect(state.methodLabel).toBe(labelOf.get(state.pricedFor?.paymentMethod ?? ""));
    }
  });
});

/**
 * POO-1618 [R3] (decided on POO-1576): the buyer's chosen currency re-lists the methods.
 *
 * Not a relabel. `directa24_pix` is BRL-only and `poolparty-trustly` is USD-only, so a buyer on the
 * wrong currency does not see the wrong symbol beside the same rows, they LOSE Pix or SEPA entirely.
 * That is the whole case for the control, and it is why the METHODS effect has to key on the choice
 * as well as on the pair.
 */
describe("useBuyRouteQuote — the buyer's chosen currency (POO-1618 [R3])", () => {
  /** The methods-call argument on call `index`, guarded against `noUncheckedIndexedAccess`. */
  function methodsCallArgs(index = 0): Record<string, unknown> {
    const call = mocks.getMethods.mock.calls[index] as [Record<string, unknown>] | undefined;
    if (!call) throw new Error(`expected a methods call at index ${index}`);
    return call[0];
  }

  // @rule [R2] the browser PROPOSES: the choice travels on its own field, never as the pin the app
  // uses for a currency it resolved itself, so the server can tell the two apart and check this one.
  it("proposes the chosen currency to the methods call, as a proposal", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "BRL",
      methods: [CARD],
    });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    renderHook(() =>
      useBuyRouteQuote({ amountToUsd: 210, enabled: true, currencyCodeFrom: "BRL" }),
    );

    await waitFor(() => expect(mocks.getMethods).toHaveBeenCalled());
    expect(methodsCallArgs()).toEqual({
      currencyCodeTo: "USDC-BASE",
      proposedCurrencyCodeFrom: "BRL",
    });
  });

  // @rule [R3] the list is a function of the currency, so a new choice RE-LISTS. The pair did not
  // move and the amount did not move; without this dep the buyer picks BRL and keeps the USD rows.
  it("re-lists the methods when the chosen currency changes", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [CARD],
    });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    const { rerender } = renderHook(
      ({ currency }: { currency?: string }) =>
        useBuyRouteQuote({
          amountToUsd: 210,
          enabled: true,
          ...(currency ? { currencyCodeFrom: currency } : {}),
        }),
      { initialProps: {} as { currency?: string } },
    );

    await waitFor(() => expect(mocks.getMethods).toHaveBeenCalledTimes(1));
    rerender({ currency: "BRL" });
    await waitFor(() => expect(mocks.getMethods).toHaveBeenCalledTimes(2));
    expect(methodsCallArgs(1)).toMatchObject({ proposedCurrencyCodeFrom: "BRL" });
  });

  // @rule POO-1512's one-resolution-per-flow rule, unchanged by the control: the QUOTE pins what the
  // METHODS call ECHOED, never the buyer's raw proposal. A refused proposal must not leave the rows
  // in the server's currency and the charge in the buyer's.
  it("pins the quote to the currency the server ECHOED, not to the proposal", async () => {
    mocks.getMethods.mockResolvedValue({
      ok: true,
      // The server refused JPY (not in the supported set) and answered with the resolved default.
      currencyCodeFrom: "EUR",
      methods: [CARD],
    });
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    renderHook(() =>
      useBuyRouteQuote({ amountToUsd: 210, enabled: true, currencyCodeFrom: "JPY" }),
    );

    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalled());
    expect(quoteCallBody()).toMatchObject({ currencyCodeFrom: "EUR" });
  });

  /**
   * @rule POO-1576/POO-1630: the reload has to be VISIBLE.
   *
   * The list is cleared the moment the currency changes, which is right (the old rows belong to the
   * old currency, and leaving them is the POO-1513 stale-charge class in another shape). What was
   * missing is the discriminator that tells "still arriving" apart from "the provider returned
   * nothing": with only the empty list to read, a picker mid-reload accuses the provider of an
   * outage it is not having.
   */
  it("reports the list as loading while a fetch is in flight, and not after", async () => {
    let settle: ((value: unknown) => void) | undefined;
    mocks.getMethods.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    mocks.getQuote.mockResolvedValue(quoteCharging(214.3));

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    await waitFor(() => expect(result.current.methodsLoading).toBe(true));
    expect(result.current.methods).toBeUndefined();

    await act(async () => {
      settle?.({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    });

    expect(result.current.methodsLoading).toBe(false);
    expect(result.current.methods).toEqual([CARD]);
  });

  // @rule the same discriminator has to come back DOWN on a failure, or a degraded pair renders a
  // skeleton for ever instead of the informational state the rule (Q3) requires.
  it("stops reporting loading when the list cannot be read", async () => {
    mocks.getMethods.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "no such pair" });

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: true }));

    await waitFor(() => expect(result.current.methodsLoading).toBe(false));
    expect(result.current.methods).toBeUndefined();
  });

  // @rule a suspended hook is not loading anything: nothing is in flight, so a picker that has not
  // been enabled yet must not paint a skeleton for a call nobody made.
  it("is not loading while the hook is suspended", async () => {
    mocks.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });

    const { result } = renderHook(() => useBuyRouteQuote({ amountToUsd: 210, enabled: false }));

    expect(result.current.methodsLoading).toBe(false);
    expect(mocks.getMethods).not.toHaveBeenCalled();
  });
});
