/**
 * @id PP-CORE-LIB-096 (POO-1512, POO-1810)
 * @name buyerCurrency
 * @implements-rules-version v2 (POO-1810 rules v1) · v1 (POO-1512 rules v1)
 * @analytics-events none, a pure resolution function emits nothing.
 *
 * The fiat currency the buyer is CHARGED in at the on-ramp, resolved from where they actually are.
 *
 * ## Why this exists
 *
 * The on-ramp asked Paybis for a hardcoded `USD` for every user in every country. That is not a
 * cosmetic prefill: `currencyCodeFrom` is also the key the payment-method list is fetched by
 * (`on-ramp/payment-methods?currencyFrom=...`), so a buyer in Europe was never offered SEPA and a
 * buyer in Brazil was never offered Pix. Reported live from Europe on 2026-08-10: "I was prompted to
 * pay with card in USD no matter what payment method I chose."
 *
 * ## The chain, and why it is ordered this way ([R2])
 *
 *   1. `cloudfront-viewer-country` - where the buyer IS, which is also what Paybis geo-checks. Prod
 *      already sits behind CloudFront and already reads `cloudfront-viewer-address` ({@link
 *      resolveClientIp}), so this is the same edge, one more header.
 *   2. `profile.country` (the POO-675 column) - self-declared RESIDENCE, not location, and frequently
 *      empty, so it is a fallback rather than the primary.
 *   3. `USD`.
 *
 * The order matters for the reported case specifically: a Brazilian profile physically in Europe is
 * charged in EUR, because that is the card they are holding.
 *
 * `locale` is deliberately NOT a source ([R5]). It is the widget's UI language and it does not
 * identify a currency: `en` maps to none in particular, and `pt-PT` is EUR while `pt-BR` is BRL.
 *
 * ## It degrades, it never blocks ([R3]/[R4])
 *
 * A currency Paybis does not sell the pair for produces a dead quote, so a mapped currency is only
 * used when it appears in the supported set from `on-ramp/currency-pairs-to-buy`. An unmapped or
 * unsupported country does not short-circuit to USD, it hands over to the next source. When the
 * supported set could not be read at all (`null`: 404, throttle, timeout, malformed) the answer is
 * `USD`, which is exactly what shipped before this file existed. Same posture as `useBuyRouteQuote`'s
 * header: never an error state, never a spinner that traps the user.
 *
 * Pure, and it takes the two country strings rather than reading headers itself, so the whole policy
 * is unit-testable without a request. Same shape as {@link resolveClientIp} for the same reason.
 */

/**
 * Which link in the [R2] chain produced the currency. Reported on errors, never shown to the user.
 *
 * `buyer-override` is not produced by {@link resolveBuyerCurrency} at all: it is the answer when a
 * buyer's OWN choice was accepted by the server (POO-1618 [R2]), which is decided one level up in
 * `resolveOnRampCurrency` because only that layer holds the supported set to check it against. It
 * lives in this union so one log field can name every way a currency was arrived at, rather than a
 * second field that has to be read together with this one to mean anything.
 */
export type BuyerCurrencySource =
  | "cloudfront-viewer-country"
  | "profile-country"
  | "fallback"
  | "buyer-override";

/** What the app charges in when nothing better can be established. The pre-POO-1512 behaviour. */
export const FALLBACK_CURRENCY = "USD";

export interface BuyerCurrencyInput {
  /** ISO 3166-1 alpha-2 from the `cloudfront-viewer-country` header, absent off the edge. */
  viewerCountry: string | null | undefined;
  /**
   * `profile.country` (POO-675). An ISO 3166 common NAME ("Brazil"), NOT an alpha-2 code: `COUNTRIES`
   * is a name list and `CountrySelect` commits the name. Either format is accepted, and casing is not
   * guaranteed on this side because it round-trips a user-entered column.
   */
  profileCountry: string | null | undefined;
  /**
   * ISO-4217 codes Paybis sells the target pair for, from `on-ramp/currency-pairs-to-buy`.
   * `null` means the set could not be read, which is NOT the same as "supports nothing" ([R4]).
   */
  supported: ReadonlySet<string> | null;
}

