/**
 * @id PP-CORE-LIB-096 (POO-1512, POO-1601)
 * @name currencyPairs tests
 * @implements-rules-version v2 (POO-1601 rules v1) · v1 (POO-1512 rules v1)
 *
 * [R1]/[R2]/[R3] the set of fiat currencies Paybis will actually sell a given crypto for, parsed from
 * `on-ramp/currency-pairs-to-buy`.
 *
 * ## Every assertion below runs against a RECORDED response, not a sample
 *
 * The previous version of this file was built from a hand-written literal copied out of the API repo's
 * spec, and it passed for five days while production billed every buyer in USD. A fixture written by
 * the same person who wrote the parser validates the parser against that person's belief; it cannot
 * discover that the belief is wrong. So the payload here is
 * {@link ./fixtures/currencyPairsToBuy.dev.capture.json}, recorded off the live endpoint, and the only
 * literals in this file are the two normalization cases (casing) that no capture can exhibit.
 *
 * It is the DEV/sandbox response, so its crypto codes are testnet and there is no `USDC-BASE` in it at
 * all. Its SHAPE is the contract, and the shape is produced by our own NestJS controller, which is the
 * same build in production. That asymmetry is used deliberately below: the absence of `USDC-BASE` from
 * a sandbox capture is what makes the exact-match test evidence rather than a stipulation.
 *
 * ## The capture is PRE-MAPPING, deliberately, and is NOT what dev answers today (POO-1626)
 *
 * It was recorded 2026-08-14 at 16:02 (commit `ae38edac`). pool-party-api's POO-1605 landed the same
 * day at 19:00 and now restores production codes on the way back out of `getCurrencyPairsToBuy`, so
 * the same dev endpoint answers `USDC-BASE` / `ETH-BASE` where this file holds `USDC-SEPOLIA` /
 * `ETH-SEPOLIA`. Anyone reading this fixture as a snapshot of live dev will be three hours out of date.
 *
 * Checked and KEPT rather than re-recorded, for two reasons. The mapping rewrites string VALUES only
 * (`sandbox-currency-map.ts` `restore()` never touches a key and never changes the tree), so the SHAPE
 * this file exists to pin is byte-for-byte the shape a post-mapping capture would have: re-recording
 * would buy nothing on the contract. And it would COST the evidence in the `[R3]` test below, which
 * leans on `USDC-BASE` being genuinely absent from a real payload; a post-mapping capture contains it,
 * turning that assertion back into the stipulation this file was rewritten to stop being.
 */

import { describe, expect, it } from "vitest";
import { onRampCurrencyPairsResponseSchema, supportedFiatFor } from "./currencyPairs";
import capture from "./fixtures/currencyPairsToBuy.dev.capture.json";

/**
 * What the schema ACTUALLY sees. `apiFetch` strips the NestJS `{ data }` envelope before validating
 * (`client.ts` `maybeUnwrap`), so the fixture keeps the envelope (that is what the wire sends) and the
 * tests unwrap it exactly where the client does.
 */
const RECORDED: unknown = capture.data;

/**
 * The testnet spelling of the pair the investor app buys, as the capture recorded it. The app itself
 * never holds this code: it asks for `USDC-BASE` everywhere, and since POO-1605 pool-party-api does the
 * substituting at the vendor boundary.
 */
const RECORDED_USDC = "USDC-SEPOLIA";

