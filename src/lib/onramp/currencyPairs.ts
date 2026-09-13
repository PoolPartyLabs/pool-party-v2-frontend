/**
 * @id PP-CORE-LIB-096 (POO-1512, POO-1601)
 * @name currencyPairs
 * @implements-rules-version v2 (POO-1601 rules v1) · v1 (POO-1512 rules v1)
 *
 * Which fiat currencies Paybis will actually sell a given crypto for ([R2]/[R3]).
 *
 * ## Why this exists
 *
 * `resolveBuyerCurrency` can map a country to a currency, but a currency Paybis does not sell the
 * pair for produces a dead quote. This is the validation step between the two: the set of fiat codes
 * that can buy the target crypto, read from `GET on-ramp/currency-pairs-to-buy`.
 *
 * ## The shape, settled 2026-08-14 against a RECORDED response (POO-1601)
 *
 * The response is an array of **payment-method groups**, and the fiat lives one level down inside
 * each group's `pairs`:
 *
 * ```json
 * [{ "name": "poolparty_bridgerpay_directa24_pix", "displayName": "PIX",
 *    "pairs": [{ "from": "BRL", "to": [{ "currency": "USDC", "currencyCode": "USDC-SEPOLIA" }] }] }]
 * ```
 *
 * The previous version of this file expected a FLAT `[{ from, to }]` and could not parse a single
 * response. `readSupportedFiat` caught the `ApiParseError`, returned `null`, and `resolveBuyerCurrency`
 * answered USD from its `!supported` branch **before consulting any country**. So POO-1512 shipped, and
 * then POO-1573 shipped on top of it, while every buyer on earth was still billed in dollars and
 * offered the dollar payment-method set: no SEPA, no Pix. Three identical reports over five days.
 *
 * The trap this file's old header warned about was real; it just fired from the other side. The API
 * repo's `CurrencyPairsToBuyResponseDto` was CORRECT, and the "capture" that was trusted over it
 * (`paybis.service.spec.ts:209`) is a hand-written sample of the **upstream Paybis** body, which our
 * own NestJS controller wraps. A spec fixture settles what a service returns under test, which is a
 * different question from what the wire returns. The lesson generalised: the fixture the tests here run
 * against is now {@link ./fixtures/currencyPairsToBuy.dev.capture.json}, recorded from the live
 * endpoint. Do not replace it with a literal.
 *
 * ## The crypto identity is `currencyCode`, not `currency` ([R3])
 *
 * Each target carries BOTH: `currency` is the bare asset (`"USDC"`) and `currencyCode` is
 * network-qualified (`"USDC-BASE"`, `"USDC-ARBITRUM"`, `"USDC-SEPOLIA"`). `currencyCodeTo` is already
 * spelled in the second namespace, so `currencyCode` is the one to match. In the recorded capture the
 * two fields are EQUAL on 3347 of 4985 targets (every chainless asset: `DOGE`, `SOL`, `XRP`), which is
 * what makes reading `currency` look harmless: it fails only on network-qualified assets, and those
 * are exactly and only what this app buys.
 *
 * POO-1626: an earlier version of this paragraph glossed the split as "`USDC-SEPOLIA` in sandbox,
 * `USDC-BASE` in production". That is no longer what this module receives. pool-party-api (POO-1605)
 * restores production codes on the way out of `on-ramp/currency-pairs-to-buy` whenever `PAYBIS_API`
 * points at sandbox, so this parser reads `USDC-BASE` in EVERY environment; only the committed capture,
 * recorded before that landed, still spells the testnet codes.
 *
 * The seam itself is marked where the call is made ({@link ./resolveOnRampCurrency}, cached 1h against
 * `GET /api/v1/on-ramp/currency-pairs-to-buy`, Paybis `/v2/currency/pairs/buy-crypto` behind it). This
 * module is pure: it owns the CONTRACT, not the call.
 */

import { z } from "zod";

/**
 * One crypto a fiat can buy.
 *
 * `currency` is deliberately NOT in this schema even though the wire sends it: it is the bare asset
 * name, it can never match a `currencyCodeTo`, and having it here invites the next reader to compare
 * against it. Unknown keys are stripped by zod, so leaving it out costs nothing and removes the
 * ambiguity that produced POO-1601.
 */
const wirePairTargetSchema = z.object({
  currencyCode: z.string().min(1),
});

/** One fiat and everything it buys THROUGH ONE PAYMENT METHOD. `from` is the FIAT side. */
const wireCurrencyPairSchema = z.object({
  from: z.string().min(1),
  to: z.array(wirePairTargetSchema),
});

/**
 * One payment method and the pairs it settles. `name`/`displayName` are on the wire and are not read
 * here: which methods a buyer is offered comes from `on-ramp/payment-methods?currencyFrom=`, keyed on
 * the currency this module helps resolve. Requiring `pairs` is what pins the nesting, so a regression
 * to the flat shape fails loudly instead of unioning nothing.
 */
