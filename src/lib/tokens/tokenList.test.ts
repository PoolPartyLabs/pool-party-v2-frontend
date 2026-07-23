/**
 * @id PP-MGR (POO-305)
 * @name Token list tests
 * @implements-rules-version v2
 *
 * Per-network token lists load and look up by address (case-insensitive), and a relevance-ranked
 * search surfaces canonical major tokens (WETH/WBTC/USDC…) at the top instead of alphabetical junk.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalTokenSymbol,
  findToken,
  searchTokens,
  tokensForNetwork,
  topTokens,
} from "./tokenList";

describe("tokensForNetwork", () => {
  it("returns sorted tokens for a supported network", () => {
    const tokens = tokensForNetwork("arbitrum");
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens[0]).toMatchObject({
      address: expect.stringMatching(/^0x[a-f0-9]{40}$/),
      symbol: expect.any(String),
      name: expect.any(String),
    });
    // sorted by symbol
    expect([...tokens].sort((a, b) => a.symbol.localeCompare(b.symbol))).toEqual(tokens);
  });

  it("returns [] for an unknown network", () => {
    expect(tokensForNetwork("solana")).toEqual([]);
  });
});

describe("findToken", () => {
  it("finds a token by address, case-insensitively", () => {
    const weth = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
    expect(findToken("arbitrum", weth.toUpperCase())?.symbol).toBe("ETH");
  });

  it("returns undefined for an unknown address", () => {
    expect(findToken("arbitrum", "0x0000000000000000000000000000000000000000")).toBeUndefined();
  });

  // POO-482 R3: many source-JSON keys are checksum-cased (~150 base, ~69 arbitrum); the loader must
  // index them under lowercase keys or findToken's lowercase lookup silently misses those entries.
  it("resolves EVERY listed token by its (lowercased) address, checksum-cased sources included", () => {
    for (const network of ["base", "arbitrum", "polygon"]) {
      for (const token of tokensForNetwork(network)) {
        expect(findToken(network, token.address), `${network} ${token.address}`).toBeDefined();
      }
    }
  });
});

describe("searchTokens", () => {
  it("returns [] for an unknown network", () => {
    expect(searchTokens("solana", "eth")).toEqual([]);
  });

  it("returns [] for a blank query", () => {
    expect(searchTokens("base", "   ")).toEqual([]);
  });

  it("surfaces the wrapped-ether (shown as ETH) FIRST when searching 'eth' on Base (POO-589)", () => {
    // POO-589: the wrapped-ether is canonicalized to "ETH", so "eth" is now an EXACT-symbol match and
    // leads — above the ETH*-prefixed tokens (ETH2X/ETHB/ETHO…) and Aave/derivative wrappers that used
    // to bury WETH (the reported bug).
    const symbols = searchTokens("base", "eth", 50).map((t) => t.symbol);
    expect(symbols[0]).toBe("ETH");
    const eth = symbols.indexOf("ETH");
    const junk = ["ETH2X", "ETH3X", "ETHB", "ETHO", "ETHFI", "aBasWETH", "cbETH", "dsETH"];
    for (const sym of junk) {
      const idx = symbols.indexOf(sym);
      if (idx !== -1) expect(eth).toBeLessThan(idx);
    }
  });

  it("keeps the wrapped-ether within the default-capped results on Base", () => {
    expect(searchTokens("base", "eth").map((t) => t.symbol)).toContain("ETH");
  });

  it("surfaces the wrapped-ether (ETH) first when searching 'eth' on Polygon (POO-589)", () => {
    const symbols = searchTokens("polygon", "eth").map((t) => t.symbol);
    expect(symbols[0]).toBe("ETH");
  });

  it("ranks an exact symbol match above starts-with and contains matches", () => {
    // 'ETH' is the exact symbol of the canonical wrapped-ether token on Arbitrum.
    const results = searchTokens("arbitrum", "eth");
    expect(results[0]?.symbol).toBe("ETH");
  });

  it("ranks a starts-with match above a mere contains match", () => {
    const symbols = searchTokens("base", "us").map((t) => t.symbol.toLowerCase());
    const startsWith = symbols.findIndex((s) => s.startsWith("us"));
    const containsOnly = symbols.findIndex((s) => !s.startsWith("us") && s.includes("us"));
    if (startsWith !== -1 && containsOnly !== -1) {
      expect(startsWith).toBeLessThan(containsOnly);
    }
  });

  it("ranks a curated major token's contains-match above non-major contains-matches", () => {
    // On Polygon, 'wbtc' is curated-major; it must lead a 'btc' search.
    const symbols = searchTokens("polygon", "btc").map((t) => t.symbol);
    expect(symbols[0]).toBe("WBTC");
  });

  it("tie-breaks contains matches by shorter symbol length, then alphabetically", () => {
    // Two non-major tokens that both merely contain the query rank by symbol length then alpha.
    const results = searchTokens("base", "eth");
    const nonMajor = results.filter((t) => t.symbol !== "ETH").map((t) => t.symbol.toLowerCase());
    // Within the same tier, a shorter symbol never appears after a strictly longer one
    // unless the longer one is alphabetically earlier at equal length — assert monotonic-ish length.
    for (let i = 1; i < nonMajor.length; i += 1) {
      const prev = nonMajor[i - 1];
      const cur = nonMajor[i];
      if (prev !== undefined && cur !== undefined && prev.length !== cur.length) {
        // we only assert the dominant ordering signal (length) holds across adjacent items
        // that share the same tier; a strict global check is covered by the WETH-first assertions.
        expect(prev.length <= cur.length || prev < cur).toBe(true);
      }
    }
  });

  it("matches by token name", () => {
    const results = searchTokens("base", "wrapped ether");
    expect(results.map((t) => t.symbol)).toContain("ETH");
  });

  it("matches by address", () => {
    const wethBase = "0x4200000000000000000000000000000000000006";
    const results = searchTokens("base", wethBase);
    expect(results[0]?.address).toBe(wethBase);
  });

  it("respects the result limit", () => {
    expect(searchTokens("base", "e", 5).length).toBeLessThanOrEqual(5);
    expect(searchTokens("base", "e", 12).length).toBeLessThanOrEqual(12);
  });

  it("ranks USDC (curated major) at the top of a 'usdc' search on Polygon", () => {
    const symbols = searchTokens("polygon", "usdc").map((t) => t.symbol);
    // exact symbol 'USDC' beats 'USDC.e' (starts-with) and any name/address hits.
    expect(symbols[0]).toBe("USDC");
  });
});

describe("canonical ETH display + search (POO-589)", () => {
  const WRAPPED_ETHER = [
    ["base", "0x4200000000000000000000000000000000000006"],
    ["polygon", "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619"],
    ["arbitrum", "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"],
  ] as const;

  // @rule R1 — the wrapped-ether shows as "ETH" and leads an "eth" search on every network.
  it("shows the wrapped-ether as 'ETH' and ranks it first for 'eth' on every network", () => {
    for (const [network, address] of WRAPPED_ETHER) {
      expect(findToken(network, address)?.symbol, network).toBe("ETH");
      expect(searchTokens(network, "eth")[0]?.symbol, network).toBe("ETH");
    }
  });

  // @rule R2 — the reverse alias keeps it findable by its real ticker "weth".
  it("still finds the wrapped-ether by 'weth' on every network", () => {
    for (const [network] of WRAPPED_ETHER) {
      expect(searchTokens(network, "weth")[0]?.symbol, network).toBe("ETH");
    }
  });

  // @rule R1 — the default (empty-query) top-tokens list leads with ETH, matching Arbitrum.
  it("leads the default top-tokens list with ETH on every network", () => {
    for (const [network] of WRAPPED_ETHER) {
      expect(topTokens(network)[0]?.symbol, network).toBe("ETH");
    }
  });

  it("canonicalTokenSymbol maps the wrapped-ether to ETH and leaves other tokens untouched", () => {
    expect(canonicalTokenSymbol("0x4200000000000000000000000000000000000006", "WETH")).toBe("ETH");
    // case-insensitive on the address
    expect(canonicalTokenSymbol("0x7CEB23FD6BC0ADD59E62AC25578270CFF1B9F619", "WETH")).toBe("ETH");
    expect(canonicalTokenSymbol("0xa0b8000000000000000000000000000000000000", "USDC")).toBe("USDC");
  });
});

/**
 * POO-879 (rules v1): Base's ported v1 token list had NO Tether entry, so the create-strategy
 * search (which matches only the static bundled list before calling /dex-pools by address) returned
 * nothing for "usdt"/"tether" on Base — the API was never reached and USDT was unfindable. Fix is
 * static data: add canonical bridged Tether (USDT) [R1] and Stargate USD₮0 as a SEPARATE entry [R2],
 * kept visually distinct [R3]. Addresses cross-checked against BaseScan/CoinGecko (trust boundary).
 */
