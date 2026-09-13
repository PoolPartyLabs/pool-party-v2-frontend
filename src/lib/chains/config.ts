/**
 * @id PP-CORE-SETUP (POO-195)
 * @name Chain config
 * @implements-rules-version v1
 *
 * Single source of truth for supported EVM chains. Every consumer (wagmi createConfig, Privy
 * supportedChains/defaultChain, USDC address map, CSP RPC origins, on-ramp network labels)
 * derives from this array. Adding or removing a chain is a one-line edit here.
 *
 * PP-INTEGRATION-POINT: when the BFF RPC proxy lands, transports should point to `'self'`
 * (the proxy) with these public endpoints as fallback only.
 */
import type { Chain } from "viem";
import { defineChain, http } from "viem";
import { arbitrum, base, polygon } from "viem/chains";
import type { FeatureKey } from "@/lib/features/registry";

// ---------------------------------------------------------------------------
// Per-chain metadata beyond what viem's Chain type provides.
// ---------------------------------------------------------------------------
export interface ChainMeta {
  /** The viem chain object. */
  chain: Chain;
  /** pool-party-api network slug, e.g. "arbitrum" (the single source for slug↔chainId). */
  apiNetworkId: string;
  /**
   * The network's name AS THE PRODUCT SAYS IT (POO-1041 [R3]).
   *
   * Deliberately not `chain.name`: viem calls 42161 "Arbitrum One", while every other surface in
   * this app (the deposit network picker, the manager pool maps, the mock catalog) says "Arbitrum".
   * A funding plan that offers to "Move to Arbitrum One" next to a deposit screen listing "Arbitrum"
   * reads as two different networks to someone who does not already know they are the same.
   *
   * This is the field the remaining per-feature name maps should collapse into.
   */
  displayName: string;
  /**
   * Legacy (v0.8.0) network: hits the legacy pool-party-api backend (PP_API_URL_LEGACY) and omits
   * the Universal-Router `poolPartyPositionAddress`. Ported from the interface (Arbitrum + Base).
   */
  isLegacy: boolean;
  /** Public RPC endpoint (also allowlisted in CSP connect-src). */
  rpcUrl: string;
  /**
   * The chain's STABLE currency: the token `i_stableCurrency` holds, what an investor deposits, and
   * what a payout is denominated in. Named `usdc` for the launch chains' token; on Robinhood Chain
   * the same slot holds USDG, so identity here is the ADDRESS and the label is `symbol` / `name`
   * (POO-1779 [R1]/[R3]). Never print the literal "USDC" beside an amount; read it from here, or
   * through {@link stableSymbol} / {@link networkStableSymbol}.
   */
  usdc: {
    address: `0x${string}`;
    decimals: 6;
    /** Ticker AS THE PRODUCT SHOWS IT: "USDC" on the launch chains, "USDG" on Robinhood Chain. */
    symbol: string;
    /** Full token name: "USD Coin" / "Global Dollar". */
    name: string;
    /**
     * The token's ART, beside its ticker (POO-1779 [R1]). Same reason `symbol` lives here: a
     * surface that reads one reads the other, so a row cannot print USDC art over a USDG amount.
     * An icon that says USDC next to a label that says USDG is the same mislabel [R1] removes.
     *
     * CoinGecko's `/large/` path, the source `getRealTokenBalances` already used for the launch
     * chains' USDC art and the one `src/lib/tokens/data/` carries throughout. CSP `img-src` is
     * `https:` (src/lib/security/csp.ts), so no header change.
     */
    logoUrl: string;
  };
  /**
   * Wrapped-native token (WETH / WPOL, 18 decimals). When a pool/seed token is this address, the
   * manager's NATIVE balance backs it — the create-pool tx sends the amount as `tx.value` and the
   * contract wraps it (mirrors the interface). Used to read the right balance in the seed step.
   */
  wrappedNative: `0x${string}`;
  /**
   * When set, this chain PARTICIPATES only while that feature flag is on (POO-1776 [R1]). Two
   * things are gated, and they are the two the flag can protect someone from:
   *
   * 1. **Selectors** — a network picker offers the chain only while the flag is on. Offering it is
   *    the product RECOMMENDING somewhere to put real money. Read through
   *    {@link selectableChainMetas} / {@link isNetworkSelectable}.
   * 2. **Data fan-out** — every per-network enumeration that issues an API call (`?network=<slug>`)
   *    or an RPC read skips the chain while the flag is off. An alpha deployment the environment
   *    has not switched on is not in that environment's backend either: the call is a guaranteed
   *    400 attached to every catalog and wallet read, one per user. Read through
   *    {@link activeChainMetas}.
   *
   * What is NOT gated: `supportedChains`, `transportMap`, `defaultChain` and every by-id/by-slug
   * LOOKUP (`getChainById`, `getUsdcAddress`, `chainDisplayName`, …). Dropping an alpha chain out
   * of wagmi would break the connection of a user who is already sitting on it, which is worse than
   * the thing the gate is for, and a holding on it must still render with a name rather than a
   * blank. Answering a question ABOUT a chain costs nothing; going and asking the network about it
   * does.
   *
   * Absent (the launch chains) means never gated. Never branch on the field directly.
   */
  featureFlag?: FeatureKey;
}

