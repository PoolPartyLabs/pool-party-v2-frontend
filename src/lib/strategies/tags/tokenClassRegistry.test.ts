/**
 * @id PP-STR-LIB-012
 * @name tokenClassRegistry tests
 * @implements-rules-version v1
 *
 * [R1] Token-class registry: address-keyed (chainId, lowercased address) classification into a
 * TokenClass, the precedence tie-break, the mock-only symbol fallback, and the wiring resolver.
 */
import { describe, expect, it } from "vitest";
import {
  classByPrecedence,
  resolveTokenClass,
  tokenClass,
  tokenClassBySymbol,
} from "./tokenClassRegistry";

// Real public token addresses used by the registry (checked against the address keys).
const BASE = 8453;
const ARB = 42161;
const POLY = 137;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const CBETH_BASE = "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22";
const CBBTC_BASE = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const AERO_BASE = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const DEGEN_BASE = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const WSTETH_ARB = "0x5979D7b546E38E414F7E9822514be443A4800529";
const WBTC_ARB = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const ARB_TOKEN = "0x912CE59144191C1204E64559FE8253a0e49E6548";
const WPOL_POLY = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
const WBTC_POLY = "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6";

describe("tokenClass (address-keyed, R1)", () => {
  // @rule R1 — stablecoins classify from the address.
  it("classifies stablecoins by address", () => {
    expect(tokenClass(BASE, USDC_BASE)).toBe("stablecoin");
  });

  // @rule R1 — the key is the LOWERCASED address (mixed-case input still resolves).
  it("is case-insensitive on the address (lowercased key)", () => {
    expect(tokenClass(BASE, USDC_BASE.toLowerCase())).toBe("stablecoin");
    expect(tokenClass(BASE, USDC_BASE.toUpperCase().replace("0X", "0x"))).toBe("stablecoin");
  });

  // @rule R1 — wrapped/staked BTC (cbBTC, WBTC) → bitcoin.
  it("maps wrapped/staked BTC to bitcoin", () => {
    expect(tokenClass(BASE, CBBTC_BASE)).toBe("bitcoin");
    expect(tokenClass(ARB, WBTC_ARB)).toBe("bitcoin");
    expect(tokenClass(POLY, WBTC_POLY)).toBe("bitcoin");
  });

  // @rule R1 — wrapped/staked ETH (WETH, cbETH, wstETH) → ethereum.
  it("maps wrapped/staked ETH to ethereum", () => {
    expect(tokenClass(BASE, WETH_BASE)).toBe("ethereum");
    expect(tokenClass(BASE, CBETH_BASE)).toBe("ethereum");
    expect(tokenClass(ARB, WSTETH_ARB)).toBe("ethereum");
  });

  // @rule R1 — governance/DeFi tokens → altcoin; meme tokens → meme.
  it("maps altcoins and memes", () => {
    expect(tokenClass(BASE, AERO_BASE)).toBe("altcoin");
    expect(tokenClass(ARB, ARB_TOKEN)).toBe("altcoin");
    expect(tokenClass(POLY, WPOL_POLY)).toBe("altcoin");
    expect(tokenClass(BASE, DEGEN_BASE)).toBe("meme");
  });

  // @rule R1 — an address absent from the registry is unverified.
  it("returns unverified for an unknown address", () => {
    expect(tokenClass(BASE, "0x000000000000000000000000000000000000dead")).toBe("unverified");
  });

  // @rule R1 — the SAME address on a DIFFERENT chain is not assumed (keyed by (chainId, address)).
  it("does not classify a Base address queried under the wrong chain", () => {
    // USDC's Base address is not a registered key under Arbitrum.
    expect(tokenClass(ARB, USDC_BASE)).toBe("unverified");
  });

  // @rule R1 — the registry is the production contract: a spoofed token (unknown address) is
  // unverified regardless of what symbol it claims (tokenClass never reads a symbol).
  it("ignores the symbol entirely (anti-spoofing)", () => {
    // An unknown address is unverified even though the same slot could carry a "USDC" symbol.
    expect(tokenClass(BASE, "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")).toBe("unverified");
  });
});

describe("tokenClassBySymbol (MOCK-ONLY fallback, R1)", () => {
  // @rule R1 — the mock-only symbol fallback classifies the common symbols.
  it("classifies common symbols (case-insensitive)", () => {
    expect(tokenClassBySymbol("USDC")).toBe("stablecoin");
    expect(tokenClassBySymbol("usdc")).toBe("stablecoin");
    expect(tokenClassBySymbol("WETH")).toBe("ethereum");
    expect(tokenClassBySymbol("ETH")).toBe("ethereum");
    expect(tokenClassBySymbol("WBTC")).toBe("bitcoin");
    expect(tokenClassBySymbol("PEPE")).toBe("meme");
    expect(tokenClassBySymbol("AERO")).toBe("altcoin");
  });

  // @rule R1 — an unknown symbol is unverified.
  it("returns unverified for an unknown symbol", () => {
    expect(tokenClassBySymbol("NOTATOKEN")).toBe("unverified");
    expect(tokenClassBySymbol("")).toBe("unverified");
  });

  // @rule R1 fold — yield-bearing stables (sDAI, sUSDe) fold to stablecoin.
  it("folds yield-bearing stables (sDAI, sUSDe) to stablecoin", () => {
    expect(tokenClassBySymbol("sDAI")).toBe("stablecoin");
    expect(tokenClassBySymbol("sUSDe")).toBe("stablecoin");
  });

  // @rule R1 fold — RWA (PAXG, tokenized treasuries) fold to altcoin.
  it("folds RWA (PAXG) to altcoin", () => {
    expect(tokenClassBySymbol("PAXG")).toBe("altcoin");
  });

  // @rule R1 — every token symbol that appears in the pool/strategy mocks classifies (not unverified).
  it("classifies every symbol that appears in the mocks", () => {
    // From tokens.ts, pools.ts (uniswapPools), and strategies.ts poolPair/receiveTokens.
    const mockSymbols = [
      "USDC",
      "WETH",
      "ETH",
      "cbETH",
      "DAI",
      "USDbC",
      "AERO",
      "cbBTC",
      "USDT",
      "WBTC",
      "ARB",
      "GMX",
      "WMATIC",
      "SOL",
      "DEGEN",
    ];
    for (const symbol of mockSymbols) {
      expect(tokenClassBySymbol(symbol), `symbol ${symbol} should classify`).not.toBe("unverified");
    }
  });
});

