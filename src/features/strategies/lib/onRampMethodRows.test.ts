/**
 * @id PP-STR-LIB-022 (POO-1576, POO-1129)
 * @name onRampMethodRows tests
 * @implements-rules-version v2 (POO-1129 rules v1) · v1 (POO-1576 rules v1)
 *
 * The rules of one row on the "Choose how to pay" step, pinned before the screen that renders them.
 *
 * Every case here is read off frames `3c` / `3e`, as corrected by POO-1129: two methods at `$218.45`
 * with NO superlative of ours between them (D1), and a row showing `Min. $500.00` where a charge
 * would be. The rules the epic decided after this module was written have their own blocks at the
 * bottom: D2/D3's refusal, and A7-b's instant-only eligibility.
 */
import { describe, expect, it } from "vitest";
import type { OnRampPaymentMethod, OnRampQuote } from "@/lib/onramp/schemas";
import {
  buildOnRampMethodRows,
  pricedQuoteMethodsById,
  selectInstantMethods,
} from "./onRampMethodRows";

/** A method as `getOnRampPaymentMethodsAction` normalizes it. */
function method(overrides: Partial<OnRampPaymentMethod> & { paymentMethod: string }) {
  return {
    displayName: overrides.paymentMethod,
    minUsd: 0,
    minCurrencyCode: "USD",
    ...overrides,
  } satisfies OnRampPaymentMethod;
}

/** One priced entry of a LISTING quote (POO-1599: one per method the pair offers). */
function priced(id: string, amount: string) {
  return {
    id,
    name: id,
    chargeUsd: Number(amount),
    chargeAmount: amount,
    chargeCurrencyCode: "USD",
    receiveAmount: "212.000000",
    receiveCurrencyCode: "USDC-BASE",
  };
}

/** A normalized quote carrying the entries and refusals a test cares about. */
function quote(overrides: Partial<OnRampQuote>): OnRampQuote {
  return {
    quoteId: "q-1",
    currencyCodeFrom: "USD",
    currencyCodeTo: "USDC-BASE",
    requestedAmountType: "to",
    paymentMethods: [],
    paymentMethodErrors: [],
    ...overrides,
  };
}

const CARD = method({ paymentMethod: "card", displayName: "Card", labels: ["Instant"] });
const APPLE = method({ paymentMethod: "apple", displayName: "Apple Pay", labels: ["Instant"] });
const BANK = method({
  paymentMethod: "bank",
  displayName: "Bank transfer",
  minUsd: 500,
  minCurrencyCode: "USD",
});