describe("onRampCurrencyPairsResponseSchema", () => {
  it("[R1] parses the recorded live response", () => {
    // The whole defect in one assertion: this returned `success: false` with
    // `{ path: [0, "from"], message: "Required" }`, `readSupportedFiat` swallowed the throw, and every
    // buyer on earth was charged in dollars.
    const parsed = onRampCurrencyPairsResponseSchema.safeParse(RECORDED);
    expect(parsed.success).toBe(true);
  });

  it("[R1] rejects the FLAT shape the shipped schema expected, and names the drifted path", () => {
    // The regression lock, and per-group tolerance ([R4]) must NOT weaken it. `{ from, to }` at the
    // top level is the upstream Paybis body, which our own controller wraps in payment-method groups.
    // If this ever parses again, the union in `supportedFiatFor` silently returns nothing and POO-1512
    // un-ships itself. Every group is unreadable here, so tolerance does not apply and the failure is
    // hard, carrying the real path `0.pairs` that `describePairsFailure` prints.
    const flat = [{ from: "USD", to: [{ currency: "USDC", currencyCode: RECORDED_USDC }] }];
    const parsed = onRampCurrencyPairsResponseSchema.safeParse(flat);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    expect(parsed.error.issues.map((issue) => issue.path.join("."))).toContain("0.pairs");
  });

  it("[R1] rejects the envelope arriving unstripped", () => {
    // The POO-1368 failure mode: an object where an array was expected.
    expect(onRampCurrencyPairsResponseSchema.safeParse(capture).success).toBe(false);
  });

  it("[R1] rejects a body that is not an array of objects at all", () => {
    // The other end of the tolerance: skipping unreadable GROUPS may not become skipping an
    // unreadable BODY. `readSupportedFiat` reports these; a body that parses to nothing reports
    // nothing, which is the silence POO-1601 is about.
    for (const body of [null, "[]", 42, [null], ["poolparty-credit-card"], [[]]]) {
      expect(onRampCurrencyPairsResponseSchema.safeParse(body).success).toBe(false);
    }
  });

  it("[R4] one unreadable group costs its own row, not every buyer's currency", () => {
    // The second route to the POO-1601 outage: `z.array(group)` makes the 21 groups a single unit, so
    // ONE vendor group missing `pairs` invalidates the whole response, `readSupportedFiat` catches,
    // and every buyer on earth is charged USD again. The same class blanked the whole portfolio
    // dashboard once already, from a strict record on a dead field. The good groups must still answer.
    const mixed = [
      {
        name: "poolparty-credit-card",
        pairs: [{ from: "EUR", to: [{ currencyCode: RECORDED_USDC }] }],
      },
      { name: "poolparty_bridgerpay_flutterwave_kenya", displayName: "M-Pesa" },
      {
        name: "poolparty_bridgerpay_directa24_pix",
        pairs: [{ to: [{ currencyCode: RECORDED_USDC }] }],
      },
      {
        name: "poolparty_bridgerpay_astropay",
        pairs: [{ from: "IDR", to: [{ currencyCode: RECORDED_USDC }] }],
      },
    ];
    const parsed = onRampCurrencyPairsResponseSchema.safeParse(mixed);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("unreachable");
    expect(supportedFiatFor(parsed.data, RECORDED_USDC)).toEqual(new Set(["EUR", "IDR"]));
  });

  it("[R4] an honestly empty list is not an unreadable one", () => {
    // `resolveOnRampCurrency` reports `pairs: "empty"` and `pairs: "unreadable"` as opposite
    // diagnoses (POO-1601 [R6]), so an empty array has to stay parseable for `empty` to be reachable.
    const parsed = onRampCurrencyPairsResponseSchema.safeParse([]);
    expect(parsed.success).toBe(true);
  });

  it("[R4] tolerates keys the vendor adds beside the ones we read", () => {
    const withExtras = [
      {
        name: "poolparty-credit-card",
        displayName: "Credit/Debit Card",
        minimumAmount: "20",
        pairs: [
          { from: "EUR", to: [{ currency: "USDC", currencyCode: RECORDED_USDC, decimals: 6 }] },
        ],
      },
    ];
    expect(onRampCurrencyPairsResponseSchema.safeParse(withExtras).success).toBe(true);
  });
});

