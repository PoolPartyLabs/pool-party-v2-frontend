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
import { http } from "viem";
import { arbitrum, base, polygon } from "viem/chains";

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
  /** Native USDC contract on this chain. */
  usdc: {
    address: `0x${string}`;
    decimals: 6;
  };
  /**
   * Wrapped-native token (WETH / WPOL, 18 decimals). When a pool/seed token is this address, the
   * manager's NATIVE balance backs it — the create-pool tx sends the amount as `tx.value` and the
   * contract wraps it (mirrors the interface). Used to read the right balance in the seed step.
   */
  wrappedNative: `0x${string}`;
}

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
    usdc: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
  },
  {
    chain: base,
    apiNetworkId: "base",
    displayName: "Base",
    isLegacy: true,
    rpcUrl: "https://mainnet.base.org",
    usdc: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
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
    usdc: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    wrappedNative: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WPOL
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
// Default chain — controlled by NEXT_PUBLIC_CHAIN_ID (falls back to Base 8453).
// ---------------------------------------------------------------------------
const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID) || base.id;

export const defaultChain: Chain = supportedChains.find((c) => c.id === envChainId) ?? base;

// ---------------------------------------------------------------------------
// Lookup helpers.
// ---------------------------------------------------------------------------

/** Find a supported chain by its numeric id, or undefined if not supported. */
export function getChainById(chainId: number): Chain | undefined {
  return supportedChains.find((c) => c.id === chainId);
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
 * The product's display name for a chain id (POO-1041 [R3]), or undefined if unsupported.
 *
 * Undefined rather than a fallback string on purpose: a caller interpolating an unresolved name
 * ships "Move to undefined", so the absence has to be visible enough to branch on.
 */
export function chainDisplayName(chainId: number | null | undefined): string | undefined {
  if (chainId == null) return undefined;
  return supportedChainMetas.find((m) => m.chain.id === chainId)?.displayName;
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