describe("buildOnRampMethodRows (POO-1576)", () => {
  // @rule R2 — the list is UNFILTERED and keeps the vendor's own order. POO-1606 may later apply an
  // eligibility RULE over it; a filter hard-coded here would empty the step while that is undecided.
  it("[R2] renders one row per method, in the order the provider returned them", () => {
    const rows = buildOnRampMethodRows({ methods: [BANK, CARD, APPLE] });

    expect(rows.map((row) => row.id)).toEqual(["bank", "card", "apple"]);
    expect(rows.map((row) => row.name)).toEqual(["Bank transfer", "Card", "Apple Pay"]);
  });

  // @rule R3 — a row's charge is matched BY ID, never by position (POO-1413: Paybis has answered
  // about a method we did not ask about, and a positional read prints one method's charge under
  // another's name on a money screen).
  it("[R3] takes each row's charge from the quote entry with the SAME id", () => {
    const rows = buildOnRampMethodRows({
      methods: [CARD, APPLE],
      // Deliberately reversed: a positional reader would swap the two figures.
      quote: quote({ paymentMethods: [priced("apple", "230.10"), priced("card", "218.45")] }),
    });

    expect(rows[0]?.charge).toEqual({ amount: 218.45, currencyCode: "USD" });
    expect(rows[1]?.charge).toEqual({ amount: 230.1, currencyCode: "USD" });
  });

  // @rule R4 — POO-1129 D1: there is NO superlative of ours beside a money figure. The row carries
  // the vendor's labels and its own charge, and nothing this app computed about which is best.
  it("[R4] makes no best-price claim on any row, at any tie", () => {
    const rows = buildOnRampMethodRows({
      methods: [CARD, APPLE, method({ paymentMethod: "sepa", displayName: "SEPA" })],
      quote: quote({
        paymentMethods: [
          priced("card", "218.45"),
          priced("apple", "218.4500"),
          priced("sepa", "230.00"),
        ],
      }),
    });

    for (const row of rows) expect(row).not.toHaveProperty("bestPrice");
  });

  // @rule R6 — frame 3e: the row the quote could not price shows its MINIMUM where the charge would
  // be, keeps its radio and stays selectable. `unpriced` is what the step's notice and its
  // blocked-intent event both key on.
  it("[R6] marks a row the quote priced nothing for, and carries its own minimum", () => {
    const rows = buildOnRampMethodRows({
      methods: [CARD, BANK],
      quote: quote({ paymentMethods: [priced("card", "218.45")] }),
    });

    expect(rows[1]).toMatchObject({
      id: "bank",
      unpriced: true,
      minimum: { amount: 500, currencyCode: "USD" },
    });
    expect(rows[1]?.charge).toBeUndefined();
  });

  // @rule R6 — the vendor's OWN refusal (POO-1599 `paymentMethodErrors`) is the authority, even when
  // a figure still sits beside it. The party that refused outranks the number.
  it("[R6] treats a method the provider refused as unpriced, charge or no charge", () => {
    const rows = buildOnRampMethodRows({
      methods: [CARD, BANK],
      quote: quote({
        paymentMethods: [priced("card", "218.45"), priced("bank", "212.00")],
        paymentMethodErrors: [{ paymentMethod: "bank" }],
      }),
    });

    expect(rows[1]?.unpriced).toBe(true);
    expect(rows[1]?.charge).toBeUndefined();
    /**
     * And the refusal does NOT block it, even though its $500 floor is plainly above the $212.00
     * figure the vendor sent beside the refusal. Pinned deliberately, because it is the sharpest
     * edge of [R7]'s tier-1-only boundary: stripping the charge is what makes the row uncomparable,
     * so the row stays selectable and its floor is answered at the checkout. `/deposit` behaves the
     * same way for the same method and the same order (AC6), and closing this belongs in ONE change
     * across both screens rather than unilaterally here.
     */
    expect(rows.map((row) => row.blocked)).toEqual([false, false]);
  });

  // @rule R6 — NOTHING priced is not the same fact as "this one was refused". The gas-first leg
  // publishes no quote at all (its target is solved at mint time), and every row reading "blocked"
  // there would be a claim the app cannot support.
  it("[R6] marks no row unpriced when the quote priced nothing at all", () => {
    const rows = buildOnRampMethodRows({ methods: [CARD, BANK] });

    expect(rows.map((row) => row.unpriced)).toEqual([false, false]);
    // The minimum is still the method's own fact, and still worth showing.
    expect(rows[1]?.minimum).toEqual({ amount: 500, currencyCode: "USD" });
  });

  // @rule R5 — labels are the vendor's, verbatim, in the order sent. Rendered, never branched on
  // (POO-1603 [R3]); a blank one names nothing and is dropped rather than rendered as an empty chip.
  it("[R5] carries the vendor's labels verbatim and drops the blank ones", () => {
    const rows = buildOnRampMethodRows({
      methods: [method({ paymentMethod: "card", labels: ["Instant", "  ", "Popular"] })],
    });

    expect(rows[0]?.labels).toEqual(["Instant", "Popular"]);
  });

  // @rule R3 — a minimum of zero is "no minimum", not a `Min. $0.00` row.
  it("[R3] omits a minimum the provider did not set", () => {
    const rows = buildOnRampMethodRows({ methods: [CARD] });

    expect(rows[0]?.minimum).toBeUndefined();
  });
});