export interface ResolvedBuyerCurrency {
  /** ISO-4217 code to send as `currencyCodeFrom`. */
  currency: string;
  source: BuyerCurrencySource;
  /**
   * POO-1810 [R3]: the currency the buyer's own country names, which the supported set REFUSED, on
   * the answers where that refusal is what produced {@link FALLBACK_CURRENCY}. Present only on a
   * `fallback` reached by walking the chain, because it exists to answer one question about that
   * answer: was this buyer charged dollars because the rail does not sell their money, or because
   * we never had a country to ask about? Absent means the second, and the two used to be the same
   * silence. It is a CURRENCY, never a location: the code names what we would have charged, not
   * where the buyer is, which is the same line `resolveOnRampCurrency` draws for its log fields.
   *
   * The FIRST refusal in the chain, so it is the currency of where the buyer IS rather than of
   * where they say they live, on the same ordering [R2] resolves by.
   */
  rejected?: string;
}

/**
 * ISO 3166-1 alpha-2 -> ISO 4217, for EVERY country the profile offers (POO-1810 [R1]).
 *
 * It was deliberately partial at POO-1512, on the reasoning that [R3] validates every hit against
 * the rail's own list anyway, so a missing country cost a fallback rather than a wrong charge. That
 * held for the CHARGE and hid a different cost: 140 of the 197 countries `COUNTRIES` offers had no
 * entry, so their buyers were billed in dollars and never offered their local payment methods, and
 * three of them (China, Taiwan, Vietnam) are the name-bearing markets of locales this app ships. A
 * fallback nobody can distinguish from a refusal is not a safe default, it is an invisible one.
 *
 * So the map is now exhaustive over `COUNTRIES`, and the two questions are separated: THIS table
 * answers "what money does this country use", and the supported-set check answers "will the rail
 * sell it". USD still happens, but it can now be told apart from the old silence: a refusal names
 * the currency it refused, on {@link ResolvedBuyerCurrency.rejected}, which
 * `onramp.currency_resolution_degraded` carries. An unmapped country could name nothing at all.
 *
 * The euro zone is enumerated in full on purpose. Mapping only the reporter's own country would have
 * "fixed" the report and left every other European buyer on USD.
 */