/** Robinhood Chain's numeric id, named so shadow lists and tests never re-type the literal. */
export const ROBINHOOD_CHAIN_ID = 4663;

/**
 * Robinhood Chain (POO-1776, epic POO-1766): an Arbitrum Orbit L2 with ETH gas. viem ships no
 * definition for 4663, so it is defined here rather than in a separate module — the file header's
 * "one-line edit" promise only holds if the chain object lives beside the meta that uses it.
 *
 * The explorer is Blockscout, not an Etherscan-family site, which is why `getExplorerTxUrl` had to
 * stay derived from `blockExplorers` instead of a per-chain URL template.
 */
export const robinhoodChain: Chain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

/**
 * Ordered array of supported chains with Pool Party metadata. This is THE single source:
 * wagmi, Privy, USDC lookups, and CSP all derive from it.
 */
export const supportedChainMetas: readonly ChainMeta[] = [
  {
    chain: arbitrum,
    apiNetworkId: "arbitrum",
    displayName: "Arbitrum",
    isLegacy: true,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    usdc: {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin",
      logoUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    },
    wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
  },
  {
    chain: base,
    apiNetworkId: "base",
    displayName: "Base",
    isLegacy: true,
    rpcUrl: "https://mainnet.base.org",
    usdc: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin",
      logoUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    },
    wrappedNative: "0x4200000000000000000000000000000000000006", // WETH
  },
  {
    chain: polygon,
    apiNetworkId: "polygon",
    displayName: "Polygon",
    isLegacy: false,
    // PP-NOTE: the former public endpoint (polygon-rpc.com) was retired (HTTP 401 "tenant
    // disabled"), which broke server-side reads like readUsdcBalance. publicnode is a keyless,
    // reliable replacement. The BFF RPC proxy (see header) supersedes this later.
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    usdc: {
      address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin",
      logoUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    },
    wrappedNative: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WPOL
  },
  {
    // POO-1776 alpha. APPENDED, never inserted: `defaultChain`'s fallback and
    // `buildProvisioningInput`'s "the other chain" both read position, so the launch three keep
    // theirs. Gated for selectors and data fan-out, see `featureFlag` on ChainMeta.
    chain: robinhoodChain,
    apiNetworkId: "robinhood",
    displayName: "Robinhood Chain",
    // The alpha runs the CURRENT (v0.5.x) manager, not the v0.8.0 legacy backend. This one boolean
    // is the whole legacy branch: useInvest / useMoveRange / lib/api/client carry no per-chain
    // conditional, so a wrong value here silently routes every call to PP_API_URL_LEGACY.
    isLegacy: false,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    // USDG, the chain's stable. The field is named `usdc` for the launch chains' token and that
    // legacy naming is not re-litigated here: it is the STABLE slot, and on 4663 the stable is USDG
    // at 6 decimals. POO-1779 [R1]: the LABEL is carried here beside the address, so a surface that
    // reads one reads the other and the two can never drift into "USDC" printed on a USDG amount.
    usdc: {
      address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      decimals: 6,
      symbol: "USDG",
      name: "Global Dollar",
      logoUrl: "https://assets.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png",
    },
    wrappedNative: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", // WETH9
    featureFlag: "robinhoodChain",
  },
] as const;