/**
 * DISPLAY ALL OPTIONS REGARDLESS (Rafael, 2026-08-14): "A method is never hidden - not when it is
 * unpriced, not when its minimum exceeds the order, not when it is blocked."
 *
 * The three cases arrive by three different mechanisms and each has its own way of vanishing, so the
 * invariant is asserted at the level that decides it. Pinned HERE, in the pure helper, because this
 * is the one both surfaces share: a filter added on either screen would be a rule the other does not
 * have, which is precisely how `/deposit` and provisioning last disagreed.
 *
 * The identifiers are the LIVE sandbox capture (2026-08-14), conventions and all: the wire mixes
 * `poolparty-credit-card` with `poolparty_apm_bridgerpay_skrill`, so nothing may assume one shape.
 */
describe("buildOnRampMethodRows — every option is offered (POO-1576)", () => {
  const LIVE_CARD = method({
    paymentMethod: "poolparty-credit-card",
    displayName: "Credit/Debit Card",
    minUsd: 10,
    labels: ["instant"],
  });
  /** Its own floor is above the order: frame `3e`'s row. */
  const LIVE_BANK = method({
    paymentMethod: "poolparty-trustly",
    displayName: "Online Banking",
    minUsd: 500,
    labels: ["low-fee", "high-approval-rate"],
  });
  /** The vendor REFUSED this one by name, which is a different fact from an absent charge. */
  const LIVE_SKRILL = method({
    paymentMethod: "poolparty_apm_bridgerpay_skrill",
    displayName: "Skrill",
    minUsd: 10,
    labels: ["high-approval-rate", "instant"],
  });
  /** The quote never mentioned this one at all: no charge, no refusal, no floor above the order. */
  const LIVE_NETELLER = method({
    paymentMethod: "poolparty_bridgerpay_neteller",
    displayName: "Neteller",
    minUsd: 10,
    labels: ["high-approval-rate", "instant"],
  });

  it("keeps the unpriced, the refused and the minimum-exceeded, all of them", () => {
    const rows = buildOnRampMethodRows({
      methods: [LIVE_CARD, LIVE_BANK, LIVE_SKRILL, LIVE_NETELLER],
      quote: quote({
        paymentMethods: [priced("poolparty-credit-card", "218.45")],
        paymentMethodErrors: [{ paymentMethod: "poolparty_apm_bridgerpay_skrill" }],
      }),
    });

    expect(rows.map((row) => row.id)).toEqual([
      "poolparty-credit-card",
      "poolparty-trustly",
      "poolparty_apm_bridgerpay_skrill",
      "poolparty_bridgerpay_neteller",
    ]);
    // Each one still carries what it can say: a floor is a fact about the METHOD and survives a row
    // the order cannot use, and only the CHARGE is ever absent.
    expect(rows[1]).toMatchObject({
      minimum: { amount: 500, currencyCode: "USD" },
      unpriced: true,
    });
    // The key is OMITTED rather than set to `undefined`, which is the shape the row builder emits.
    expect(rows[2]?.charge).toBeUndefined();
    expect(rows[2]?.unpriced).toBe(true);
    expect(rows[3]?.charge).toBeUndefined();
    expect(rows[3]?.unpriced).toBe(true);
    // And none of the four is BLOCKED. Three carry no charge at all, so tier 1 has nothing to
    // compare, and the fourth clears its own floor. `LIVE_BANK`'s $500 floor against a $212 order is
    // exactly the row tier 2 would refuse and tier 1 cannot, which is the boundary [R7] records.
    expect(rows.filter((row) => row.blocked)).toEqual([]);
  });

  // @rule POO-1603 [R3]: labels are the vendor's, verbatim and in the vendor's order, and a method
  // may carry several. The only three that exist are `instant`, `low-fee` and `high-approval-rate`,
  // ALL positive: a slow rail simply omits `instant`, so absence is the only slowness signal there
  // is and nothing may synthesise one.
  it("carries every label the provider sent, in order, and invents none", () => {
    const rows = buildOnRampMethodRows({ methods: [LIVE_BANK, LIVE_SKRILL] });

    expect(rows[0]?.labels).toEqual(["low-fee", "high-approval-rate"]);
    expect(rows[1]?.labels).toEqual(["high-approval-rate", "instant"]);
  });
});

