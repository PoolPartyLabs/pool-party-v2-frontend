/**
 * @id PP-CORE-LIB-106 (POO-1801) - tests
 * @name Privy fiat currency vocabulary - tests
 * @implements-rules-version v1 (POO-1801 rules v1)
 * @analytics-events none, a vocabulary translation emits nothing.
 *
 * [R4] Our codes are ISO-4217 uppercase; Privy's are lowercase. The translation is trivial and the
 * MEMBERSHIP CHECK is the whole module: `toLowerCase()` alone would hand the vendor `"xyz"` for a
 * currency it does not sell, and the failure would surface as a vendor error on a buyer's screen
 * rather than as a refusal we control.
 *
 * The accepted set is COPIED from the shipped types, not from a guide: `SupportedFiatCurrency` in
 * `@privy-io/react-auth`, which unions `BankDepositSupportedFiatCurrency` (5 members) with 44 more,
 * for 49 distinct codes. Nothing is IMPORTED from `@privy-io/*`, and not because of the version: the
 * type is DECLARED but NOT EXPORTED from the package entry at 3.29.2 (`dist/dts/index.d.ts:570`) and
 * at the 3.40.0 this migration targets (`:576`) alike, so no `import type` resolves at either. The
 * copy is permanent until Privy exports the union.
 *
 * Which makes the parity test below the real guard rather than a placeholder: it reads the INSTALLED
 * `.d.ts` as SOURCE TEXT and asserts set equality, the technique `limits.test.ts` and
 * `destinations.test.ts` already use to pin a decision no value check can see.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVY_FIAT_CURRENCIES, toPrivyFiat } from "./fiatCurrencies";

describe("toPrivyFiat", () => {
  // @rule R4
  it("[R4] lowercases a supported ISO-4217 code", () => {
    expect(toPrivyFiat("BRL")).toBe("brl");
    expect(toPrivyFiat("USD")).toBe("usd");
    expect(toPrivyFiat("EUR")).toBe("eur");
    expect(toPrivyFiat("NGN")).toBe("ngn");
  });

  // @rule R4
  it("[R4] accepts the code in any casing, and trims it", () => {
    // The value round-trips through query strings and a user-facing select, so it arrives padded
    // and in whatever case the caller happened to hold.
    expect(toPrivyFiat("brl")).toBe("brl");
    expect(toPrivyFiat(" Brl ")).toBe("brl");
    expect(toPrivyFiat("usd ")).toBe("usd");
  });

  // @rule R4
  it("[R4] refuses an unsupported currency rather than defaulting", () => {
    // A default would charge a buyer in a currency nobody chose, which is the POO-1512 defect one
    // rail over. `undefined` makes the caller decide, in the open.
    expect(toPrivyFiat("XAF")).toBeUndefined();
    expect(toPrivyFiat("RUB")).toBeUndefined();
    expect(toPrivyFiat("BTC")).toBeUndefined();
  });

  // @rule R4
  it("[R4] refuses malformed input rather than defaulting", () => {
    expect(toPrivyFiat("")).toBeUndefined();
    expect(toPrivyFiat("   ")).toBeUndefined();
    expect(toPrivyFiat(undefined)).toBeUndefined();
    expect(toPrivyFiat("US")).toBeUndefined();
    expect(toPrivyFiat("USDC")).toBeUndefined();
    expect(toPrivyFiat("US$")).toBeUndefined();
  });

  // @rule R4
  it("[R4] never answers with a code outside the union", () => {
    for (const code of ["ZZZ", "AAA", "123"]) {
      expect(toPrivyFiat(code)).toBeUndefined();
    }
  });
});

/** The installed SDK's own `.d.ts`, found by RESOLUTION rather than a guessed node_modules path. */
function privyDtsSource(): string {
  const entry = createRequire(join(__dirname, "resolve.js")).resolve("@privy-io/react-auth");
  return readFileSync(join(dirname(entry), "..", "dts", "index.d.ts"), "utf8");
}

/**
 * Every code the installed `SupportedFiatCurrency` admits, read out of the declaration's own text.
 * The union names `BankDepositSupportedFiatCurrency` instead of restating its five members, so both
 * declarations are parsed and merged.
 */
function declaredFiatCurrencies(source: string): Set<string> {
  const declarations = ["SupportedFiatCurrency", "BankDepositSupportedFiatCurrency"].map((name) => {
    const body = new RegExp(`type ${name} = ([^;]+);`).exec(source)?.[1];
    if (body === undefined) throw new Error(`${name} is no longer declared in the installed .d.ts`);
    return body;
  });
  return new Set(
    declarations.flatMap((body) => [...body.matchAll(/'([a-z]{3})'/g)].map((m) => m[1] as string)),
  );
}

describe("PRIVY_FIAT_CURRENCIES", () => {
  // @rule R4
  it("[R4] carries the 49 codes the union declares", () => {
    expect(PRIVY_FIAT_CURRENCIES.size).toBe(49);
  });

  // @rule R4
  it("[R4] matches the union the INSTALLED SDK declares, code for code", () => {
    // The copy is permanent (the type is not exported), so this is the guard that makes a drift
    // fail a gate instead of a buyer's purchase: an SDK bump that adds or drops a currency reds
    // here rather than surfacing as a vendor error on someone's checkout.
    const declared = declaredFiatCurrencies(privyDtsSource());
    expect(declared.size).toBe(49);
    expect([...declared].sort()).toEqual([...PRIVY_FIAT_CURRENCIES].sort());
  });

  // @rule R4
  it("[R4] is a copy because the union is DECLARED but never EXPORTED", () => {
    // This is the whole reason the list is retyped, and it is not about the version: no export list
    // in the package entry names the type, so no `import type` resolves at 3.29.2 or at 3.40.0.
    const source = privyDtsSource();
    expect(source).toMatch(/type SupportedFiatCurrency = /);
    expect(source).not.toMatch(/export[^\n]*\bSupportedFiatCurrency\b/);
  });

  // @rule R4
  it("[R4] holds the five bank-deposit codes and a sample of the rest, all lowercase", () => {
    for (const code of ["usd", "eur", "mxn", "brl", "gbp"]) {
      expect(PRIVY_FIAT_CURRENCIES.has(code)).toBe(true);
    }
    for (const code of ["jpy", "inr", "ngn", "npr", "kes"]) {
      expect(PRIVY_FIAT_CURRENCIES.has(code)).toBe(true);
    }
    for (const code of [...PRIVY_FIAT_CURRENCIES]) {
      expect(code).toMatch(/^[a-z]{3}$/);
    }
  });
});