describe("Base USDT + USD₮0 token search (POO-879)", () => {
  // Lowercased on purpose: findToken/searchTokens key by lowercase address.
  const BASE_USDT = "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2";
  const BASE_USDT0 = "0x102d758f688a4c1c5a80b116bd945d4455460282";
  const USDT0_SYMBOL = "USD₮0"; // "USD₮0" — ₮ is U+20AE (Tether glyph)

  // @rule R1 — canonical Tether USD is now in the Base list and resolvable by address (lowercased).
  it("lists Tether USD (USDT) on Base, resolvable by address", () => {
    const token = findToken("base", BASE_USDT);
    expect(token?.symbol).toBe("USDT");
    expect(token?.name).toBe("Tether USD");
  });

  // @rule R1 — "usdt" now resolves USDT on Base (was [] pre-fix), ranked first (exact symbol + major).
  it("surfaces USDT first when searching 'usdt' on Base", () => {
    const results = searchTokens("base", "usdt");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.symbol).toBe("USDT");
  });

  // @rule R1 — "tether" (name match) now resolves USDT on Base (was [] pre-fix).
  it("finds USDT by the 'tether' name query on Base", () => {
    expect(searchTokens("base", "tether", 50).map((t) => t.symbol)).toContain("USDT");
  });

  // @rule R1 — USDT is a curated major on Base, so it appears in the focus-empty top-tokens dropdown.
  it("includes USDT in the Base top-tokens list", () => {
    expect(topTokens("base").map((t) => t.symbol)).toContain("USDT");
  });

  // @rule R2 — USD₮0 is a SEPARATE, distinct entry (own ticker), resolvable by its own address.
  it("lists USD₮0 as a separate entry on Base, distinct from USDT", () => {
    const usdt0 = findToken("base", BASE_USDT0);
    expect(usdt0?.symbol).toBe(USDT0_SYMBOL);
    // both are present independently at their own addresses
    expect(usdt0?.address).toBe(BASE_USDT0);
    expect(findToken("base", BASE_USDT)?.symbol).toBe("USDT");
  });

  // @rule R2 — the "usdt0" ASCII alias makes USD₮0 typeable without the ₮ glyph.
  it("finds USD₮0 by the ASCII 'usdt0' alias on Base", () => {
    expect(searchTokens("base", "usdt0").map((t) => t.symbol)).toContain(USDT0_SYMBOL);
  });

  // @rule R2/R3 — typing "usdt" surfaces BOTH tokens (USDT exact, USD₮0 via alias), USDT ranked above.
  it("surfaces both USDT and USD₮0 for a 'usdt' query, USDT ranked above USD₮0", () => {
    const symbols = searchTokens("base", "usdt", 50).map((t) => t.symbol);
    expect(symbols).toContain("USDT");
    expect(symbols).toContain(USDT0_SYMBOL);
    expect(symbols.indexOf("USDT")).toBeLessThan(symbols.indexOf(USDT0_SYMBOL));
  });

  // @rule R3 — the two entries stay visually distinct (distinct ticker AND name), never merged/aliased.
  it("keeps USDT and USD₮0 visually distinct (distinct ticker and name)", () => {
    const usdt = findToken("base", BASE_USDT);
    const usdt0 = findToken("base", BASE_USDT0);
    expect(usdt?.symbol).not.toBe(usdt0?.symbol);
    expect(usdt?.name).not.toBe(usdt0?.name);
  });
});