describe("supportedFiatFor", () => {
  const parsed = onRampCurrencyPairsResponseSchema.parse(RECORDED);

  it("[R2] returns every fiat that can buy the requested crypto", () => {
    const supported = supportedFiatFor(parsed, RECORDED_USDC);
    // Recorded, not chosen: 50 fiats across 21 payment-method groups.
    expect(supported.size).toBe(50);
    expect(supported.has("EUR")).toBe(true);
    expect(supported.has("BRL")).toBe(true);
    expect(supported.has("USD")).toBe(true);
  });

  it("[R2] unions across ALL payment methods, not just the first", () => {
    // `IDR`, `VND` and `XOF` are sold by exactly ONE group in the capture (AstroPay, index 6) and by
    // no other. A reader that stopped at `data[0]`, the credit-card group, would drop them, which is
    // the same class of mistake as reading the wrong nesting level: an answer that looks plausible.
    const supported = supportedFiatFor(parsed, RECORDED_USDC);
    for (const fiat of ["IDR", "VND", "XOF"]) expect(supported.has(fiat)).toBe(true);
  });

  it("[R2] BRL, the reported buyer's own currency, is reachable", () => {
    // Named for what it proves, which is NOT the union. THREE groups in the capture carry BRL for
    // `USDC-SEPOLIA`: 0 `poolparty-credit-card`, 3 `poolparty_bridgerpay_directa24_pix` and
    // 6 `poolparty_bridgerpay_astropay`. So this case would pass unchanged against a reader that
    // stopped at `data[0]`; the union is proven by the IDR/VND/XOF case above, where AstroPay is the
    // sole carrier and a first-group reader loses all three. What this locks instead is the currency
    // the live report was filed about: BRL must be in the set at all, because a fiat missing here is a
    // buyer silently repriced in USD. Which methods they are then OFFERED is decided by
    // `on-ramp/payment-methods?currencyFrom=BRL`, a different call.
    expect(supportedFiatFor(parsed, RECORDED_USDC).has("BRL")).toBe(true);
  });

  it("[R3] identifies the crypto by `currencyCode`, never by `currency`", () => {
    // Both fields are on every one of the 4985 targets in the capture, and they are EQUAL on 3347 of
    // them (`DOGE`, `SOL`, `XRP` — anything chainless). That is why reading `currency` looks harmless:
    // it fails only on network-qualified assets, which is exactly and only what this app buys.
    expect(supportedFiatFor(parsed, "USDC").size).toBe(0);
    expect(supportedFiatFor(parsed, RECORDED_USDC).size).toBe(50);
  });

  it("[R3] matches the crypto code EXACTLY, never by prefix", () => {
    // Evidence rather than stipulation: the sandbox this was captured from sells `USDC-SEPOLIA` and no
    // Base pair at all, so a `startsWith` would hand every sandbox fiat to a production `USDC-BASE`
    // lookup. POO-1605 later put a code mapping in pool-party-api, so LIVE dev now answers `USDC-BASE`
    // here; that is why the capture is deliberately kept at its pre-mapping recording (see the header).
    expect(supportedFiatFor(parsed, "USDC-BASE").size).toBe(0);
  });

  it("[R3] is case-insensitive on the crypto it is asked for", () => {
    expect(supportedFiatFor(parsed, RECORDED_USDC.toLowerCase()).size).toBe(50);
  });

  it("returns an empty set when nothing sells the crypto", () => {
    expect(supportedFiatFor(parsed, "USDC-ARBITRUM").size).toBe(0);
  });

  it("upper-cases the fiat codes it returns", () => {
    // `resolveBuyerCurrency` compares against upper-case ISO-4217, so the set must be normalized. The
    // capture is uniformly upper-case, which is precisely why this one case has to be written by hand.
    const lowercased = onRampCurrencyPairsResponseSchema.parse([
      {
        name: "poolparty-credit-card",
        displayName: "Credit/Debit Card",
        pairs: [{ from: "eur", to: [{ currency: "USDC", currencyCode: "usdc-sepolia" }] }],
      },
    ]);
    expect(supportedFiatFor(lowercased, RECORDED_USDC)).toEqual(new Set(["EUR"]));
  });

  it("returns an empty set for a payment method that sells nothing", () => {
    // A group with no pairs must contribute nothing rather than throw: a vendor disabling a rail is a
    // routine event and it may not cost every buyer their currency.
    const empty = onRampCurrencyPairsResponseSchema.parse([
      { name: "poolparty-trustly", displayName: "Online Banking", pairs: [] },
    ]);
    expect(supportedFiatFor(empty, RECORDED_USDC).size).toBe(0);
  });
});