describe("classByPrecedence (R1 tie-break)", () => {
  // @rule R1 — precedence stablecoin > bitcoin > ethereum > meme > altcoin.
  it("applies the documented precedence order", () => {
    expect(classByPrecedence(["altcoin", "stablecoin"])).toBe("stablecoin");
    expect(classByPrecedence(["ethereum", "bitcoin"])).toBe("bitcoin");
    expect(classByPrecedence(["altcoin", "ethereum"])).toBe("ethereum");
    expect(classByPrecedence(["altcoin", "meme"])).toBe("meme");
    expect(classByPrecedence(["altcoin"])).toBe("altcoin");
  });

  // @rule R1 — no candidates (or only unverified) → unverified.
  it("returns unverified when there is no ranked candidate", () => {
    expect(classByPrecedence([])).toBe("unverified");
    expect(classByPrecedence(["unverified"])).toBe("unverified");
  });
});

describe("resolveTokenClass (wiring resolver, R1)", () => {
  // @rule R1 — with a chainId + address, the address registry is the trusted source (production).
  it("prefers the address registry when chainId + address are present", () => {
    expect(resolveTokenClass({ chainId: BASE, address: USDC_BASE, symbol: "USDC" })).toBe(
      "stablecoin",
    );
    expect(resolveTokenClass({ chainId: ARB, address: WBTC_ARB, symbol: "WBTC" })).toBe("bitcoin");
  });

  // @rule R1 — an unknown address stays unverified even when the (spoofable) symbol is a known one.
  it("does NOT upgrade an unknown address via the symbol (anti-spoofing, production)", () => {
    expect(
      resolveTokenClass({
        chainId: BASE,
        address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        symbol: "USDC",
      }),
    ).toBe("unverified");
  });

  // @rule R1 — no usable address (legacy/mock) → the mock-only symbol fallback.
  it("falls back to the symbol only when there is no usable address", () => {
    expect(resolveTokenClass({ symbol: "USDC" })).toBe("stablecoin");
    expect(resolveTokenClass({ chainId: BASE, symbol: "WETH" })).toBe("ethereum");
    // address present but no chainId → the (chainId,address) key is unusable → symbol fallback.
    expect(resolveTokenClass({ address: WETH_BASE, symbol: "WETH" })).toBe("ethereum");
  });

  // @rule R1 — nothing to go on → unverified.
  it("returns unverified with no address and no known symbol", () => {
    expect(resolveTokenClass({})).toBe("unverified");
    expect(resolveTokenClass({ symbol: "NOPE" })).toBe("unverified");
  });
});

describe("expanded real-address registry (POO-830 S2)", () => {
  // @rule R1 — Arbitrum majors classify by their real canonical addresses.
  it("classifies Arbitrum majors by address", () => {
    expect(tokenClass(ARB, ARB_TOKEN)).toBe("altcoin"); // ARB
    expect(tokenClass(ARB, WBTC_ARB)).toBe("bitcoin"); // WBTC
    expect(tokenClass(ARB, "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4")).toBe("altcoin"); // LINK
    expect(tokenClass(ARB, "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0")).toBe("altcoin"); // UNI
    expect(tokenClass(ARB, "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196")).toBe("altcoin"); // AAVE
    expect(tokenClass(ARB, "0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978")).toBe("altcoin"); // CRV
    expect(tokenClass(ARB, "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8")).toBe("altcoin"); // PENDLE
    expect(tokenClass(ARB, "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F")).toBe("stablecoin"); // FRAX
  });

  // @rule R1 — Polygon majors classify by their real canonical addresses.
  it("classifies Polygon majors by address", () => {
    expect(tokenClass(POLY, "0xD6DF932A45C0f255f85145f286eA0b292B21C90B")).toBe("altcoin"); // AAVE
    expect(tokenClass(POLY, "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39")).toBe("altcoin"); // LINK
    expect(tokenClass(POLY, "0x172370d5Cd63279eFa6d502DAB29171933a610AF")).toBe("altcoin"); // CRV
    expect(tokenClass(POLY, "0xb33EaAd8d922B1083446DC23f610c2567fB5180f")).toBe("altcoin"); // UNI
  });

  // @rule R1 — Base BRETT classifies as a meme by address.
  it("classifies Base BRETT as meme by address", () => {
    expect(tokenClass(BASE, "0x532f27101965dd16442E59d40670FaF5eBB142E4")).toBe("meme");
  });

  // @rule R7 — a real ARB/USDC pool derives from the addresses (production path): one stable + one
  // altcoin → [altcoins].
  it("[R7] derives real ARB/USDC via the address path", () => {
    expect(
      resolveTokenClass({
        chainId: ARB,
        address: ARB_TOKEN,
        symbol: "ARB",
      }),
    ).toBe("altcoin");
  });
});
