/**
 * @id PP-MGR-LIB-018
 * @name mandateCatalog tests
 * @implements-rules-version v2 (POO-2121 rules v1, POO-2142 rules v2)
 * @analytics-events none, a pure catalog; the builder shell owns the mandate events.
 *
 * Covers R16/R17 v2 (networks + availability), R18 (deposit token), R20/R21 (protocols), R25 (token
 * union) and R28 (priced set). The catalog reads no flag since rules v2 (POO-2142), so no flag
 * runtime is mocked.
 */
import { describe, expect, it } from "vitest";
import { buildMandateCatalog, type MandateNetwork, type MandateProtocol } from "./mandateCatalog";
import { type NetworkId, PRICED_SYMBOLS, type ProtocolId } from "./mandateDraft";

const CATALOG = buildMandateCatalog();
// PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
// const CATALOG_OFF = buildMandateCatalog({ robinhoodChain: false });

/** One network row, failing the test loudly when the catalog does not carry it. */
function network(id: NetworkId): MandateNetwork {
  const found = CATALOG.networks.find((n) => n.id === id);
  if (!found) throw new Error(`fixture: no ${id} network in the catalog`);
  return found;
}

/** One protocol row, same contract as {@link network}. */
function protocol(id: ProtocolId): MandateProtocol {
  const found = CATALOG.protocols.find((p) => p.id === id);
  if (!found) throw new Error(`fixture: no ${id} protocol in the catalog`);
  return found;
}

describe("buildMandateCatalog, networks", () => {
  it("lists the hub and Robinhood Chain only, in catalog order with the hub first", () => {
    // @rule R16 v2: Base, Polygon and Unichain are no longer offered (POO-2142).
    expect(CATALOG.networks.map((n) => n.id)).toEqual([
      "arbitrum",
      "robinhood",
      // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
      // "base",
      // "polygon",
      // "unichain",
    ]);
    expect(CATALOG.networks[0]).toMatchObject({ id: "arbitrum", isHub: true, available: true });
    expect(CATALOG.networks.filter((n) => n.isHub)).toHaveLength(1);
  });

  it("carries the translation KEY in `name`, never a display string", () => {
    // @rule R16 v2
    expect(CATALOG.networks.map((n) => n.name)).toEqual([
      "fundBuilder.networkNames.arbitrum",
      "fundBuilder.networkNames.robinhood",
      // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
      // "fundBuilder.networkNames.base",
      // "fundBuilder.networkNames.polygon",
      // "fundBuilder.networkNames.unichain",
    ]);
  });

  it("makes Robinhood Chain always available, with no flag to read", () => {
    // @rule R17 v2: the fund builder no longer reads the `robinhoodChain` flag (POO-2142).
    expect(network("robinhood")).toMatchObject({ isHub: false, available: true });
    expect(CATALOG.networks.every((n) => n.available)).toBe(true);
  });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // it("makes Robinhood Chain available only while its flag is on", () => {
  //   // @rule R17
  //   const on = CATALOG.networks.find((n) => n.id === "robinhood");
  //   const off = CATALOG_OFF.networks.find((n) => n.id === "robinhood");
  //   expect(on?.available).toBe(true);
  //   expect(off?.available).toBe(false);
  // });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // it("keeps base, polygon and unichain unavailable regardless of the flag", () => {
  //   // @rule R17
  //   for (const id of ["base", "polygon", "unichain"] as const) {
  //     expect(CATALOG.networks.find((n) => n.id === id)?.available).toBe(false);
  //     expect(CATALOG_OFF.networks.find((n) => n.id === id)?.available).toBe(false);
  //   }
  // });

  it("carries the brand colour and the chain id", () => {
    // @rule R17
    expect(network("arbitrum").brandColor).toBe("#28A0F0");
    expect(network("robinhood").brandColor).toBe("#00C805");
    // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
    // expect(network("base").brandColor).toBe("#0052FF");
    // expect(network("polygon").brandColor).toBe("#8247E5");
    // expect(network("unichain").brandColor).toBe("#F50DB4");
    expect(network("arbitrum").chainId).toBe(42161);
    expect(network("robinhood").chainId).toBe(4663);
    // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
    // expect(network("base").chainId).toBe(8453);
    // expect(network("polygon").chainId).toBe(137);
    // expect(network("unichain").chainId).toBeNull();
  });
});