export const COUNTRY_TO_CURRENCY: Readonly<Record<string, string>> = {
  // Euro zone (all 20 members)
  AT: "EUR",
  BE: "EUR",
  HR: "EUR",
  CY: "EUR",
  EE: "EUR",
  FI: "EUR",
  FR: "EUR",
  DE: "EUR",
  GR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LV: "EUR",
  LT: "EUR",
  LU: "EUR",
  MT: "EUR",
  NL: "EUR",
  PT: "EUR",
  SK: "EUR",
  SI: "EUR",
  ES: "EUR",
  // Rest of Europe
  GB: "GBP",
  CH: "CHF",
  NO: "NOK",
  SE: "SEK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  HU: "HUF",
  RO: "RON",
  // Bulgaria adopted the euro on 2026-01-01; BGN is withdrawn, and quoting it would either fail
  // Paybis' supported-set check (degrading the buyer to USD, the exact POO-1512 bug) or price in a
  // currency no card is billed in anymore.
  BG: "EUR",
  TR: "TRY",
  UA: "UAH",
  // Americas
  US: "USD",
  CA: "CAD",
  BR: "BRL",
  MX: "MXN",
  AR: "ARS",
  CL: "CLP",
  CO: "COP",
  PE: "PEN",
  // Asia-Pacific, Middle East, Africa
  AU: "AUD",
  NZ: "NZD",
  JP: "JPY",
  SG: "SGD",
  HK: "HKD",
  IN: "INR",
  ID: "IDR",
  PH: "PHP",
  MY: "MYR",
  TH: "THB",
  KR: "KRW",
  AE: "AED",
  SA: "SAR",
  IL: "ILS",
  ZA: "ZAR",
  NG: "NGN",
  KE: "KES",
  EG: "EGP",

  // ---------------------------------------------------------------------------
  // POO-1810 [R1]: the remaining 140 countries the profile offers.
  //
  // Every alpha-2 the name map yields now has a currency, so no profile country can reach
  // FALLBACK_CURRENCY by OMISSION ([R1]). Whether a rail sells that currency is a different question
  // and stays where it belongs, in the resolver's supported-set check ([R3]): under Paybis an
  // unsupported currency still degrades to USD exactly as before. The difference is that a USD from
  // a refusal now carries the code that was refused, and a USD from a country we never mapped could
  // not carry anything.
  //
  // Source: ISO 4217, transcribed by hand, one entry per country and no artefact to check it
  // against (Node's ICU carries country NAMES but no country -> currency table, which is why the
  // NAME side is machine-checked in the test and this side is not). The rule applied throughout: a
  // territory takes its parent's currency, and a country where a second currency also circulates
  // takes the one its own central bank issues, so Lesotho is LSL and not ZAR, Bhutan is BTN and not
  // INR, and the dollarized economies (Ecuador, El Salvador, Timor-Leste, Palau, Marshall Islands,
  // Micronesia) are USD because that IS their currency, not because we gave up on them.
  // Euro users outside the EU 20: monetary agreements (Andorra, Monaco, San Marino, Vatican) and unilateral adoption (Montenegro, Kosovo).
  AD: "EUR", // Andorra
  MC: "EUR", // Monaco
  SM: "EUR", // San Marino
  VA: "EUR", // Vatican City
  ME: "EUR", // Montenegro
  XK: "EUR", // Kosovo
  // Rest of Europe and the Caucasus.
  AL: "ALL", // Albania
  AM: "AMD", // Armenia
  AZ: "AZN", // Azerbaijan
  BA: "BAM", // Bosnia and Herzegovina
  BY: "BYN", // Belarus
  GE: "GEL", // Georgia
  IS: "ISK", // Iceland
  LI: "CHF", // Liechtenstein
  MD: "MDL", // Moldova
  MK: "MKD", // North Macedonia
  RS: "RSD", // Serbia
  RU: "RUB", // Russia
  // Americas. XCD is the Eastern Caribbean dollar, shared by six of these states.
  AG: "XCD", // Antigua and Barbuda
  BB: "BBD", // Barbados
  BS: "BSD", // Bahamas
  BZ: "BZD", // Belize
  BO: "BOB", // Bolivia
  CR: "CRC", // Costa Rica
  CU: "CUP", // Cuba
  DM: "XCD", // Dominica
  DO: "DOP", // Dominican Republic
  EC: "USD", // Ecuador
  GD: "XCD", // Grenada
  GT: "GTQ", // Guatemala
  GY: "GYD", // Guyana
  HN: "HNL", // Honduras
  HT: "HTG", // Haiti
  JM: "JMD", // Jamaica
  KN: "XCD", // Saint Kitts and Nevis
  LC: "XCD", // Saint Lucia
  NI: "NIO", // Nicaragua
  PA: "PAB", // Panama
  PY: "PYG", // Paraguay
  SR: "SRD", // Suriname
  SV: "USD", // El Salvador
  TT: "TTD", // Trinidad and Tobago
  UY: "UYU", // Uruguay
  VC: "XCD", // Saint Vincent and the Grenadines
  VE: "VES", // Venezuela
  // Asia.
  AF: "AFN", // Afghanistan
  BD: "BDT", // Bangladesh
  BN: "BND", // Brunei
  BT: "BTN", // Bhutan
  CN: "CNY", // China
  KG: "KGS", // Kyrgyzstan
  KH: "KHR", // Cambodia
  KP: "KPW", // North Korea
  KZ: "KZT", // Kazakhstan
  LA: "LAK", // Laos
  LK: "LKR", // Sri Lanka
  MM: "MMK", // Myanmar
  MN: "MNT", // Mongolia
  MV: "MVR", // Maldives
  NP: "NPR", // Nepal
  PK: "PKR", // Pakistan
  TJ: "TJS", // Tajikistan
  TL: "USD", // Timor-Leste
  TM: "TMT", // Turkmenistan
  TW: "TWD", // Taiwan
  UZ: "UZS", // Uzbekistan
  VN: "VND", // Vietnam
  // Middle East.
  BH: "BHD", // Bahrain
  IQ: "IQD", // Iraq
  IR: "IRR", // Iran
  JO: "JOD", // Jordan
  KW: "KWD", // Kuwait
  LB: "LBP", // Lebanon
  OM: "OMR", // Oman
  PS: "ILS", // Palestine
  QA: "QAR", // Qatar
  SY: "SYP", // Syria
  YE: "YER", // Yemen
  // Oceania. Three of these use the Australian dollar rather than issuing their own.
  FJ: "FJD", // Fiji
  FM: "USD", // Micronesia
  KI: "AUD", // Kiribati
  MH: "USD", // Marshall Islands
  NR: "AUD", // Nauru
  PG: "PGK", // Papua New Guinea
  PW: "USD", // Palau
  SB: "SBD", // Solomon Islands
  TO: "TOP", // Tonga
  TV: "AUD", // Tuvalu
  VU: "VUV", // Vanuatu
  WS: "WST", // Samoa
  // Africa. XOF (eight members) and XAF (six) are the two CFA francs; both are currencies Paybis and Privy quote.
  AO: "AOA", // Angola
  BF: "XOF", // Burkina Faso
  BI: "BIF", // Burundi
  BJ: "XOF", // Benin
  BW: "BWP", // Botswana
  CD: "CDF", // Democratic Republic of the Congo
  CF: "XAF", // Central African Republic
  CG: "XAF", // Congo
  CI: "XOF", // Côte d'Ivoire
  CM: "XAF", // Cameroon
  CV: "CVE", // Cabo Verde
  DJ: "DJF", // Djibouti
  DZ: "DZD", // Algeria
  ER: "ERN", // Eritrea
  ET: "ETB", // Ethiopia
  GA: "XAF", // Gabon
  GH: "GHS", // Ghana
  GM: "GMD", // Gambia
  GN: "GNF", // Guinea
  GQ: "XAF", // Equatorial Guinea
  GW: "XOF", // Guinea-Bissau
  KM: "KMF", // Comoros
  LR: "LRD", // Liberia
  LS: "LSL", // Lesotho
  LY: "LYD", // Libya
  MA: "MAD", // Morocco
  MG: "MGA", // Madagascar
  ML: "XOF", // Mali
  MR: "MRU", // Mauritania
  MU: "MUR", // Mauritius
  MW: "MWK", // Malawi
  MZ: "MZN", // Mozambique
  NA: "NAD", // Namibia
  NE: "XOF", // Niger
  RW: "RWF", // Rwanda
  SC: "SCR", // Seychelles
  SD: "SDG", // Sudan
  SL: "SLE", // Sierra Leone
  SN: "XOF", // Senegal
  SO: "SOS", // Somalia
  SS: "SSP", // South Sudan
  ST: "STN", // Sao Tome and Principe
  SZ: "SZL", // Eswatini
  TD: "XAF", // Chad
  TG: "XOF", // Togo
  TN: "TND", // Tunisia
  TZ: "TZS", // Tanzania
  UG: "UGX", // Uganda
  ZM: "ZMW", // Zambia
  ZW: "ZWG", // Zimbabwe
};