// ---------------------------------------------------------------------------
// Derived exports — consumers import these instead of building their own.
// ---------------------------------------------------------------------------

/** Plain viem Chain array for wagmi `createConfig({ chains })` and Privy `supportedChains`. */
export const supportedChains = supportedChainMetas.map((m) => m.chain);

/** Transport map keyed by chain id, for wagmi `createConfig({ transports })`. */
export const transportMap: Record<number, ReturnType<typeof http>> = Object.fromEntries(
  supportedChainMetas.map((m) => [m.chain.id, http(m.rpcUrl)]),
);

/** RPC origins for CSP `connect-src` (derive, don't duplicate). */
export const rpcOrigins: string[] = supportedChainMetas.map((m) => {
  const url = new URL(m.rpcUrl);
  return `${url.protocol}//${url.hostname}`;
});

// ---------------------------------------------------------------------------
// Default chain — controlled by NEXT_PUBLIC_CHAIN_ID (falls back to Arbitrum 42161).
//
// POO-1385 [R1]: this is not just a fallback. It is handed to Privy as `defaultChain`, so it is the
// chain every external wallet is asked to sit on the moment it connects, before the user has picked
// anything, and it is the SIWE message's chain when wagmi has nothing to report yet.
//
// Every deployed env said Polygon, the least used network on the platform, so the ordinary path was
// connect on one chain and switch on the very first operation. On a wallet that carries only the
// networks its owner enabled (Ledger Live pairs exactly the chains selected at pairing time) the
// connect-time switch could target a chain that session does not contain at all.
//
// `NEXT_PUBLIC_*` is inlined at BUILD time, so changing this needs a rebuild per environment, not a
// restart.
// ---------------------------------------------------------------------------
const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID) || arbitrum.id;

export const defaultChain: Chain = supportedChains.find((c) => c.id === envChainId) ?? arbitrum;

// ---------------------------------------------------------------------------
// Lookup helpers.
// ---------------------------------------------------------------------------

/** Find a supported chain by its numeric id, or undefined if not supported. */
export function getChainById(chainId: number): Chain | undefined {
  return supportedChains.find((c) => c.id === chainId);
}

/**
 * EIP-3085 parameters for `wallet_addEthereumChain` (POO-1783 [R1]).
 *
 * Structural rather than imported from a wallet SDK, because the one caller talks to a raw EIP-1193
 * provider and this file already owns every field the request needs.
 */
export interface AddEthereumChainParams {
  /** The chain id as an EIP-3085 hex quantity. */
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
}

/**
 * What an external wallet needs in order to KNOW a chain it has never had (POO-1783 [R1]).
 *
 * A wallet that answers a switch with EIP-3326's 4902 is not refusing, it is saying the network is
 * not in its list. The remedy is to hand it the definition, and the definition already lives here:
 * deriving it means the entry the wallet writes into the user's network list carries the same name,
 * RPC and explorer every other surface uses, instead of a second copy free to drift from this one.
 *
 * `chainName` is {@link ChainMeta.displayName}, not viem's `chain.name`, for the reason that field
 * exists (POO-1041 [R3]): the product calls 42161 "Arbitrum" everywhere, and this string is what the
 * user will see in their wallet's network list from then on.
 *
 * Scoped to {@link supportedChainMetas} and NOT filtered by feature flag on purpose. The flag gates
 * whether a selector OFFERS a chain; it cannot gate whether a wallet already pointed at one can
 * transact, and a wallet that reached this call has already been asked to go there.
 *
 * Returns undefined for an unsupported chain: there is no definition to offer, and inventing one
 * would ask the user to persist an RPC endpoint this app never chose.
 */
