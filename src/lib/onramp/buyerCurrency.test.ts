/**
 * @id PP-CORE-LIB-096 (POO-1512, POO-1810)
 * @name buyerCurrency tests
 * @implements-rules-version v2 (POO-1810 rules v1) · v1 (POO-1512 rules v1)
 * @analytics-events none, a pure resolution function emits nothing.
 *
 * [R2] the resolution chain picks the first source that yields a SUPPORTED currency, [R3] a currency
 * Paybis does not list for the pair is never sent, [R4] an unreadable supported set degrades to USD
 * rather than blocking the purchase.
 *
 * The chain is asserted through its OBSERVABLE result (currency + source), never by spying on call
 * order: the point of [R2] is which currency the buyer is charged in, not how we got there.
 *
 * TWO rule sets are numbered here and they are not the same [R1]. Everything above the
 * `POO-1810 every profile country resolves` describe is POO-1512's, summarised in the paragraph
 * above; everything inside it is POO-1810's, which numbers its own three: [R1] every country
 * `COUNTRIES` offers has an entry, [R2] Bulgaria stays on EUR against the provider's own map, [R3]
 * every hit is still validated against the supported set. Each describe states which set it means.
 */

import { describe, expect, it } from "vitest";
import { COUNTRIES } from "@/lib/data/countries";
import { COUNTRY_TO_CURRENCY, normalizeCountry, resolveBuyerCurrency } from "./buyerCurrency";

/** The currencies Paybis lists for `USDC-BASE` in these cases. Real codes, not invented ones. */
const SUPPORTED = new Set(["USD", "EUR", "GBP", "BRL"]);