describe("buildMandateCatalog, deposit token", () => {
  it("returns the chain's stable with its own label on every network that has one", () => {
    // @rule R18
    for (const id of [
      "arbitrum",
      // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
      // "base",
      // "polygon",
    ] as const) {
      const token = CATALOG.depositTokenFor(id);
      expect(token).not.toBeNull();
      expect(token?.symbol).toBe("USDC");
      expect(token?.name).toBe("USD Coin");
      expect(token?.network).toBe(id);
      expect(token?.priced).toBe(true);
      expect(token?.address).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });

  it("labels the Robinhood Chain deposit token USDG, the chain's own stable (never the literal USDC)", () => {
    // @rule R18 (coordinator decision 2026-10-03: the chain config's label wins, POO-1779 [R1])
    const token = CATALOG.depositTokenFor("robinhood");
    expect(token?.symbol).toBe("USDG");
    expect(token?.name).toBe("Global Dollar");
    expect(token?.network).toBe("robinhood");
    expect(token?.priced).toBe(true);
    // The address is the chain's own stable (USDG), not an Arbitrum USDC address.
    expect(token?.address).toBe("0x5fc5360d0400a0fd4f2af552add042d716f1d168");
  });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // it("returns null for a network with no stable in the chain config", () => {
  //   // @rule R18
  //   expect(CATALOG.depositTokenFor("unichain")).toBeNull();
  // });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // it("returns the deposit token regardless of the network flag", () => {
  //   // @rule R18
  //   expect(CATALOG_OFF.depositTokenFor("robinhood")?.symbol).toBe("USDG");
  // });
});

describe("buildMandateCatalog, protocols", () => {
  it("lists the six protocols in catalog order with the required two first", () => {
    // @rule R20
    expect(CATALOG.protocols.map((p) => p.id)).toEqual([
      "uniswap-v3-swap",
      "across",
      "aave-v3",
      "uniswap-v3",
      "uniswap-v4",
      "gmx",
    ]);
    expect(CATALOG.protocols.filter((p) => p.required).map((p) => p.id)).toEqual([
      "uniswap-v3-swap",
      "across",
    ]);
  });

  it("carries the kind, the name key and the caption key per kind", () => {
    // @rule R20
    expect(protocol("uniswap-v3-swap")).toMatchObject({
      kind: "swap",
      name: "fundBuilder.protocolNames.uniswapV3Swap",
      captionKey: "fundBuilder.protocolCaptions.swap",
    });
    expect(protocol("across")).toMatchObject({
      kind: "bridge",
      name: "fundBuilder.protocolNames.across",
      captionKey: "fundBuilder.protocolCaptions.bridge",
    });
    expect(protocol("aave-v3")).toMatchObject({
      kind: "lending",
      name: "fundBuilder.protocolNames.aaveV3",
      captionKey: "fundBuilder.protocolCaptions.lending",
    });
    expect(protocol("uniswap-v3")).toMatchObject({
      kind: "dex",
      name: "fundBuilder.protocolNames.uniswapV3",
      captionKey: "fundBuilder.protocolCaptions.dex",
    });
    expect(protocol("uniswap-v4")).toMatchObject({
      kind: "dex",
      name: "fundBuilder.protocolNames.uniswapV4",
      captionKey: "fundBuilder.protocolCaptions.dex",
    });
    expect(protocol("gmx")).toMatchObject({
      kind: "perps",
      name: "fundBuilder.protocolNames.gmx",
      captionKey: "fundBuilder.protocolCaptions.perps",
    });
  });

  it("scopes each protocol to the networks it runs on", () => {
    // @rule R20 @rule R16 v2: no protocol runs on a network the mandate no longer offers.
    const all: NetworkId[] = [
      "arbitrum",
      "robinhood",
      // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
      // "base",
      // "polygon",
      // "unichain",
    ];
    expect(protocol("uniswap-v3-swap").availableOn).toEqual(all);
    expect(protocol("across").availableOn).toEqual(all);
    expect(protocol("aave-v3").availableOn).toEqual(["arbitrum"]);
    expect(protocol("uniswap-v3").availableOn).toEqual([
      "arbitrum",
      "robinhood",
      // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
      // "base",
      // "polygon",
    ]);
    expect(protocol("uniswap-v4").availableOn).toEqual(["arbitrum", "robinhood"]);
    expect(protocol("gmx").availableOn).toEqual([]);
  });

  it("marks only GMX unavailable", () => {
    // @rule R21
    expect(CATALOG.protocols.filter((p) => !p.available).map((p) => p.id)).toEqual(["gmx"]);
  });
});

describe("buildMandateCatalog, tokensFor", () => {
  it("returns the network's static list minus the deposit token, sorted by symbol", () => {
    // @rule R25
    const tokens = CATALOG.tokensFor(["arbitrum"], ["uniswap-v3-swap", "across"]);
    expect(tokens.length).toBeGreaterThan(50);
    expect(tokens.every((t) => t.network === "arbitrum")).toBe(true);
    const deposit = CATALOG.depositTokenFor("arbitrum");
    expect(tokens.some((t) => t.address === deposit?.address)).toBe(false);
    const symbols = tokens.map((t) => t.symbol);
    expect([...symbols].sort((a, b) => a.localeCompare(b))).toEqual(symbols);
  });

  it("unions the selected networks and keeps one entry per network per token", () => {
    // @rule R25
    const tokens = CATALOG.tokensFor(["arbitrum", "robinhood"], ["uniswap-v3-swap", "across"]);
    const networks = new Set(tokens.map((t) => t.network));
    expect(networks).toEqual(new Set(["arbitrum", "robinhood"]));
    const eth = tokens.filter((t) => t.symbol === "ETH");
    expect(eth.map((t) => t.network).sort()).toEqual(["arbitrum", "robinhood"]);
  });

  it("drops the Robinhood stable from the catalog list, since it is the deposit token", () => {
    // @rule R25
    const tokens = CATALOG.tokensFor(["robinhood"], ["uniswap-v3-swap", "across"]);
    expect(tokens.some((t) => t.symbol === "USDG")).toBe(false);
  });

  it("contributes nothing for an empty network list", () => {
    // @rule R25
    // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
    // expect(CATALOG.tokensFor(["unichain"], ["uniswap-v3-swap", "across"])).toEqual([]);
    expect(CATALOG.tokensFor([], ["uniswap-v3-swap", "across"])).toEqual([]);
  });

  it("does not narrow the list by protocol today", () => {
    // @rule R25
    const swapOnly = CATALOG.tokensFor(["arbitrum"], ["uniswap-v3-swap", "across"]);
    const withDex = CATALOG.tokensFor(["arbitrum"], ["uniswap-v3-swap", "across", "uniswap-v4"]);
    expect(withDex.map((t) => t.address)).toEqual(swapOnly.map((t) => t.address));
  });

  it("flags only the hub-priced symbols as priced", () => {
    // @rule R28
    const tokens = CATALOG.tokensFor(["arbitrum"], ["uniswap-v3-swap", "across"]);
    const priced = tokens.filter((t) => t.priced).map((t) => t.symbol);
    expect(new Set(priced)).toEqual(
      new Set(["ETH", "USDT", "WBTC", "LINK", "DAI", "ARB", "wstETH"]),
    );
    expect(tokens.filter((t) => !t.priced).length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token.priced).toBe(PRICED_SYMBOLS.has(token.symbol.toLowerCase()));
    }
  });

  it("never marks a bridged USDC.e as priced", () => {
    // @rule R28
    expect(PRICED_SYMBOLS.has("usdc.e")).toBe(false);
    const tokens = CATALOG.tokensFor(["arbitrum"], ["uniswap-v3-swap", "across"]);
    const bridged = tokens.find((t) => t.symbol.toLowerCase() === "usdc.e");
    if (bridged) expect(bridged.priced).toBe(false);
  });

  it("carries a logo url or an explicit null", () => {
    // @rule R25
    const tokens = CATALOG.tokensFor(["arbitrum"], ["uniswap-v3-swap", "across"]);
    for (const token of tokens) {
      expect(token.logoUrl === null || typeof token.logoUrl === "string").toBe(true);
    }
  });
});
