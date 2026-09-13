/**
 * @id PP-CORE-LIB-106 (POO-1801)
 * @name Privy fiat currency vocabulary
 * @implements-rules-version v1 (POO-1801 rules v1)
 * @analytics-events none, a vocabulary translation with no surface of its own.
 *
 * [R4] Our codes are ISO-4217 UPPERCASE ("BRL"); the rail's are lowercase ("brl"). One boundary,
 * one translation.
 *
 * The lowercasing is the trivial half. The MEMBERSHIP CHECK is the module: `toLowerCase()` alone
 * would hand the rail `"xyz"` for a currency it does not sell, and the refusal would come back as a
 * vendor error on a buyer's screen instead of a decision we made. An unknown code answers
 * `undefined`, never a default, for the reason POO-1512 cost five days one rail over: a default
 * currency is a silent decision to charge someone in the wrong money, and it looks like a correct
 * answer from every angle except the buyer's statement.
 *
 * ## Where this list came from, and why it is a copy
 *
 * Transcribed from the SHIPPED TYPES: `type SupportedFiatCurrency = BankDepositSupportedFiatCurrency
 * | 'cny' | 'jpy' | ...` unions the five bank-deposit codes with 44 more, for 49 distinct codes. Not
 * from a guide, and not from the docs. The declaration is present at BOTH versions and identical in
 * membership: `dist/dts/index.d.ts:570` at the installed `@privy-io/react-auth@3.29.2` (bank-deposit
 * codes at `:568`) and `:576` at the 3.40.0 this migration targets (`:574`).
 *
 * It is a COPY because the type is DECLARED but NOT EXPORTED from the package entry at either
 * version: it appears nowhere in `index.d.ts`'s `export { ... }` lists, so `import type
 * { SupportedFiatCurrency } from "@privy-io/react-auth"` does not resolve, at 3.29.2 or at 3.40.0.
 * The SDK bump therefore does not retire this copy, and neither does any version until Privy exports
 * the union. Until that day the copy is permanent and the count is only half its alarm; the other
 * half is `fiatCurrencies.test.ts`, which parses the installed `.d.ts` AS SOURCE TEXT and asserts
 * set equality, the same technique `limits.test.ts` and `destinations.test.ts` use to pin a decision
 * a value check cannot see.
 *
 * PP-INTEGRATION-POINT: Privy fiat currency vocabulary, replaceable by a real `import type` the day
 * `SupportedFiatCurrency` appears in the package's export list; until then the parity test is what
 * makes drift fail a gate instead of a buyer's purchase.
 */

/**
 * The 49 codes `SupportedFiatCurrency` declares, lowercase as the rail spells them. Ordered as the
 * union declares them: the five bank-deposit codes first, then the rest.
 */
export const PRIVY_FIAT_CURRENCIES: ReadonlySet<string> = new Set([
  "usd",
  "eur",
  "mxn",
  "brl",
  "gbp",
  "cny",
  "jpy",
  "inr",
  "cad",
  "krw",
  "aud",
  "idr",
  "sar",
  "try",
  "chf",
  "twd",
  "sek",
  "ngn",
  "pln",
  "ars",
  "aed",
  "thb",
  "zar",
  "dkk",
  "egp",
  "myr",
  "sgd",
  "cop",
  "php",
  "clp",
  "bdt",
  "vnd",
  "czk",
  "ils",
  "hkd",
  "nzd",
  "pkr",
  "ron",
  "kzt",
  "nok",
  "huf",
  "uah",
  "kwd",
  "qar",
  "etb",
  "mad",
  "bgn",
  "kes",
  "npr",
]);

/** ISO-4217 alpha: exactly three letters, the only shape that can name a currency. */
const ISO_4217_ALPHA = /^[a-z]{3}$/;

/**
 * The rail's spelling of an ISO-4217 code, or `undefined` when it is not one the rail sells ([R4]).
 * Never defaults: the caller decides what to do about a currency we cannot charge in.
 */
export function toPrivyFiat(code: string | undefined): string | undefined {
  const normalized = code?.trim().toLowerCase();
  if (!normalized || !ISO_4217_ALPHA.test(normalized)) return undefined;
  return PRIVY_FIAT_CURRENCIES.has(normalized) ? normalized : undefined;
}
