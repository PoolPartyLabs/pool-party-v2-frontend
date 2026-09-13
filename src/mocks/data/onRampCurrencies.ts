/**
 * @id PP-CORE-MCK-006
 * @name on-ramp supported currencies (mock)
 * @implements-rules-version v1 (POO-1613 rules v1)
 *
 * The fiat currencies the on-ramp currency Select offers, for MOCK MODE only (premise 2).
 *
 * ## Why this fixture exists
 *
 * The Select's real backing (POO-1621: return the supported fiat set to the client, via
 * `on-ramp/currency-pairs-to-buy`) has not shipped. Until it does, the alpha build has nothing to
 * populate 44 options with, and "no configuration in which the control can be seen at all" is
 * exactly the gap POO-1513 already hit once for the payment-method picker
 * (`onRampPaymentMethods.ts`, `PP-CORE-MCK-003`). Same answer here: a sibling fixture, read only
 * behind `isMockMode`.
 *
 * ## Maximum realism
 *
 * 44 ISO-4217 codes, the measured count POO-1613 records for the pair as of 2026-08-14, not an
 * invented shortlist. `XAF` (Central African CFA franc, six countries with no single flag to
 * derive from) is included deliberately: it is the one code in the set that breaks the
 * two-letter-code-to-flag trick, and a fixture without it would let that class of defect ship
 * unseen from this screen alone.
 *
 * PP-MOCK: a static list, read only when `isMockMode` is on.
 *
 * PP-INTEGRATION-POINT: the real supported set, naming POO-1621. In real mode this module is
 * never read; until POO-1621 lands, a real-mode buyer sees the resolved currency as display text
 * only, never a Select whose options came from a fixture (POO-1613's own rule).
 */

/** The 44 fiat currencies Paybis lists for this pair, ISO-4217, alphabetical order not implied. */
export const mockSupportedCurrencies: readonly string[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "CHF",
  "HKD",
  "SGD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "HRK",
  "ISK",
  "TRY",
  "ILS",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "ZAR",
  "NGN",
  "KES",
  "GHS",
  "EGP",
  "INR",
  "IDR",
  "MYR",
  "THB",
  "PHP",
  "VND",
  "KRW",
  "TWD",
  "NZD",
  "MXN",
  "BRL",
  "XAF",
];