describe("resolveBuyerCurrency", () => {
  describe("[R2] resolution chain", () => {
    it("uses the CloudFront viewer country when it maps to a supported currency", () => {
      expect(
        resolveBuyerCurrency({
          viewerCountry: "PT",
          profileCountry: "BR",
          supported: SUPPORTED,
        }),
      ).toEqual({ currency: "EUR", source: "cloudfront-viewer-country" });
    });

    it("prefers the viewer country over the profile country when both resolve", () => {
      // Rafael's own case: a Brazilian profile, physically in Europe. He is charged where he IS.
      const { currency } = resolveBuyerCurrency({
        viewerCountry: "DE",
        profileCountry: "BR",
        supported: SUPPORTED,
      });
      expect(currency).toBe("EUR");
    });

    it("falls through to the profile country when the viewer country is absent", () => {
      // The header is absent locally and anywhere not behind CloudFront, which is the normal
      // pre-devops state, so this path is the one that runs today.
      expect(
        resolveBuyerCurrency({
          viewerCountry: null,
          profileCountry: "BR",
          supported: SUPPORTED,
        }),
      ).toEqual({ currency: "BRL", source: "profile-country" });
    });

    it("falls through to the profile country when the viewer country is unrecognised", () => {
      // An unmapped country must not short-circuit the chain to USD: the next source may still know.
      expect(
        resolveBuyerCurrency({
          viewerCountry: "ZZ",
          profileCountry: "GB",
          supported: SUPPORTED,
        }),
      ).toEqual({ currency: "GBP", source: "profile-country" });
    });

    it("falls back to USD when no source resolves", () => {
      expect(
        resolveBuyerCurrency({ viewerCountry: null, profileCountry: "", supported: SUPPORTED }),
      ).toEqual({ currency: "USD", source: "fallback" });
    });

    it("accepts a lower-case country code from either source", () => {
      // CloudFront sends upper-case, but `profile.country` is user-entered and round-trips a DB
      // column, so casing is not guaranteed on that side.
      expect(
        resolveBuyerCurrency({ viewerCountry: "pt", profileCountry: null, supported: SUPPORTED })
          .currency,
      ).toBe("EUR");
      expect(
        resolveBuyerCurrency({ viewerCountry: null, profileCountry: "br", supported: SUPPORTED })
          .currency,
      ).toBe("BRL");
    });
  });

  describe("[R3] the currency must be one Paybis lists for the pair", () => {
    it("skips a mapped currency that is not supported and keeps walking the chain", () => {
      // Japan maps to JPY. If Paybis does not sell USDC-BASE for JPY, sending it produces a dead
      // quote, so the profile country gets its turn instead.
      expect(
        resolveBuyerCurrency({
          viewerCountry: "JP",
          profileCountry: "GB",
          supported: SUPPORTED,
        }),
      ).toEqual({ currency: "GBP", source: "profile-country" });
    });

    it("falls back to USD when every mapped currency is unsupported", () => {
      // POO-1810 [R3]: and the answer NAMES the money it was refused, so this USD can be told apart
      // from the USD of a country the map never carried.
      expect(
        resolveBuyerCurrency({
          viewerCountry: "JP",
          profileCountry: "JP",
          supported: SUPPORTED,
        }),
      ).toEqual({ currency: "USD", source: "fallback", rejected: "JPY" });
    });

    it("never returns a currency absent from the supported set", () => {
      const narrow = new Set(["USD"]);
      for (const country of ["PT", "DE", "BR", "GB", "JP", "ZZ"]) {
        expect(
          resolveBuyerCurrency({
            viewerCountry: country,
            profileCountry: country,
            supported: narrow,
          }).currency,
        ).toBe("USD");
      }
    });
  });

  describe("[R4] an unreadable supported set degrades, it never blocks", () => {
    it("returns USD when the supported set could not be read", () => {
      // `null` is the 404 / throttle / timeout / malformed case. USD is what ships today, so this
      // degrades to the status quo instead of risking a currency Paybis may reject.
      expect(
        resolveBuyerCurrency({ viewerCountry: "PT", profileCountry: "BR", supported: null }),
      ).toEqual({ currency: "USD", source: "fallback" });
    });

    it("returns USD when the supported set is empty", () => {
      expect(
        resolveBuyerCurrency({ viewerCountry: "PT", profileCountry: "BR", supported: new Set() })
          .currency,
      ).toBe("USD");
    });
  });

  /**
   * `profile.country` is NOT an ISO code. `COUNTRIES` (PP-CORE-LIB-014) is a list of ISO 3166 common
   * NAMES and `CountrySelect` commits the name, so the stored value is "Brazil", not "BR".
   * `docs/COMPLIANCE_REGISTER.md` CR-PRED-005 records the same trap for the predictions geo gate.
   *
   * An alpha-2-only lookup would have made the whole profile link of [R2] dead on arrival, and
   * silently: every profile user would just have fallen through to USD, which is indistinguishable
   * from the bug this issue fixes.
   */
  describe("[R2] the profile stores a country NAME, not a code", () => {
    it("resolves a stored country name", () => {
      expect(
        resolveBuyerCurrency({
          viewerCountry: null,
          profileCountry: "Brazil",
          supported: SUPPORTED,
        }),
      ).toEqual({ currency: "BRL", source: "profile-country" });
    });

    it("resolves multi-word names exactly as the shipped list spells them", () => {
      const of = (name: string) =>
        resolveBuyerCurrency({ viewerCountry: null, profileCountry: name, supported: SUPPORTED })
          .currency;
      expect(of("United Kingdom")).toBe("GBP");
      expect(of("United States")).toBe("USD");
      expect(of("Portugal")).toBe("EUR");
      expect(of("Netherlands")).toBe("EUR");
    });

    it("is case- and whitespace-insensitive on the name", () => {
      const of = (name: string) =>
        resolveBuyerCurrency({ viewerCountry: null, profileCountry: name, supported: SUPPORTED })
          .currency;
      expect(of("  brazil ")).toBe("BRL");
      expect(of("PORTUGAL")).toBe("EUR");
    });

    it("still accepts an alpha-2 code, so the CloudFront header keeps working", () => {
      // The two links of the chain carry different formats: the edge sends "PT", the profile "Portugal".
      expect(
        resolveBuyerCurrency({ viewerCountry: "PT", profileCountry: null, supported: SUPPORTED })
          .currency,
      ).toBe("EUR");
    });

    it("falls back to USD on a name that is not a country", () => {
      expect(
        resolveBuyerCurrency({
          viewerCountry: null,
          profileCountry: "Narnia",
          supported: SUPPORTED,
        }),
      ).toEqual({ currency: "USD", source: "fallback" });
    });
  });

  describe("the euro zone is not one country", () => {
    it("maps every configured euro-zone country to EUR", () => {
      // A single-country EUR map was the obvious way to get this wrong: the reporter was in Europe,
      // not in Portugal specifically.
      for (const country of ["PT", "DE", "FR", "ES", "IT", "NL", "IE"]) {
        expect(
          resolveBuyerCurrency({
            viewerCountry: country,
            profileCountry: null,
            supported: SUPPORTED,
          }).currency,
        ).toBe("EUR");
      }
    });
  });
});

