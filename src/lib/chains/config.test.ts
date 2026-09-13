/**
 * @id PP-CORE-SETUP (POO-195)
 * @name Chain config tests
 * @implements-rules-version v1
 *
 * Drift-guard tests for the single-source chain config. Ensures wagmi, Privy, USDC, and CSP
 * all derive from the same array, and that per-chain metadata is correct.
 */

import { arbitrum, base, polygon } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  activeChainMetas,
  addEthereumChainParams,
  type ChainMeta,
  defaultChain,
  getChainById,
  getExplorerTxUrl,
  getUsdcAddress,
  isNetworkSelectable,
  isStableSymbol,
  isWrappedNative,
  nativeSymbol,
  networkStableName,
  networkStableSymbol,
  ROBINHOOD_CHAIN_ID,
  robinhoodChain,
  selectableChainMetas,
  stableName,
  stableSymbol,
  supportedChainMetas,
  supportedChains,
  transportMap,
  wrappedNativeSymbol,
} from "./config";

describe("chain config (POO-195)", () => {
  // [AC-1] Single source array with every operating chain, in display order. POO-1776 [R5]: the
  // three launch chains keep their identity and their order; Robinhood is APPENDED, so nothing that
  // reads position (`defaultChain`'s fallback, `buildProvisioningInput`'s "other chain") moves.
  it("exports Arbitrum, Base, Polygon, then Robinhood Chain, in that order", () => {
    const ids = supportedChains.map((c) => c.id);
    expect(ids).toEqual([arbitrum.id, base.id, polygon.id, ROBINHOOD_CHAIN_ID]);
  });

  it("exports a transport for every supported chain", () => {
    for (const chain of supportedChains) {
      expect(transportMap).toHaveProperty(String(chain.id));
    }
  });

  // [AC-2] USDC per chain correct.
  it("maps USDC on Arbitrum to 0xaf88d065e77c8cC2239327C5EDb3A432268e5831", () => {
    expect(getUsdcAddress(arbitrum.id)).toBe("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
  });

  it("maps USDC on Base to 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", () => {
    expect(getUsdcAddress(base.id)).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  it("recognizes the wrapped-native token per chain (case-insensitive), nothing else", () => {
    expect(isWrappedNative(base.id, "0x4200000000000000000000000000000000000006")).toBe(true);
    expect(
      isWrappedNative(base.id, "0x4200000000000000000000000000000000000006".toUpperCase()),
    ).toBe(true);
    expect(isWrappedNative(arbitrum.id, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1")).toBe(true);
    expect(isWrappedNative(polygon.id, "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270")).toBe(true);
    // A non-wrapped token (USDC) and an unsupported chain are false.
    expect(isWrappedNative(base.id, getUsdcAddress(base.id) as string)).toBe(false);
    expect(isWrappedNative(1, "0x4200000000000000000000000000000000000006")).toBe(false);
  });

  it("maps USDC on Polygon to 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", () => {
    expect(getUsdcAddress(polygon.id)).toBe("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359");
  });

  it("returns decimals 6 for every USDC", () => {
    for (const meta of supportedChainMetas) {
      expect(meta.usdc.decimals).toBe(6);
    }
  });

  /**
   * [AC-3] defaultChain matches NEXT_PUBLIC_CHAIN_ID (42161 = Arbitrum across every env file).
   *
   * POO-1385 [R1]: the fallback is ARBITRUM, and that is a product decision rather than a tidy-up.
   * This value is handed to Privy as `defaultChain`, so it is the chain every external wallet is
   * asked to sit on the moment it connects, before the user has chosen anything. It was Polygon in
   * every deployed env, which is the least used network on the platform, so the common case was a
   * connect on one chain followed by a switch on the first operation. On a wallet that has only some
   * networks enabled (Ledger Live pairs the chains the user selected) it was worse than untidy: the
   * connect-time switch targeted a chain the session did not contain.
   */
  it("resolves defaultChain from NEXT_PUBLIC_CHAIN_ID", () => {
    // In test env, NEXT_PUBLIC_CHAIN_ID is unset, so default should be Arbitrum (42161).
    expect(defaultChain.id).toBe(arbitrum.id);
  });

  // Lookup helpers.
  it("getChainById returns the chain for a known id", () => {
    expect(getChainById(42161)?.id).toBe(arbitrum.id);
    expect(getChainById(137)?.id).toBe(polygon.id);
  });

  it("getChainById returns undefined for unknown id", () => {
    expect(getChainById(999999)).toBeUndefined();
  });

  it("getUsdcAddress returns undefined for unknown chain", () => {
    expect(getUsdcAddress(999999)).toBeUndefined();
  });

  // CSP derivability: RPC URLs are exposed so csp.ts can import them.
  it("exposes rpcUrl for every chain", () => {
    for (const meta of supportedChainMetas) {
      expect(meta.rpcUrl).toMatch(/^https:\/\//);
    }
  });

  // @rule POO-505 R1: the explorer tx URL derives from the viem chain metadata per network slug.
  it("getExplorerTxUrl builds the /tx/ URL for every supported network", () => {
    const hash = "0xabc123";
    expect(getExplorerTxUrl("arbitrum", hash)).toBe("https://arbiscan.io/tx/0xabc123");
    expect(getExplorerTxUrl("base", hash)).toBe("https://basescan.org/tx/0xabc123");
    expect(getExplorerTxUrl("polygon", hash)).toBe("https://polygonscan.com/tx/0xabc123");
  });

  // @rule POO-505 R1/R2: no network or no hash never yields a home/hardcoded URL — it yields nothing.
  it("getExplorerTxUrl returns undefined without a network or a hash", () => {
    expect(getExplorerTxUrl("solana", "0xabc")).toBeUndefined();
    expect(getExplorerTxUrl(undefined, "0xabc")).toBeUndefined();
    expect(getExplorerTxUrl("base", null)).toBeUndefined();
    expect(getExplorerTxUrl("base", "")).toBeUndefined();
  });

  // @rule POO-540 R1: the native token symbol derives from the viem chain per network slug —
  // POL on Polygon, ETH on the EVM L2s. Never hardcoded.
  it("nativeSymbol maps each network slug to its viem native currency symbol", () => {
    expect(nativeSymbol("arbitrum")).toBe(arbitrum.nativeCurrency.symbol);
    expect(nativeSymbol("base")).toBe(base.nativeCurrency.symbol);
    expect(nativeSymbol("polygon")).toBe(polygon.nativeCurrency.symbol);
    // Concrete symbols per today's viem: ETH on the L2s, POL on Polygon.
    expect(nativeSymbol("arbitrum")).toBe("ETH");
    expect(nativeSymbol("base")).toBe("ETH");
    expect(nativeSymbol("polygon")).toBe("POL");
  });

  // @rule POO-540 R4: an unknown or missing network degrades to the ETH default (previous behavior),
  // never crashes.
  it("nativeSymbol falls back to ETH for an unknown or missing network", () => {
    expect(nativeSymbol("solana")).toBe("ETH");
    expect(nativeSymbol(undefined)).toBe("ETH");
    expect(nativeSymbol(null)).toBe("ETH");
    expect(nativeSymbol("")).toBe("ETH");
  });

  // @rule POO-878 R1: the wrapped-native token symbol for the seed funding selector's ERC-20 option —
  // "W" prefixed on the native symbol (WETH on the L2s, WPOL on Polygon). Falls back to WETH.
  it("wrappedNativeSymbol prefixes the native symbol with W per network", () => {
    expect(wrappedNativeSymbol("arbitrum")).toBe("WETH");
    expect(wrappedNativeSymbol("base")).toBe("WETH");
    expect(wrappedNativeSymbol("polygon")).toBe("WPOL");
    expect(wrappedNativeSymbol("solana")).toBe("WETH");
    expect(wrappedNativeSymbol(undefined)).toBe("WETH");
  });
});

/**
 * POO-1776: Robinhood Chain (Arbitrum Orbit, id 4663, ETH gas). The alpha deployment runs the
 * current (non-legacy) manager, and its stable is USDG rather than a USDC — the `usdc` field is the
 * chain's STABLE slot, and the legacy naming is not re-litigated here (labels are POO-1779).
 */
describe("Robinhood Chain (POO-1776)", () => {
  const meta = supportedChainMetas.find((m) => m.chain.id === ROBINHOOD_CHAIN_ID);

  // @rule R2
  it("carries the deployed chain definition: id 4663, ETH gas, public RPC, Blockscout explorer", () => {
    expect(meta).toBeDefined();
    expect(robinhoodChain.id).toBe(4663);
    expect(robinhoodChain.name).toBe("Robinhood Chain");
    expect(robinhoodChain.nativeCurrency).toEqual({ name: "Ether", symbol: "ETH", decimals: 18 });
    expect(meta?.rpcUrl).toBe("https://rpc.mainnet.chain.robinhood.com");
    expect(robinhoodChain.rpcUrls.default.http).toEqual([
      "https://rpc.mainnet.chain.robinhood.com",
    ]);
    expect(robinhoodChain.blockExplorers?.default.url).toBe(
      "https://robinhoodchain.blockscout.com",
    );
  });

  // @rule R2
  it("maps to the `robinhood` API network and the deployed USDG / WETH9 addresses", () => {
    expect(meta?.apiNetworkId).toBe("robinhood");
    expect(meta?.displayName).toBe("Robinhood Chain");
    expect(meta?.usdc).toEqual({
      address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      decimals: 6,
      // POO-1779 [R1]: the stable slot on 4663 holds USDG, and says so — ticker, name AND art.
      symbol: "USDG",
      name: "Global Dollar",
      logoUrl: "https://assets.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png",
    });
    expect(meta?.wrappedNative).toBe("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
    expect(getUsdcAddress(ROBINHOOD_CHAIN_ID)).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    expect(isWrappedNative(ROBINHOOD_CHAIN_ID, "0x0bd7d308f8e1639fab988df18a8011f41eacad73")).toBe(
      true,
    );
  });

  /**
   * @rule R2 — the alpha runs the CURRENT manager (v0.5.x), not the v0.8.0 legacy backend, so the
   * one field that steers routing (`isLegacy`) must say so. Nothing else branches per chain: the
   * legacy split is driven purely by this flag (no per-chain conditional in useInvest / useMoveRange
   * / lib/api/client), which is exactly why getting it wrong here is silent everywhere else.
   */
  it("is a current (non-legacy) network, and native ETH gas resolves through the shared helpers", () => {
    expect(meta?.isLegacy).toBe(false);
    expect(nativeSymbol("robinhood")).toBe("ETH");
    expect(wrappedNativeSymbol("robinhood")).toBe("WETH");
    expect(getExplorerTxUrl("robinhood", "0xabc123")).toBe(
      "https://robinhoodchain.blockscout.com/tx/0xabc123",
    );
  });

  // @rule R1
  it("stays a wagmi supported chain (with a transport) no matter what the flag says", () => {
    expect(supportedChains.map((c) => c.id)).toContain(ROBINHOOD_CHAIN_ID);
    expect(transportMap).toHaveProperty(String(ROBINHOOD_CHAIN_ID));
    expect(getChainById(ROBINHOOD_CHAIN_ID)?.id).toBe(ROBINHOOD_CHAIN_ID);
  });

  // @rule R1
  it("is offered to a network selector only while `robinhoodChain` is on", () => {
    const on = selectableChainMetas(() => true).map((m) => m.chain.id);
    const off = selectableChainMetas(() => false).map((m) => m.chain.id);
    expect(on).toContain(ROBINHOOD_CHAIN_ID);
    expect(off).not.toContain(ROBINHOOD_CHAIN_ID);
    expect(isNetworkSelectable("robinhood", () => true)).toBe(true);
    expect(isNetworkSelectable("robinhood", () => false)).toBe(false);
  });

  /**
   * @rule R1 — the flag gates the DATA FAN-OUT as well as the selector, and that is the half a
   * "visibility only" reading gets wrong. Every per-network enumeration (`pools?network=robinhood`,
   * `wallet/{addr}?network=robinhood`, the 4663 USDC read) is an outbound call to an alpha
   * deployment the environment has not switched on; with the flag off it must not be made at all.
   * Membership lookups (`getChainById`, `getUsdcAddress`) stay ungated: they answer questions ABOUT
   * a chain the wallet may already be on, and answering costs nothing.
   */
  it("is enumerated for data fan-out only while `robinhoodChain` is on", () => {
    expect(activeChainMetas(() => true).map((m) => m.chain.id)).toContain(ROBINHOOD_CHAIN_ID);
    expect(activeChainMetas(() => false).map((m) => m.chain.id)).not.toContain(ROBINHOOD_CHAIN_ID);
  });

  // @rule R1 — the fan-out enumeration asks for the RIGHT key, like the selector one.
  it("reads exactly the `robinhoodChain` flag key for the fan-out too", () => {
    const asked: string[] = [];
    activeChainMetas((key) => {
      asked.push(key);
      return true;
    });
    expect(asked).toEqual(["robinhoodChain"]);
  });

  // @rule R1 — the predicate is asked for the RIGHT key, not for whatever flag happens to be on.
  it("reads exactly the `robinhoodChain` flag key", () => {
    const asked: string[] = [];
    selectableChainMetas((key) => {
      asked.push(key);
      return true;
    });
    expect(asked).toEqual(["robinhoodChain"]);
  });

  // @rule R5
  it("never gates the three launch chains, whatever the flag says", () => {
    for (const enumerate of [selectableChainMetas, activeChainMetas]) {
      for (const isEnabled of [() => true, () => false]) {
        const ids = enumerate(isEnabled).map((m) => m.chain.id);
        expect(ids.slice(0, 3)).toEqual([arbitrum.id, base.id, polygon.id]);
      }
    }
    expect(isNetworkSelectable("arbitrum", () => false)).toBe(true);
    expect(isNetworkSelectable("base", () => false)).toBe(true);
    expect(isNetworkSelectable("polygon", () => false)).toBe(true);
  });

  // @rule R5 — an unknown slug is not silently hidden; only a chain that DECLARES a flag is gated.
  it("treats an unknown network slug as ungated", () => {
    expect(isNetworkSelectable("solana", () => false)).toBe(true);
  });
});

/**
 * POO-1779: the stable currency's DISPLAY identity per chain. The `usdc` meta field is the stable
 * SLOT (its legacy name is not re-litigated here) and identity on a money path stays the address;
 * what is chain-derived is only the ticker and the full name the product prints next to an amount.
 */
describe("stable currency labels (POO-1779)", () => {
  // @rule R2 — the launch chains keep USDC / USD Coin, by chain id and by API network slug.
  it("labels the launch chains USDC / USD Coin", () => {
    for (const chain of [arbitrum, base, polygon]) {
      expect(stableSymbol(chain.id)).toBe("USDC");
      expect(stableName(chain.id)).toBe("USD Coin");
    }
    for (const slug of ["arbitrum", "base", "polygon"]) {
      expect(networkStableSymbol(slug)).toBe("USDC");
      expect(networkStableName(slug)).toBe("USD Coin");
    }
  });

  // @rule R1 — 4663 is USDG / Global Dollar, by chain id and by slug.
  it("labels Robinhood Chain USDG / Global Dollar", () => {
    expect(stableSymbol(ROBINHOOD_CHAIN_ID)).toBe("USDG");
    expect(stableName(ROBINHOOD_CHAIN_ID)).toBe("Global Dollar");
    expect(networkStableSymbol("robinhood")).toBe("USDG");
    expect(networkStableName("robinhood")).toBe("Global Dollar");
  });

  // @rule R1 — the label rides on the same meta entry as the address, so the two can never disagree.
  it("carries symbol, name and logo beside the address on every chain meta", () => {
    for (const meta of supportedChainMetas) {
      expect(meta.usdc.symbol).toMatch(/^[A-Z]{3,5}$/);
      expect(meta.usdc.name.length).toBeGreaterThan(0);
      expect(meta.usdc.logoUrl).toMatch(/^https:\/\//);
      expect(stableSymbol(meta.chain.id)).toBe(meta.usdc.symbol);
      expect(networkStableSymbol(meta.apiNetworkId)).toBe(meta.usdc.symbol);
    }
  });

  /**
   * @rule R1 — the ART is part of the label. A row reading "USDG · Global Dollar" beside the USDC
   * mark is the same mislabel in a different medium, and it is the one an investor reads FIRST: the
   * icon is 36px of colour, the ticker is four characters of text.
   */
  it("gives the chain whose stable is not USDC its own token art", () => {
    const usdgLogo = supportedChainMetas.find((m) => m.chain.id === ROBINHOOD_CHAIN_ID)?.usdc
      .logoUrl;
    const usdcLogos = supportedChainMetas
      .filter((m) => m.usdc.symbol === "USDC")
      .map((m) => m.usdc.logoUrl);

    expect(usdcLogos).toEqual(Array(usdcLogos.length).fill(usdcLogos[0]));
    expect(usdgLogo).toBeDefined();
    expect(usdcLogos).not.toContain(usdgLogo);
  });

  /**
   * @rule R2 — an unknown chain degrades to USDC / USD Coin rather than to `undefined`.
   *
   * The opposite choice of {@link chainDisplayName}, and for the opposite reason: a display name has
   * somewhere honest to land (the caller's own `?? slug`), while a token label sits inside
   * `formatTokenAmount(amount, symbol)` where an absent symbol reads as a missing token. USDC is the
   * historical value every one of these call sites hardcoded, so degrading to it changes nothing for
   * a caller this config does not know.
   */
  it("degrades to USDC / USD Coin for an unknown or missing chain", () => {
    expect(stableSymbol(999999)).toBe("USDC");
    expect(stableName(undefined)).toBe("USD Coin");
    expect(networkStableSymbol("solana")).toBe("USDC");
    expect(networkStableName(null)).toBe("USD Coin");
  });

  /**
   * @rule R1/R2 — `isStableSymbol` is the symbol-keyed predicate the display pipelines branch on
   * once a symbol stops being the literal "USDC" ("is this the dollar we price at parity and group
   * first"), so every configured stable answers yes and nothing else does.
   */
  it("recognizes every configured stable symbol, case-insensitively, and nothing else", () => {
    for (const meta of supportedChainMetas) {
      expect(isStableSymbol(meta.usdc.symbol)).toBe(true);
      expect(isStableSymbol(meta.usdc.symbol.toLowerCase())).toBe(true);
    }
    expect(isStableSymbol("USDG")).toBe(true);
    expect(isStableSymbol("usdc")).toBe(true);
    for (const other of ["ETH", "WETH", "USDT", "DAI", "", null, undefined]) {
      expect(isStableSymbol(other)).toBe(false);
    }
  });
});

/**
 * POO-1783 [R1]: the EIP-3085 parameters an external wallet needs before it can be switched onto a
 * chain it has never had. Derived here so the wallet is offered the SAME name, RPC and explorer the
 * rest of the product uses, rather than a second hand-kept copy of the chain definition.
 */
describe("addEthereumChainParams (POO-1783)", () => {
  /**
   * @rule R1 — the alpha chain is the whole reason this exists: an external wallet that has never
   * added 4663 is the reported failure, and every field the wallet prompt shows comes from its
   * ChainMeta.
   */
  it("builds Robinhood Chain's parameters from its ChainMeta", () => {
    expect(addEthereumChainParams(ROBINHOOD_CHAIN_ID)).toEqual({
      chainId: "0x1237",
      chainName: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
      blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
    });
  });

  /**
   * @rule R1 — a launch chain, because the fallback is not Robinhood-specific: any supported chain
   * a wallet lacks is addable, and a wallet that has none of them must still be reachable.
   */
  it("builds a launch chain's parameters from its ChainMeta", () => {
    expect(addEthereumChainParams(base.id)).toEqual({
      chainId: "0x2105",
      chainName: "Base",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://mainnet.base.org"],
      blockExplorerUrls: [base.blockExplorers.default.url],
    });
  });

  /**
   * @rule R1 — the name is `displayName`, not viem's `chain.name`: this string is what the wallet
   * writes into the user's network list, and the product calls 42161 "Arbitrum" everywhere else
   * (POO-1041 [R3]). A wallet entry reading "Arbitrum One" beside a deposit screen saying
   * "Arbitrum" is the same two-networks confusion `displayName` exists to prevent.
   */
  it("names the chain the way the product does, not the way viem does", () => {
    expect(addEthereumChainParams(arbitrum.id)?.chainName).toBe("Arbitrum");
    expect(arbitrum.name).toBe("Arbitrum One");
  });

  /**
   * @rule R1 — scoped to `supportedChainMetas`. There is nothing to offer a wallet for a chain this
   * app has no definition of, and inventing one would ask the user to trust an RPC we never chose.
   */
  it("returns undefined for a chain this app does not support", () => {
    expect(addEthereumChainParams(1)).toBeUndefined();
    expect(addEthereumChainParams(999_999)).toBeUndefined();
  });

  /**
   * @rule R1 — every supported chain is addable, so the fallback can never be reached with a target
   * it has no parameters for. Guards the case where a future chain lands with no explorer.
   */
  it("covers every supported chain with a well-formed EIP-3085 payload", () => {
    for (const meta of supportedChainMetas) {
      const params = addEthereumChainParams(meta.chain.id);
      expect(params).toBeDefined();
      expect(params?.chainId).toBe(`0x${meta.chain.id.toString(16)}`);
      expect(params?.rpcUrls).toEqual([meta.rpcUrl]);
      expect(params?.nativeCurrency.decimals).toBe(18);
    }
  });
});