/**
 * ISO 3166 common NAME -> alpha-2, for the countries {@link COUNTRY_TO_CURRENCY} prices.
 *
 * The two links of the [R2] chain carry DIFFERENT formats, and this is the one that is easy to miss:
 * CloudFront sends `"PT"`, but `profile.country` stores `"Portugal"`. `COUNTRIES`
 * (`lib/data/countries.ts`, PP-CORE-LIB-014) is a list of common names and `CountrySelect` commits the
 * NAME, so an alpha-2-only lookup would leave the profile link dead on arrival, and silently: every
 * profile user would fall through to USD, which is indistinguishable from the bug this file fixes.
 * `docs/COMPLIANCE_REGISTER.md` CR-PRED-005 records the same trap for the predictions geo gate.
 *
 * Spellings are taken verbatim from the shipped `COUNTRIES` list, because a near-miss ("Czech
 * Republic" for "Czechia", "UK" for "United Kingdom") fails the same silent way.
 *
 * POO-1810 [R1]: all 197 of them, and the test iterates `COUNTRIES` itself rather than a copy, so a
 * name added to either file without the other fails loudly instead of quietly costing that country's
 * buyers their own currency.
 */
const COUNTRY_NAME_TO_CODE: Readonly<Record<string, string>> = {
  AUSTRIA: "AT",
  BELGIUM: "BE",
  CROATIA: "HR",
  CYPRUS: "CY",
  ESTONIA: "EE",
  FINLAND: "FI",
  FRANCE: "FR",
  GERMANY: "DE",
  GREECE: "GR",
  IRELAND: "IE",
  ITALY: "IT",
  LATVIA: "LV",
  LITHUANIA: "LT",
  LUXEMBOURG: "LU",
  MALTA: "MT",
  NETHERLANDS: "NL",
  PORTUGAL: "PT",
  SLOVAKIA: "SK",
  SLOVENIA: "SI",
  SPAIN: "ES",
  "UNITED KINGDOM": "GB",
  SWITZERLAND: "CH",
  NORWAY: "NO",
  SWEDEN: "SE",
  DENMARK: "DK",
  POLAND: "PL",
  CZECHIA: "CZ",
  HUNGARY: "HU",
  ROMANIA: "RO",
  BULGARIA: "BG",
  TURKEY: "TR",
  UKRAINE: "UA",
  "UNITED STATES": "US",
  CANADA: "CA",
  BRAZIL: "BR",
  MEXICO: "MX",
  ARGENTINA: "AR",
  CHILE: "CL",
  COLOMBIA: "CO",
  PERU: "PE",
  AUSTRALIA: "AU",
  "NEW ZEALAND": "NZ",
  JAPAN: "JP",
  SINGAPORE: "SG",
  INDIA: "IN",
  INDONESIA: "ID",
  PHILIPPINES: "PH",
  MALAYSIA: "MY",
  THAILAND: "TH",
  "SOUTH KOREA": "KR",
  "UNITED ARAB EMIRATES": "AE",
  "SAUDI ARABIA": "SA",
  ISRAEL: "IL",
  "SOUTH AFRICA": "ZA",
  NIGERIA: "NG",
  KENYA: "KE",
  EGYPT: "EG",

  // ---------------------------------------------------------------------------
  // POO-1810 [R1]: the other 140 names `COUNTRIES` ships.
  //
  // Keys are the SHIPPED spelling, uppercased, punctuation and accents included, because that is
  // what `normalizeCountry` compares against and a near-miss must fail rather than be guessed at.
  // Fourteen of them differ from CLDR's spelling ("Turkey" vs "Türkiye", "Cabo Verde" vs "Cape
  // Verde", the "and" / "&" pairs), and the test carries that alias table explicitly so each
  // divergence is on the record rather than absorbed by a fuzzy match.
  //
  // The CODES are machine-checked: `buyerCurrency.test.ts` asserts every one of them against Node's
  // own CLDR data through `Intl.DisplayNames`, so a wrong code fails loudly instead of billing a
  // buyer in the wrong country's money. Only canonical alpha-2 codes are used; CLDR also answers to
  // deprecated ones (`UK`, `SU`, `YU`, `DY`, `HV`, `TP`) that share a display name with the code
  // that replaced them, and picking one of those would have looked correct here and resolved to
  // nothing downstream.
  AFGHANISTAN: "AF",
  ALBANIA: "AL",
  ALGERIA: "DZ",
  ANDORRA: "AD",
  ANGOLA: "AO",
  "ANTIGUA AND BARBUDA": "AG",
  ARMENIA: "AM",
  AZERBAIJAN: "AZ",
  BAHAMAS: "BS",
  BAHRAIN: "BH",
  BANGLADESH: "BD",
  BARBADOS: "BB",
  BELARUS: "BY",
  BELIZE: "BZ",
  BENIN: "BJ",
  BHUTAN: "BT",
  BOLIVIA: "BO",
  "BOSNIA AND HERZEGOVINA": "BA",
  BOTSWANA: "BW",
  BRUNEI: "BN",
  "BURKINA FASO": "BF",
  BURUNDI: "BI",
  "CABO VERDE": "CV",
  CAMBODIA: "KH",
  CAMEROON: "CM",
  "CENTRAL AFRICAN REPUBLIC": "CF",
  CHAD: "TD",
  CHINA: "CN",
  COMOROS: "KM",
  CONGO: "CG",
  "COSTA RICA": "CR",
  "CÔTE D'IVOIRE": "CI",
  CUBA: "CU",
  "DEMOCRATIC REPUBLIC OF THE CONGO": "CD",
  DJIBOUTI: "DJ",
  DOMINICA: "DM",
  "DOMINICAN REPUBLIC": "DO",
  ECUADOR: "EC",
  "EL SALVADOR": "SV",
  "EQUATORIAL GUINEA": "GQ",
  ERITREA: "ER",
  ESWATINI: "SZ",
  ETHIOPIA: "ET",
  FIJI: "FJ",
  GABON: "GA",
  GAMBIA: "GM",
  GEORGIA: "GE",
  GHANA: "GH",
  GRENADA: "GD",
  GUATEMALA: "GT",
  GUINEA: "GN",
  "GUINEA-BISSAU": "GW",
  GUYANA: "GY",
  HAITI: "HT",
  HONDURAS: "HN",
  ICELAND: "IS",
  IRAN: "IR",
  IRAQ: "IQ",
  JAMAICA: "JM",
  JORDAN: "JO",
  KAZAKHSTAN: "KZ",
  KIRIBATI: "KI",
  KOSOVO: "XK",
  KUWAIT: "KW",
  KYRGYZSTAN: "KG",
  LAOS: "LA",
  LEBANON: "LB",
  LESOTHO: "LS",
  LIBERIA: "LR",
  LIBYA: "LY",
  LIECHTENSTEIN: "LI",
  MADAGASCAR: "MG",
  MALAWI: "MW",
  MALDIVES: "MV",
  MALI: "ML",
  "MARSHALL ISLANDS": "MH",
  MAURITANIA: "MR",
  MAURITIUS: "MU",
  MICRONESIA: "FM",
  MOLDOVA: "MD",
  MONACO: "MC",
  MONGOLIA: "MN",
  MONTENEGRO: "ME",
  MOROCCO: "MA",
  MOZAMBIQUE: "MZ",
  MYANMAR: "MM",
  NAMIBIA: "NA",
  NAURU: "NR",
  NEPAL: "NP",
  NICARAGUA: "NI",
  NIGER: "NE",
  "NORTH KOREA": "KP",
  "NORTH MACEDONIA": "MK",
  OMAN: "OM",
  PAKISTAN: "PK",
  PALAU: "PW",
  PALESTINE: "PS",
  PANAMA: "PA",
  "PAPUA NEW GUINEA": "PG",
  PARAGUAY: "PY",
  QATAR: "QA",
  RUSSIA: "RU",
  RWANDA: "RW",
  "SAINT KITTS AND NEVIS": "KN",
  "SAINT LUCIA": "LC",
  "SAINT VINCENT AND THE GRENADINES": "VC",
  SAMOA: "WS",
  "SAN MARINO": "SM",
  "SAO TOME AND PRINCIPE": "ST",
  SENEGAL: "SN",
  SERBIA: "RS",
  SEYCHELLES: "SC",
  "SIERRA LEONE": "SL",
  "SOLOMON ISLANDS": "SB",
  SOMALIA: "SO",
  "SOUTH SUDAN": "SS",
  "SRI LANKA": "LK",
  SUDAN: "SD",
  SURINAME: "SR",
  SYRIA: "SY",
  TAIWAN: "TW",
  TAJIKISTAN: "TJ",
  TANZANIA: "TZ",
  "TIMOR-LESTE": "TL",
  TOGO: "TG",
  TONGA: "TO",
  "TRINIDAD AND TOBAGO": "TT",
  TUNISIA: "TN",
  TURKMENISTAN: "TM",
  TUVALU: "TV",
  UGANDA: "UG",
  URUGUAY: "UY",
  UZBEKISTAN: "UZ",
  VANUATU: "VU",
  "VATICAN CITY": "VA",
  VENEZUELA: "VE",
  VIETNAM: "VN",
  YEMEN: "YE",
  ZAMBIA: "ZM",
  ZIMBABWE: "ZW",
};