/**
 * POO-1810 [R1]: EVERY country the profile offers reaches a currency.
 *
 * The gap this closes was ours, not a provider's: 140 of the 197 names in `COUNTRIES` had no entry
 * in the name map and fell through to USD, and three of them (China, Taiwan, Vietnam) are the
 * name-bearing markets of three locales this app ships.
 *
 * The suite iterates `COUNTRIES` ITSELF rather than a copied list, so a name added to either file
 * without the other fails here loudly instead of quietly billing someone in dollars.
 */
describe("POO-1810 every profile country resolves", () => {
  /**
   * A supported set that contains everything any mapping can produce. It deliberately removes the
   * rail's opinion from these cases: whether a vendor SELLS a currency is [R3]'s supported-set
   * check and is not what [R1] is about. What is asserted here is that the chain produces a
   * currency AT ALL, so `fallback` can only ever mean "the rail does not sell it", never "we forgot
   * the country".
   */
  const everyCurrency = new Set(
    COUNTRIES.map((name) => {
      const code = normalizeCountry(name);
      return code ? (COUNTRY_TO_CURRENCY[code] ?? "") : "";
    }).filter(Boolean),
  );

  // @rule R1
  it("[R1] maps all 197 COUNTRIES names to an alpha-2 code", () => {
    const unmapped = COUNTRIES.filter((name) => normalizeCountry(name) === undefined);
    expect(unmapped).toEqual([]);
    expect(COUNTRIES).toHaveLength(197);
  });

  // @rule R1
  it("[R1] gives every mapped code a currency, so none reaches USD by omission", () => {
    const currencyless = COUNTRIES.filter((name) => {
      const code = normalizeCountry(name);
      return code === undefined || COUNTRY_TO_CURRENCY[code] === undefined;
    });
    expect(currencyless).toEqual([]);
  });

  // @rule R1
  it("[R1] resolves every profile country to a non-fallback source", () => {
    // The end-to-end statement of the rule, through the public function: with the rail's own
    // refusals taken out of the picture, no country may still land on `fallback`.
    const fellBack = COUNTRIES.filter(
      (name) =>
        resolveBuyerCurrency({
          viewerCountry: null,
          profileCountry: name,
          supported: everyCurrency,
        }).source !== "profile-country",
    );
    expect(fellBack).toEqual([]);
  });

  // @rule R1
  it("[R1] matches the names exactly as COUNTRIES spells them, with no fuzzy fallback", () => {
    // The map is keyed on the uppercase form of the SHIPPED spelling, punctuation and accents
    // included. A near-miss must fail rather than be guessed at: guessing is how "Czech Republic"
    // silently becomes a different country from "Czechia".
    expect(normalizeCountry("Côte d'Ivoire")).toBe("CI");
    expect(normalizeCountry("Cote d'Ivoire")).toBeUndefined();
    expect(normalizeCountry("Bosnia & Herzegovina")).toBeUndefined();
    expect(normalizeCountry("  brazil  ")).toBe("BR");
  });

  /**
   * [R1] The codes are cross-checked against an ARTEFACT, not against memory: Node's own CLDR data
   * via `Intl.DisplayNames`. A wrong code that happens to have a currency would otherwise pass every
   * assertion above while billing a buyer in the wrong country's money.
   *
   * The alias table is the whole list of names where the shipped spelling and CLDR's differ, and it
   * is written out rather than pattern-matched so each divergence is a decision on the record.
   */
  // @rule R1
  it("[R1] every mapped code carries the CLDR name of the country it was mapped from", () => {
    // The artefact is the ICU data of whatever Node this suite runs on, not a pinned copy, so the
    // alias table above is coupled to that build: a Node (or CI image) upgrade that ships a newer
    // CLDR can rename a country here and turn this red without a line of our code changing. That is
    // the trade taken on purpose. A stale pinned table would agree with itself forever, and this one
    // fails loudly and is corrected by editing the alias, which keeps each divergence on the record.
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    /** shipped `COUNTRIES` spelling -> the CLDR spelling of the SAME country. */
    const CLDR_ALIASES: Readonly<Record<string, string>> = {
      "Antigua and Barbuda": "Antigua & Barbuda",
      "Bosnia and Herzegovina": "Bosnia & Herzegovina",
      "Cabo Verde": "Cape Verde",
      Congo: "Congo - Brazzaville",
      "Côte d'Ivoire": "Côte d’Ivoire",
      "Democratic Republic of the Congo": "Congo - Kinshasa",
      Myanmar: "Myanmar (Burma)",
      Palestine: "Palestinian Territories",
      "Saint Kitts and Nevis": "St. Kitts & Nevis",
      "Saint Lucia": "St. Lucia",
      "Saint Vincent and the Grenadines": "St. Vincent & Grenadines",
      "Sao Tome and Principe": "São Tomé & Príncipe",
      "Trinidad and Tobago": "Trinidad & Tobago",
      Turkey: "Türkiye",
    };
    const wrong = COUNTRIES.filter((name) => {
      const code = normalizeCountry(name);
      if (!code) return true;
      const expected = CLDR_ALIASES[name] ?? name;
      return display.of(code) !== expected;
    });
    expect(wrong).toEqual([]);
  });

  // @rule R1
  it("[R1] bills the three named markets in their own money", () => {
    // The reason this issue exists. China, Taiwan and Vietnam are the name-bearing markets of three
    // locales this app ships, and all three were being charged in dollars.
    for (const [name, currency] of [
      ["China", "CNY"],
      ["Taiwan", "TWD"],
      ["Vietnam", "VND"],
    ] as const) {
      expect(normalizeCountry(name)).toBeDefined();
      expect(COUNTRY_TO_CURRENCY[normalizeCountry(name) as string]).toBe(currency);
    }
  });

  // @rule R2
  it("[R2] pins Bulgaria to the euro, and keeps it there when BGN is on offer", () => {
    // Bulgaria adopted the euro on 2026-01-01 and BGN is withdrawn. Privy's own country map still
    // says BGN, so this is a deliberate divergence from the provider rather than a transcription of
    // it, and the second assertion is what makes it a RULE: with BGN present in the supported set,
    // the mapping is the only thing standing between a Bulgarian buyer and a card charge in a
    // currency no card is billed in anymore. A spelling check would pass either way.
    expect(COUNTRY_TO_CURRENCY[normalizeCountry("Bulgaria") as string]).toBe("EUR");
    expect(
      resolveBuyerCurrency({
        viewerCountry: "BG",
        profileCountry: null,
        supported: new Set(["EUR", "BGN"]),
      }),
    ).toEqual({ currency: "EUR", source: "cloudfront-viewer-country" });
  });

  // @rule R3
  it("[R3] maps Peru to PEN even though the rail will refuse it, and says so", () => {
    // Measured against our own map, Peru is the ONE mapped country whose currency Privy does not
    // sell. That is [R3]'s supported-set check doing its job: this buyer reaches USD BY DESIGN,
    // through a refusal that now names PEN on the way past, and not by the omission this issue
    // removes. Keeping PEN here is what makes the difference visible the day the rail sells it.
    expect(COUNTRY_TO_CURRENCY[normalizeCountry("Peru") as string]).toBe("PEN");
    expect(
      resolveBuyerCurrency({
        viewerCountry: null,
        profileCountry: "Peru",
        supported: new Set(["USD", "EUR", "BRL"]),
      }),
    ).toEqual({ currency: "USD", source: "fallback", rejected: "PEN" });
  });

  // @rule R3
  it("[R3] carries no rejection when the chain never reached one", () => {
    // The other shape of the same USD, and the reason `rejected` is worth reading: a country the
    // map does not carry (the edge can send a code `COUNTRIES` never offers) refuses nothing,
    // because nothing was ever proposed. Absent and "PEN" are opposite diagnoses of one charge.
    expect(
      resolveBuyerCurrency({
        viewerCountry: "ZZ",
        profileCountry: null,
        supported: new Set(["USD", "EUR"]),
      }),
    ).toEqual({ currency: "USD", source: "fallback" });
  });
});