export function addEthereumChainParams(chainId: number): AddEthereumChainParams | undefined {
  const meta = supportedChainMetas.find((m) => m.chain.id === chainId);
  if (!meta) return undefined;
  const explorer = meta.chain.blockExplorers?.default?.url;
  return {
    chainId: `0x${chainId.toString(16)}`,
    chainName: meta.displayName,
    nativeCurrency: { ...meta.chain.nativeCurrency },
    rpcUrls: [meta.rpcUrl],
    ...(explorer ? { blockExplorerUrls: [explorer] } : {}),
  };
}

/** Get the native USDC address for a chain, or undefined if not supported. */
export function getUsdcAddress(chainId: number): `0x${string}` | undefined {
  return supportedChainMetas.find((m) => m.chain.id === chainId)?.usdc.address;
}

/**
 * Whether `address` is the chain's wrapped-native token (WETH/WPOL) — i.e. backed by the manager's
 * NATIVE balance. Case-insensitive. False for unsupported chains.
 */
export function isWrappedNative(chainId: number, address: string): boolean {
  const meta = supportedChainMetas.find((m) => m.chain.id === chainId);
  return meta != null && meta.wrappedNative.toLowerCase() === address.toLowerCase();
}

/** Resolve an API network slug (e.g. "base") to its chain id, or undefined if unsupported. */
export function networkToChainId(apiNetworkId: string): number | undefined {
  return supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.chain.id;
}

/**
 * The native token symbol for a network slug, from the viem chain's `nativeCurrency.symbol`
 * (POO-540 R1): "POL" on Polygon, "ETH" on the EVM L2s (Arbitrum/Base). An unknown or missing
 * slug degrades to "ETH" (POO-540 R4) — the historical default for the L2-majority case — so
 * callers never crash and never show a wrong-but-loud symbol.
 */
export function nativeSymbol(apiNetworkId: string | null | undefined): string {
  return (
    supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.chain.nativeCurrency.symbol ??
    "ETH"
  );
}

/**
 * The wrapped-native token symbol for a network slug (POO-878 R1): the native symbol prefixed with
 * "W" — "WETH" on the EVM L2s, "WPOL" on Polygon. Used to label the wrapped ERC-20 option in the
 * seed-liquidity funding selector. Degrades to "WETH" for an unknown slug (mirrors {@link nativeSymbol}).
 */
export function wrappedNativeSymbol(apiNetworkId: string | null | undefined): string {
  return `W${nativeSymbol(apiNetworkId)}`;
}

/**
 * The wrapped-native token ADDRESS for a network slug (WETH / WPOL), or undefined for an unknown one.
 *
 * The address half of {@link wrappedNativeSymbol}, added by POO-1573 so nothing has to write one of
 * these a second time. `src/lib/onramp/ethTarget.ts` prices native ETH through WETH-on-Base to size a
 * real purchase, and a second literal copy of the token that decides WHICH PRICE sizes an ETH order is
 * the drift class that module's own strict-match guard already defends against. Undefined rather than a
 * fallback address, like every other lookup here: a wrong address on a money path must not be silent.
 */
export function getWrappedNative(
  apiNetworkId: string | null | undefined,
): `0x${string}` | undefined {
  return supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.wrappedNative;
}

/**
 * The label an unknown chain's stable degrades to (POO-1779 [R2]).
 *
 * The opposite choice to {@link chainDisplayName}'s `undefined`, and for the opposite reason: a
 * network name has somewhere honest to land (the caller's own `?? slug`), while a token label sits
 * inside `formatTokenAmount(amount, symbol)`, where an absent symbol reads as a missing token rather
 * than as an unknown network. "USDC" is also the literal every one of these call sites hardcoded
 * before this existed, so degrading to it changes nothing for a caller this config does not know.
 */
const DEFAULT_STABLE = { symbol: "USDC", name: "USD Coin" } as const;

/**
 * The stable currency's TICKER for a chain id (POO-1779 [R1]): "USDC" on the launch chains, "USDG"
 * on Robinhood Chain. Degrades to "USDC" for an unknown chain (see {@link DEFAULT_STABLE}).
 *
 * This is the value that goes beside an amount. It is a LABEL, never an identity: what makes a
 * token the stable is still its address ({@link getUsdcAddress}), which is why nothing on a money
 * path branches on the string this returns.
 */