/**
 * POO-1129 D2/D3: a method whose own charge is below its own floor BLOCKS. The charge is never
 * raised ("a cobrança nunca é elevada"), so the row states what the provider needs and refuses the
 * selection, and the order the buyer set never moves.
 *
 * The comparison is POO-1609's TIER 1 and only tier 1, which is what `/deposit` shipped in PR #897:
 * row R's own charge against row R's own floor, both denominated in the currency the flow resolved.
 * Tier 2 (the entered amount against the floor of an UNPRICED row) is deliberately absent here, for
 * the reason recorded on the branch: AC6 requires the two screens to agree for the same method and
 * the same order, and `/deposit` does not block a row it has no charge for.
 */
describe("buildOnRampMethodRows — a row below its floor blocks (POO-1129 D2/D3)", () => {
  /** A card the buyer can normally use, whose floor this particular order misses. */
  const SMALL_CARD = method({
    paymentMethod: "card",
    displayName: "Card",
    minUsd: 500,
    minCurrencyCode: "USD",
    labels: ["instant"],
  });

  it("[D3] blocks a row whose own charge is below its own floor", () => {
    const rows = buildOnRampMethodRows({
      methods: [SMALL_CARD, APPLE],
      quote: quote({
        paymentMethods: [priced("card", "218.45"), priced("apple", "218.45")],
      }),
    });

    expect(rows[0]).toMatchObject({ id: "card", blocked: true });
    expect(rows[1]).toMatchObject({ id: "apple", blocked: false });
  });

  // The row stays in the provider's own order and keeps everything it can say. Hiding it, or
  // sinking it to the bottom, removes the buyer's only way to learn the method exists and what it
  // would take to reach it (POO-1576 Q2 survives the reversal; only the raise died).
  it("[D3] keeps a blocked row in its own position, with its own floor", () => {
    const rows = buildOnRampMethodRows({
      methods: [SMALL_CARD, APPLE],
      quote: quote({
        paymentMethods: [priced("card", "218.45"), priced("apple", "218.45")],
      }),
    });

    expect(rows.map((row) => row.id)).toEqual(["card", "apple"]);
    expect(rows[0]?.minimum).toEqual({ amount: 500, currencyCode: "USD" });
  });

  /**
   * FAIL OPEN across a currency boundary. The floor rides the METHODS call's `minCurrencyCode` and
   * the charge rides the QUOTE's `chargeCurrencyCode`, so the comparison spans two calls and this
   * app has no FX source at all (POO-333). POO-1609's chosen direction: "a method wrongly blocked
   * removes an option the buyer could have used, while a method wrongly offered is recoverable at
   * checkout."
   */
  it("[D3] never blocks when the floor and the charge are in different currencies", () => {
    const rows = buildOnRampMethodRows({
      methods: [method({ paymentMethod: "sepa", minUsd: 500, minCurrencyCode: "EUR" })],
      quote: quote({ paymentMethods: [priced("sepa", "218.45")] }),
    });

    expect(rows[0]?.blocked).toBe(false);
  });

  // Same rule, read the other way: a code that differs only in case is the same currency, and a
  // blank code names none at all, so it cannot license a comparison.
  it("[D3] compares currency codes case-insensitively, and refuses a blank one", () => {
    const [lower] = buildOnRampMethodRows({
      methods: [method({ paymentMethod: "card", minUsd: 500, minCurrencyCode: "usd" })],
      quote: quote({ paymentMethods: [priced("card", "218.45")] }),
    });
    expect(lower?.blocked).toBe(true);

    const [blank] = buildOnRampMethodRows({
      methods: [method({ paymentMethod: "card", minUsd: 500, minCurrencyCode: "  " })],
      quote: quote({ paymentMethods: [priced("card", "218.45")] }),
    });
    expect(blank?.blocked).toBe(false);
  });

  /**
   * An UNPRICED row is not a blocked one. This is the tier-1-only boundary stated as a test rather
   * than left implicit: the vendor refused to price it, or simply did not mention it, and neither
   * is a charge we can hold against a floor.
   */
  it("[D3] never blocks a row the quote carries no charge for", () => {
    const rows = buildOnRampMethodRows({
      methods: [CARD, BANK],
      quote: quote({ paymentMethods: [priced("card", "218.45")] }),
    });

    expect(rows[1]).toMatchObject({ id: "bank", unpriced: true, blocked: false });
  });

  // A floor of zero is "no floor", not "a floor of nothing", and a charge of zero is a figure we
  // failed to read rather than a free purchase. Neither may block.
  it("[D3] never blocks on an absent floor or an unreadable charge", () => {
    const [noFloor] = buildOnRampMethodRows({
      methods: [method({ paymentMethod: "card", minUsd: 0 })],
      quote: quote({ paymentMethods: [priced("card", "218.45")] }),
    });
    expect(noFloor?.blocked).toBe(false);

    const [noCharge] = buildOnRampMethodRows({
      methods: [method({ paymentMethod: "card", minUsd: 500 })],
      quote: quote({ paymentMethods: [priced("card", "0")] }),
    });
    expect(noCharge?.blocked).toBe(false);
  });

  // The boundary itself: a charge EQUAL to the floor clears it. The floor is a minimum, not a
  // threshold to exceed, and blocking on equality would refuse the exact order the vendor accepts.
  it("[D3] clears the floor on an exact match", () => {
    const rows = buildOnRampMethodRows({
      methods: [method({ paymentMethod: "card", minUsd: 500 })],
      quote: quote({ paymentMethods: [priced("card", "500.00")] }),
    });

    expect(rows[0]?.blocked).toBe(false);
  });
});

