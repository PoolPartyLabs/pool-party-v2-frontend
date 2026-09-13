/**
 * @id PP-BALANCES (POO-1893)
 * @name walletHoldingsSchema tests
 * @implements-rules-version v3 (POO-1893 rules v2) · v2 (POO-1893 rules v1) · v1 (POO-815)
 *
 * The contract-drift regression for POO-1893, written from the payload Sentry actually captured
 * (issue `POOL-PARTY-FRONTEND-1`, 388+ events since 2026-09-04, all three networks, HTTP 200):
 *
 *     [{"code":"invalid_type","expected":"string","received":"undefined",
 *       "path":"tokensBalance.3.formattedBalanceInUSD","message":"Required"}, … .4, .5, .6]
 *
 * Two rules are pinned here. [R1] an OMITTED `formattedBalanceInUSD` is the backend saying
 * "unpriced", which is what `"NaN"` used to say, so it parses. [R2] rows are parsed ONE BY ONE, so
 * the row the backend breaks next costs its own row and not the whole network's holdings.
 *
 * Rules v2 [R5] adds nothing here: pricing is decided by `mapHolding`, so its guard and its tests
 * live with the caller (`fetchWalletHoldings.test.ts`). The version tag tracks the rule set this
 * file implements, which is why it moves with the schema's.
 */
import { describe, expect, it } from "vitest";
import {
  parseHoldingRows,
  walletHoldingSchema,
  walletHoldingsSchema,
} from "./walletHoldingsSchema";

/** A priced row, exactly as the backend sends one it could value. */
function priced(symbol: string, usd: string) {
  return {
    address: `0x${symbol.toLowerCase()}`,
    name: symbol,
    symbol,
    logo: `https://logo/${symbol}.png`,
    decimals: 18,
    balance: 1,
    formattedBalance: "1",
    priceUSD: Number(usd),
    formattedBalanceInUSD: usd,
    isNative: false,
  };
}

/**
 * An UNPRICED row as the backend sends one TODAY: `priceUSD` and `formattedBalanceInUSD` are both
 * absent. The header of `mapHolding` still records the older contract (`formattedBalanceInUSD:
 * "NaN"`); this is the drift that took the whole read down.
 */
function unpriced(symbol: string) {
  return {
    address: `0x${symbol.toLowerCase()}`,
    name: symbol,
    symbol,
    decimals: 18,
    balance: 1,
    formattedBalance: "1",
    isNative: false,
  };
}

/** The captured shape: three rows `tokens/multi` priced, four it could not. */
const capturedPayload = {
  wallet: "0x2958000000000000000000000000000000006532",
  tokensBalance: [
    priced("USDC", "1200.5"),
    priced("ETH", "50"),
    priced("WBTC", "300"),
    unpriced("AAA"),
    unpriced("BBB"),
    unpriced("CCC"),
    unpriced("DDD"),
  ],
  transactions: [],
};

describe("walletHoldingSchema", () => {
  // @rule POO-1893 [R1]
  it("[R1] accepts a row whose formattedBalanceInUSD the backend omitted", () => {
    const parsed = walletHoldingSchema.parse(unpriced("AAA"));
    expect(parsed.formattedBalanceInUSD).toBeUndefined();
    expect(parsed.symbol).toBe("AAA");
  });

  it("still rejects a row missing a field the mapper cannot do without", () => {
    expect(
      walletHoldingSchema.safeParse({ ...priced("USDC", "1"), symbol: undefined }).success,
    ).toBe(false);
  });
});

describe("walletHoldingsSchema", () => {
  /**
   * @rule POO-1893 [R4] — the regression. On the pre-fix schema this throws with exactly the four
   * `tokensBalance.N.formattedBalanceInUSD` issues Sentry recorded, and the three PRICED rows above
   * are discarded with them, which is the whole defect: one object failure rejects the array and
   * therefore the network.
   */
  it("[R4] parses the captured payload instead of rejecting the whole network", () => {
    const parsed = walletHoldingsSchema.parse(capturedPayload);
    expect(parsed.tokensBalance).toHaveLength(7);
  });

  /**
   * @rule POO-1893 [R2] — tolerance stops where it would hide a contract break. A `tokensBalance`
   * that is not an array at all is a shape change, not a drifted field, and must still fail loudly.
   */
  it("[R2] still rejects a payload whose tokensBalance is not an array", () => {
    expect(
      walletHoldingsSchema.safeParse({ tokensBalance: { "0": priced("USDC", "1") } }).success,
    ).toBe(false);
  });
});

describe("parseHoldingRows", () => {
  // @rule POO-1893 [R1]/[R4]
  it("[R4] returns every captured row, priced and unpriced alike, with nothing rejected", () => {
    const { holdings, rejected } = parseHoldingRows(capturedPayload.tokensBalance);
    expect(holdings.map((h) => h.symbol)).toEqual([
      "USDC",
      "ETH",
      "WBTC",
      "AAA",
      "BBB",
      "CCC",
      "DDD",
    ]);
    expect(rejected).toEqual([]);
  });

  /**
   * @rule POO-1893 [R2] — the part that stops the THIRD outage of this class (the portfolio
   * dashboard was the first, this read the second). A row the backend breaks in a way [R1] does not
   * cover costs its own row, and the rows either side of it still reach the user.
   */
  it("[R2] keeps the readable rows when one row is unreadable", () => {
    const { holdings, rejected } = parseHoldingRows([
      priced("USDC", "100"),
      { ...priced("DAI", "30"), formattedBalance: 30 },
      priced("ETH", "50"),
    ]);

    expect(holdings.map((h) => h.symbol)).toEqual(["USDC", "ETH"]);
    expect(rejected).toHaveLength(1);
  });

  /**
   * @rule POO-1893 [R2] — the dropped row has to be NAMEABLE, because silent tolerance is how the
   * next dropped field becomes invisible instead of merely wrong. The issue keeps the same
   * `tokensBalance.<index>.<field>` path the Sentry evidence is written in.
   */
  it("[R2] re-paths a rejected row's issues to tokensBalance.<index>.<field>", () => {
    const { rejected } = parseHoldingRows([
      priced("USDC", "100"),
      { ...priced("DAI", "30"), formattedBalance: 30 },
    ]);

    expect(rejected[0]?.path).toEqual(["tokensBalance", 1, "formattedBalance"]);
  });

  /**
   * @rule POO-1893 [R3] — a payload in which NOT ONE row is readable is a contract break rather
   * than metadata drift, and the caller needs to be able to tell them apart: returning "no
   * holdings" for it would render a funded wallet as EMPTY, which is worse than the USDC-only
   * fallback [R3] preserves.
   */
  it("[R3] rejects every row when the whole row shape changed", () => {
    const { holdings, rejected } = parseHoldingRows([{ token: "USDC" }, { token: "ETH" }]);

    expect(holdings).toEqual([]);
    expect(rejected.length).toBeGreaterThanOrEqual(2);
  });

  it("returns nothing and rejects nothing for an empty list", () => {
    expect(parseHoldingRows([])).toEqual({ holdings: [], rejected: [] });
  });
});