export function stableSymbol(chainId: number | null | undefined): string {
  if (chainId == null) return DEFAULT_STABLE.symbol;
  return (
    supportedChainMetas.find((m) => m.chain.id === chainId)?.usdc.symbol ?? DEFAULT_STABLE.symbol
  );
}

/** The stable currency's full NAME for a chain id: "USD Coin" / "Global Dollar" (POO-1779 [R1]). */
export function stableName(chainId: number | null | undefined): string {
  if (chainId == null) return DEFAULT_STABLE.name;
  return supportedChainMetas.find((m) => m.chain.id === chainId)?.usdc.name ?? DEFAULT_STABLE.name;
}

/**
 * The slug-keyed half of {@link stableSymbol} (mirrors {@link networkDisplayName}), for the feature
 * surfaces that carry an API network slug rather than a chain id: every strategy modal, the manager
 * builder, the provisioning rail.
 */
export function networkStableSymbol(apiNetworkId: string | null | undefined): string {
  return (
    supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.usdc.symbol ??
    DEFAULT_STABLE.symbol
  );
}

/** The slug-keyed half of {@link stableName} (POO-1779 [R1]). */
export function networkStableName(apiNetworkId: string | null | undefined): string {
  return (
    supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.usdc.name ??
    DEFAULT_STABLE.name
  );
}

/**
 * Whether a token SYMBOL is one of the configured stables (POO-1779 [R1], case-insensitive).
 *
 * The predicate the display pipelines branch on once a stable's symbol stops being the literal
 * "USDC": "is this the dollar we read at parity, group first in the wallet, and treat as the default
 * payout". Every `symbol === "USDC"` that meant THAT is this function; the ones that meant "is this
 * token the chain's stable" stay address comparisons, which never needed a symbol in the first place.
 */
export function isStableSymbol(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  return supportedChainMetas.some((m) => m.usdc.symbol.toUpperCase() === upper);
}

/**
 * The product's display name for a chain id (POO-1041 [R3]), or undefined if unsupported.
 *
 * Undefined rather than a fallback string on purpose: a caller interpolating an unresolved name
 * ships "Move to undefined", so the absence has to be visible enough to branch on.
 */
export function chainDisplayName(chainId: number | null | undefined): string | undefined {
  if (chainId == null) return undefined;
  return supportedChainMetas.find((m) => m.chain.id === chainId)?.displayName;
}

/**
 * The product's display name for an API network SLUG (POO-1776 [R2]), or undefined if unsupported.
 *
 * The slug-keyed half of {@link chainDisplayName}, added because the two manager mappers each kept
 * their own `{arbitrum, base, polygon}` label map — shadow lists of exactly the kind [R2] is about,
 * and ones that failed QUIETLY: both fell back to the raw slug, so a chain missing from them
 * rendered a lowercase "robinhood" in the builder pool picker and the strategy detail instead of
 * "Robinhood Chain". Nothing crashed, so nothing said the chain was half-wired. This is the
 * collapse the {@link ChainMeta.displayName} doc asks for; there is no list left to enumerate in
 * `chainSurfaceParity.test.ts`, because there is no list.
 *
 * Undefined for an unknown slug, like every other lookup here. A caller with somewhere harmless to
 * land — a display label, never a money path — supplies its own `?? slug`.
 */
export function networkDisplayName(apiNetworkId: string | null | undefined): string | undefined {
  return supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.displayName;
}

/** Resolve a chain id to its API network slug, or undefined if unsupported. */
export function apiNetworkForChain(chainId: number): string | undefined {
  return supportedChainMetas.find((m) => m.chain.id === chainId)?.apiNetworkId;
}

/**
 * Whether an API network slug runs the legacy (v0.8.0) backend + contracts. Legacy networks hit
 * `PP_API_URL_LEGACY` and omit the Universal-Router `poolPartyPositionAddress`. Unknown slugs are
 * treated as current (non-legacy).
 */