const wirePaymentMethodGroupSchema = z.object({
  pairs: z.array(wireCurrencyPairSchema),
});

/**
 * The raw `currency-pairs-to-buy` response: a bare array of payment-method groups. `apiFetch` unwraps
 * our own `{ data }` envelope, and the API already unwraps Paybis', so by the time it reaches here both
 * are gone. An object arriving instead of an array is the POO-1368 failure and must not parse.
 *
 * ## One bad group costs its own row, not every buyer's currency ([R4])
 *
 * A plain `z.array(wirePaymentMethodGroupSchema)` makes the 21 groups a single unit: one vendor group
 * missing `pairs`, or one pair missing `from`, and the WHOLE array is invalid, `readSupportedFiat`
 * catches, and every buyer on earth is charged USD. That is the exact outage POO-1601 exists to fix,
 * reachable a second way, and this repo has been burned by the class before (a strict zod record on a
 * dead field blanked the entire portfolio dashboard). So the ARRAY is what this schema asserts and
 * {@link supportedFiatFor} parses each group on its own, dropping the ones it cannot read: 20 good
 * groups still answer for the fiats they carry.
 *
 * Tolerance stops exactly where it would hide a contract break, which is what this refinement is for.
 * The body must be an ARRAY OF OBJECTS, so the unstripped envelope (POO-1368) does not parse; and a
 * NON-EMPTY body in which NOT ONE group is readable is a hard failure carrying the real per-group zod
 * issues, so a regression to the flat `[{ from, to }]` shape still throws, still reports, and still
 * names `0.pairs` rather than silently unioning nothing. An empty array is honestly empty and parses:
 * `resolveOnRampCurrency` reports that as `pairs: "empty"`, which is the opposite diagnosis from
 * `unreadable` and has to stay reachable.
 */
export const onRampCurrencyPairsResponseSchema = z
  .array(z.record(z.string(), z.unknown()))
  .superRefine((groups, ctx) => {
    if (groups.length === 0) return;
    const rejected: z.ZodIssue[] = [];
    for (const [index, group] of groups.entries()) {
      const result = wirePaymentMethodGroupSchema.safeParse(group);
      if (result.success) return;
      // Re-pathed to the group index, because the path is the whole diagnosis: `0.pairs` is the
      // difference between "the vendor changed" and "we read the wrong nesting level".
      for (const issue of result.error.issues) {
        rejected.push({ ...issue, path: [index, ...issue.path] });
      }
    }
    for (const issue of rejected) ctx.addIssue(issue);
  });

export type OnRampCurrencyPairsResponse = z.infer<typeof onRampCurrencyPairsResponseSchema>;

/**
 * [R2]/[R3] The fiat codes that can buy `currencyCodeTo`, upper-cased so they compare directly against
 * the ISO-4217 codes `resolveBuyerCurrency` produces.
 *
 * The UNION across every payment-method group is the answer, not the first group's list: in the
 * recorded capture `IDR`, `VND` and `XOF` reach `USDC-SEPOLIA` through exactly ONE group (AstroPay,
 * index 6) and through no other, so a reader that stopped at `data[0]` would drop them. (`BRL`, the
 * reported buyer's currency, is NOT such a case: three groups carry it, indices 0 `poolparty-credit-card`,
 * 3 `poolparty_bridgerpay_directa24_pix` and 6 `poolparty_bridgerpay_astropay`. It is the currency that
 * mattered, not the one that proves the union.) Narrowing here would be answering the wrong question:
 * which methods a buyer sees is decided later by `on-ramp/payment-methods?currencyFrom=<this currency>`,
 * and hiding a fiat here hides its whole rail from the buyer it was built for.
 *
 * The crypto match is EXACT. A prefix match would let any other `USDC-<chain>` satisfy a `USDC-BASE`
 * lookup (`USDC-ARBITRUM`, or the `USDC-SEPOLIA` the pre-POO-1605 capture is full of), and quietly
 * offer a buyer a rail that does not deliver on the chain this app then watches for the delta.
 *
 * [R4] A group that does not parse is SKIPPED, not fatal. This is where the per-group tolerance the
 * schema above describes actually happens: the loop asks each group for its own shape, so one rail the
 * vendor breaks costs its own currencies and nobody else's. The schema has already guaranteed at least
 * one group was readable, so an answer built here is never the empty set standing in for a drift.
 */
export function supportedFiatFor(
  groups: OnRampCurrencyPairsResponse,
  currencyCodeTo: string,
): Set<string> {
  const target = currencyCodeTo.toUpperCase();
  const supported = new Set<string>();
  for (const group of groups) {
    const parsed = wirePaymentMethodGroupSchema.safeParse(group);
    if (!parsed.success) continue;
    for (const pair of parsed.data.pairs) {
      if (pair.to.some((entry) => entry.currencyCode.toUpperCase() === target)) {
        supported.add(pair.from.toUpperCase());
      }
    }
  }
  return supported;
}