/**
 * POO-1129 A7-b: non-instant methods are OUT of the first iteration.
 *
 * > "Defer both, we will add non-instant as an improvement in the future, not at the first
 * > iteration."
 *
 * ELIGIBILITY, and deliberately not presentation. POO-1603 [R3] lets a consumer RENDER a vendor
 * label and forbids it from BRANCHING on one, and that rule still governs the chip: this function is
 * the one place the app is allowed to read a label's VALUE, because it is answering "may this method
 * be offered at all", not "how does this row look".
 */
describe("selectInstantMethods (POO-1129 A7-b)", () => {
  const INSTANT = method({ paymentMethod: "card", labels: ["high-approval-rate", "instant"] });
  const SLOW = method({ paymentMethod: "bank", labels: ["low-fee", "high-approval-rate"] });
  const UNLABELLED = method({ paymentMethod: "sepa" });

  it("[A7-b] keeps only the methods the vendor calls instant, in the vendor's order", () => {
    const result = selectInstantMethods([SLOW, INSTANT, UNLABELLED]);

    expect(result.methods.map((entry) => entry.paymentMethod)).toEqual(["card"]);
    expect(result.failedOpen).toBe(false);
  });

  // The captured vocabulary is lowercase and hyphenated, and the mocks spell it `Instant`. Matching
  // exactly one casing would empty the step against one of the two, which is the failure the
  // fail-open below exists to survive and this match exists to avoid.
  it("[A7-b] matches the label regardless of case or surrounding space", () => {
    const result = selectInstantMethods([
      method({ paymentMethod: "a", labels: ["Instant"] }),
      method({ paymentMethod: "b", labels: [" INSTANT "] }),
    ]);

    expect(result.methods.map((entry) => entry.paymentMethod)).toEqual(["a", "b"]);
  });

  /**
   * FAIL OPEN, and this is the whole point of the function returning a flag rather than a list.
   *
   * The captured vocabulary is `instant` / `low-fee` / `high-approval-rate`, ALL positive. "Not
   * instant" is an ABSENCE and never an assertion, so a set that carries no `instant` at all is far
   * more likely to be a vocabulary we have not captured than a world in which no method settles
   * instantly. A filter that matches nothing is worse than no filter: it empties the step.
   */
  it("[A7-b] shows every method, and says so, when NOTHING carries the label", () => {
    const result = selectInstantMethods([SLOW, UNLABELLED]);

    expect(result.methods.map((entry) => entry.paymentMethod)).toEqual(["bank", "sepa"]);
    expect(result.failedOpen).toBe(true);
  });

  // An empty list is not a filter that failed, it is a list that is empty. Reporting it as a
  // fail-open would fire the alarm on every buyer whose provider returned nothing (Q3's own state).
  it("[A7-b] reports no fail-open for a list that was empty to begin with", () => {
    expect(selectInstantMethods([])).toEqual({ methods: [], failedOpen: false });
  });
});