export function isLegacyNetwork(apiNetworkId: string): boolean {
  return supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.isLegacy ?? false;
}

/**
 * Absolute explorer URL for a mined transaction on a supported network (POO-505 R1), derived from
 * the viem chain's `blockExplorers` (Arbiscan / Basescan / Polygonscan). Returns undefined for an
 * unknown network or a missing hash — callers hide the link instead of pointing at an explorer
 * home page (POO-505 R2, no-fake-data).
 */
export function getExplorerTxUrl(
  apiNetworkId: string | null | undefined,
  hash: string | null | undefined,
): string | undefined {
  if (!apiNetworkId || !hash) return undefined;
  const base = supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.chain
    .blockExplorers?.default?.url;
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/tx/${hash}`;
}

/**
 * Absolute explorer URL for an ACCOUNT on a supported network, same contract as
 * {@link getExplorerTxUrl}: undefined for an unknown network or a missing address, never an
 * explorer home page.
 *
 * POO-1055: the funding recovery surface needs this for the one case it cannot resolve by reading
 * (`docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.9) — the wallet broadcast and the app never
 * learned the hash. With no hash there is no transaction to link to, and the user's own account
 * activity is the only place the answer exists.
 */
export function getExplorerAddressUrl(
  apiNetworkId: string | null | undefined,
  address: string | null | undefined,
): string | undefined {
  if (!apiNetworkId || !address) return undefined;
  const base = supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.chain
    .blockExplorers?.default?.url;
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/address/${address}`;
}

// ---------------------------------------------------------------------------
// Flag-gated participation (POO-1776 [R1]).
//
// Every helper here takes the flag reader as an argument rather than importing `isFeatureEnabled`.
// That keeps this module free of the features runtime (it is imported by server reads, the
// edge-adjacent CSP derivation and a dozen pure libs), and it lets a client component pass
// `useFeatureFlags()`'s `isEnabled`, which layers the Dev menu's QA overrides on top — a plain
// `isFeatureEnabled` call inside here would silently ignore those and the Dev panel would appear
// broken.
//
// None of them filters `supportedChains`, `transportMap` or any by-id lookup: see the
// `ChainMeta.featureFlag` doc for why connecting to a gated chain always works.
// ---------------------------------------------------------------------------

/**
 * The chains this flag state turns ON: a chain with no `featureFlag` always, a gated one only while
 * its flag is on. THE enumeration to iterate whenever the loop body TALKS TO THE NETWORK — a
 * per-network API call (`?network=<slug>`) or an RPC read — because a gated chain has no backend
 * and no audience in an environment that has not switched it on.
 */
export function activeChainMetas(isEnabled: (key: FeatureKey) => boolean): readonly ChainMeta[] {
  return supportedChainMetas.filter((m) => m.featureFlag == null || isEnabled(m.featureFlag));
}

/**
 * The chains a network selector may OFFER, given a flag reader.
 *
 * Identical to {@link activeChainMetas} today, and it keeps its own name because the two answer
 * different questions: this one is "may the product recommend this chain", that one is "may we
 * spend a round-trip on it". One `featureFlag` field decides both, so a chain can never be offered
 * in a picker whose data the app is not fetching.
 */
export function selectableChainMetas(
  isEnabled: (key: FeatureKey) => boolean,
): readonly ChainMeta[] {
  return activeChainMetas(isEnabled);
}

/**
 * Whether a network selector may offer an API network slug, given a flag reader. The slug-keyed
 * half of {@link selectableChainMetas}, for the surfaces that carry slugs rather than chain ids
 * (the strategy builder's network chips).
 *
 * An UNKNOWN slug is selectable: only a chain that declares a `featureFlag` is ever gated, so a
 * caller holding a slug this config does not know is left alone rather than silently hidden.
 */
export function isNetworkSelectable(
  apiNetworkId: string,
  isEnabled: (key: FeatureKey) => boolean,
): boolean {
  const flag = supportedChainMetas.find((m) => m.apiNetworkId === apiNetworkId)?.featureFlag;
  return flag == null || isEnabled(flag);
}