/**
 * Reduce either format to an alpha-2 code: the edge's `"PT"` or the profile's `"Portugal"`.
 *
 * Casing and surrounding whitespace are not guaranteed on the profile side, which round-trips a
 * user-entered DB column.
 */
export function normalizeCountry(country: string | null | undefined): string | undefined {
  const trimmed = country?.trim().toUpperCase();
  if (!trimmed) return undefined;
  if (trimmed in COUNTRY_TO_CURRENCY) return trimmed;
  return COUNTRY_NAME_TO_CODE[trimmed];
}

/**
 * Resolve the currency to charge the buyer in, per [R2]/[R3]/[R4].
 *
 * Never throws and never returns an unsupported code: every caller can send the result straight to
 * `currencyCodeFrom` without a further guard. When the walk ends on the fallback because the rail
 * refused what the buyer's country names, the refused code rides back on `rejected` (POO-1810 [R3])
 * rather than being dropped here, where nothing downstream could recover it.
 */
export function resolveBuyerCurrency({
  viewerCountry,
  profileCountry,
  supported,
}: BuyerCurrencyInput): ResolvedBuyerCurrency {
  // [R4] An unreadable (or empty) supported set means we know nothing, so we charge what always
  // worked. Distinct from "Paybis supports nothing", which is not a state we can act on either.
  if (!supported || supported.size === 0) {
    return { currency: FALLBACK_CURRENCY, source: "fallback" };
  }

  const chain: readonly (readonly [string | null | undefined, BuyerCurrencySource])[] = [
    [viewerCountry, "cloudfront-viewer-country"],
    [profileCountry, "profile-country"],
  ];

  let rejected: string | undefined;
  for (const [country, source] of chain) {
    const code = normalizeCountry(country);
    if (!code) continue;
    const currency = COUNTRY_TO_CURRENCY[code];
    // [R3] A mapped-but-unsupported currency hands over to the next source rather than ending the
    // walk: the buyer's residence may still name a currency Paybis actually sells.
    if (currency && supported.has(currency)) return { currency, source };
    // POO-1810 [R3]: and it is no longer dropped on the way past. The first refusal is what the
    // degrade line reports, so a dollar charge can name the money it was not allowed to use.
    if (currency && rejected === undefined) rejected = currency;
  }

  return { currency: FALLBACK_CURRENCY, source: "fallback", ...(rejected ? { rejected } : {}) };
}