/**
 * @rule R9 — POO-1666, built from the REAL production payloads (trace 726e00a1...).
 *
 * Paybis returns the same method as priced AND refused in one response. Both fixtures below are
 * captured verbatim from prod on 2026-08-17, and they are a controlled pair: same method, same pair,
 * 27 minutes apart, one minted 201 and one 422'd with "There are no available payment/payout methods
 * in Quote". The discriminator is `paymentMethodErrors`, and it is available BEFORE the mint.
 */
describe("pricedQuoteMethodsById — the refused-but-priced method (POO-1666)", () => {
  /** The 10-USDC quote that FAILED. Card is in BOTH arrays. */
  const refusedQuote = {
    quoteId: "609a542a-9329-4f59-91e6-3dabb3f2203b",
    currencyCodeFrom: "EUR",
    paymentMethods: [
      {
        id: "pool-party-credit-card",
        chargeUsd: 10.53,
        chargeAmount: "10.53",
        chargeCurrencyCode: "EUR",
      },
    ],
    paymentMethodErrors: [
      {
        paymentMethod: "pool-party-credit-card",
        message: "You have to buy or sell at least 10.003001 USDC per order",
      },
    ],
  } as unknown as OnRampQuote;

  /** The 11-USDC quote that SUCCEEDED. No `paymentMethodErrors` at all. */
  const acceptedQuote = {
    quoteId: "38995e92-a332-48c0-a46c-3da6e7ae1478",
    currencyCodeFrom: "EUR",
    paymentMethods: [
      {
        id: "pool-party-credit-card",
        chargeUsd: 11.39,
        chargeAmount: "11.39",
        chargeCurrencyCode: "EUR",
      },
    ],
    paymentMethodErrors: [],
  } as unknown as OnRampQuote;

  it("treats a method named in paymentMethodErrors as NOT offered, even though it is priced", () => {
    // The whole defect in one assertion: `paymentMethods` is non-empty and the method carries a real
    // EUR 10.53 charge, so every emptiness check passes and the mint used to send this quoteId.
    expect(refusedQuote.paymentMethods).toHaveLength(1);
    expect(pricedQuoteMethodsById(refusedQuote).size).toBe(0);
  });

  it("offers the method when the provider raised no error for it", () => {
    expect(pricedQuoteMethodsById(acceptedQuote).get("pool-party-credit-card")).toBeDefined();
  });

  it("offers nothing for an absent quote, rather than throwing", () => {
    expect(pricedQuoteMethodsById(undefined).size).toBe(0);
  });
});
