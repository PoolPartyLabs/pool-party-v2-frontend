/**
 * @id PP-MGR (POO-305)
 * @name Token list
 * @implements-rules-version v2
 *
 * Static per-chain token list (ported from pool-party-interface), used by the strategy builder to
 * pick the token pair for a real `/dex-pools` lookup (the API is pair-keyed; there's no token-list
 * endpoint). Keys are lowercase token addresses → `{ name, ticker, iconUrl }`.
 *
 * v2 adds {@link searchTokens}: a relevance-ranked search so a query like "eth" surfaces the
 * canonical WETH/ETH at the top instead of the first 8 alphabetical matches (which buried WETH
 * behind Aave wrappers like aBasWETH). The static list has no real TVL, so ranking is purely
 * deterministic (exact > starts-with > curated-major > contains > name > address), with a small
 * per-network "major token" set used as a relevance prior.
 *
 * Also implements POO-589 R1/R2 (v1): the canonical wrapped-ether symbol is displayed as ETH on
 * every network, and "weth" is a search alias for it. The numeric @implements-rules-version below
 * stays v2 because it tracks the search-ranking artifact lineage (POO-305/POO-482).
 *
 * Also implements POO-879 R1/R2/R3 (v1): the ported v1 Base list had no Tether entry, so "usdt"
 * search returned nothing on Base and the /dex-pools API was never reached. Fix is static data in
 * data/base.json — canonical bridged USDT (also added to MAJOR_ADDRESSES.base) plus Stargate USD₮0
 * as a SEPARATE entry (not aliased into USDT) with a "usdt0" ASCII search alias.
 *
 * PP-INTEGRATION-POINT: bundled token list; token images use the JSON `iconUrl` (CDN-cache later).
 */
import arbitrum from "./data/arbitrum.json";
import base from "./data/base.json";
import polygon from "./data/polygon.json";

/** A token the manager can pick when creating a pool. */
export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  iconUrl?: string;
}

interface RawToken {
  name: string;
  ticker: string;
  iconUrl?: string;
}

/**
 * Index a source JSON under lowercase keys (POO-482 R3): ~150 base and ~69 arbitrum entries ship
 * checksum-cased, which the lowercase lookups in {@link findToken} silently missed. First entry
 * wins on the (rare) case-only duplicate, matching JSON key precedence.
 */
function normalizeKeys(raw: Record<string, RawToken>): Record<string, RawToken> {
  const out: Record<string, RawToken> = {};
  for (const [address, token] of Object.entries(raw)) {
    const key = address.toLowerCase();
    if (!(key in out)) out[key] = token;
  }
  return out;
}

const RAW: Record<string, Record<string, RawToken>> = {
  arbitrum: normalizeKeys(arbitrum as Record<string, RawToken>),
  base: normalizeKeys(base as Record<string, RawToken>),
  polygon: normalizeKeys(polygon as Record<string, RawToken>),
};

/**
 * Wrapped-ether addresses (lowercase) shown under the UNWRAPPED "ETH" on every network, for parity
 * (POO-589 R1). Arbitrum's JSON already ships ticker "ETH"; Base/Polygon ship "WETH" and are
 * canonicalized here. Keyed by address because the strategy builder's on-chain lookup is address-
 * based, so only the display/search identity changes — never the token that gets used.
 */
const CANONICAL_ETH: ReadonlySet<string> = new Set([
  "0x4200000000000000000000000000000000000006", // Base WETH
  "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // Polygon WETH
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // Arbitrum WETH (data ticker already "ETH")
]);

/**
 * Extra search synonyms keyed by lowercase address (POO-589 R2): the wrapped-ether now DISPLAYS as
 * "ETH", so "weth" is added back as a reverse alias — a manager typing either "eth" or "weth" finds
 * it. Not a whitelist; other tokens still surface, just lower.
 */
const SEARCH_ALIASES: Record<string, readonly string[]> = {
  "0x4200000000000000000000000000000000000006": ["weth"], // Base WETH → shown as ETH
  "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": ["weth"], // Polygon WETH → shown as ETH
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": ["weth"], // Arbitrum ETH
  // POO-879: Base USD₮0's symbol uses the ₮ (U+20AE) glyph, so plain "usdt"/"usdt0" typing would miss
  // it. The alias keeps it typeable in ASCII without merging it into the separate canonical USDT entry.
  "0x102d758f688a4c1c5a80b116bd945d4455460282": ["usdt0"], // Base USD₮0 (Stargate) → typeable as "usdt0"
};

const NO_ALIASES: readonly string[] = [];

/**
 * The symbol a token is shown + searched as (POO-589 R1): the unwrapped "ETH" for the wrapped-ether,
 * else its raw ticker. Address-keyed so it composes with `mapDexPool` (the pool-pair labels) using the
 * same canonical identity. The on-chain reference (address) is untouched.
 */
export function canonicalTokenSymbol(address: string, rawSymbol: string): string {
  return CANONICAL_ETH.has(address.toLowerCase()) ? "ETH" : rawSymbol;
}

function toInfo(address: string, token: RawToken): TokenInfo {
  const addr = address.toLowerCase();
  return {
    address: addr,
    name: token.name,
    symbol: canonicalTokenSymbol(addr, token.ticker),
    iconUrl: token.iconUrl,
  };
}

/** Every token for a network, sorted by symbol. */
export function tokensForNetwork(network: string): TokenInfo[] {
  const raw = RAW[network];
  if (!raw) return [];
  return Object.entries(raw)
    .map(([address, token]) => toInfo(address, token))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Look up one token by address on a network (case-insensitive). */
export function findToken(network: string, address: string): TokenInfo | undefined {
  const token = RAW[network]?.[address.toLowerCase()];
  return token ? toInfo(address, token) : undefined;
}

/**
 * Curated "major" token addresses per network (lowercase), used only as a relevance prior for
 * {@link searchTokens}. These are the obvious blue-chips a manager expects to find first (WETH/ETH,
 * WBTC, USDC, USDT, DAI, WPOL, LINK, AAVE). Addresses are taken from each chain's own JSON, so a
 * symbol's chain-specific identity is respected (e.g. on Arbitrum the canonical wrapped-ether token
 * has ticker "ETH", not "WETH"). Not a whitelist — non-major tokens still surface, just lower.
 *
 * PP-NOTE: v1 only curates the Polygon *list* (see data/polygon.json); Base/Arbitrum keep full
 * lists, so this prior is what keeps their searches clean.
 */
const MAJOR_ADDRESSES: Record<string, ReadonlySet<string>> = {
  base: new Set([
    "0x4200000000000000000000000000000000000006", // WETH
    "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", // cbBTC
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
    "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT (bridged Tether USD) — POO-879
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
  ]),
  arbitrum: new Set([
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // ETH (Wrapped Ether)
    "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", // WBTC
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // USDT
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
    "0xf97f4df75117a78c1a5a0dbb814af92458539fb4", // LINK
    "0xba5ddd1f9d7f570dc94a51479a000e3bce967196", // AAVE
  ]),
  polygon: new Set([
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WETH
    "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", // WBTC
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // USDC
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // USDT
    "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", // DAI
    "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WPOL
    "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39", // LINK
    "0xd6df932a45c0f255f85145f286ea0b292b21c90b", // AAVE
  ]),
};

/**
 * Relevance tiers, best (lowest number) first. A token is scored by the strongest tier it matches;
 * curated-major status and symbol length break ties *within* a tier (see {@link searchTokens}).
 */
enum Tier {
  ExactSymbol = 0, // symbol === query
  StartsWith = 1, // symbol startsWith query
  MajorContains = 2, // curated major whose symbol contains query
  Contains = 3, // symbol contains query
  NameContains = 4, // name contains query
  AddressContains = 5, // address contains query
  None = 6, // no match
}

function tierFor(token: TokenInfo, q: string, isMajor: boolean): Tier {
  // POO-589 R2: score by the STRONGEST match across the (canonical) symbol and any search aliases, so
  // the wrapped-ether — now shown as "ETH" — still matches "weth". Symbol-level tiers beat name/address.
  const candidates = [token.symbol.toLowerCase(), ...(SEARCH_ALIASES[token.address] ?? NO_ALIASES)];
  let best = Tier.None;
  for (const candidate of candidates) {
    let tier = Tier.None;
    if (candidate === q) tier = Tier.ExactSymbol;
    else if (candidate.startsWith(q)) tier = Tier.StartsWith;
    else if (candidate.includes(q)) tier = isMajor ? Tier.MajorContains : Tier.Contains;
    if (tier < best) best = tier;
  }
  if (best !== Tier.None) return best;
  if (token.name.toLowerCase().includes(q)) return Tier.NameContains;
  if (token.address.includes(q)) return Tier.AddressContains;
  return Tier.None;
}

/**
 * Search a network's token list and return matches ranked by relevance (best first).
 *
 * Ranking is pure and deterministic (no TVL): exact symbol > symbol starts-with > curated-major
 * contains > contains > name > address. Within a tier, ties break by curated-major first, then
 * shorter symbol (so `WETH` beats `aBasWETH`), then alphabetical symbol. Caller slices the result
 * for display; ranking always happens before any cap.
 *
 * @param network network id ("base" | "arbitrum" | "polygon").
 * @param query free-text query (symbol, name, or address fragment); blank → [].
 * @param limit max results to return (default 12).
 */
export function searchTokens(network: string, query: string, limit = 12): TokenInfo[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const major = MAJOR_ADDRESSES[network] ?? EMPTY_SET;

  const ranked = tokensForNetwork(network)
    .map((token) => {
      const isMajor = major.has(token.address);
      return { token, isMajor, tier: tierFor(token, q, isMajor) };
    })
    .filter((entry) => entry.tier !== Tier.None)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      // curated-major first within the tier (matters for ExactSymbol/StartsWith ties too)
      if (a.isMajor !== b.isMajor) return a.isMajor ? -1 : 1;
      // shorter symbol first (WETH < aBasWETH), then alphabetical (tokensForNetwork is pre-sorted)
      const lenDelta = a.token.symbol.length - b.token.symbol.length;
      if (lenDelta !== 0) return lenDelta;
      return a.token.symbol.localeCompare(b.token.symbol);
    });

  return ranked.slice(0, limit).map((entry) => entry.token);
}

/**
 * Curated "top" tokens for a network (WETH/WBTC/USDC/USDT/DAI…), in curated order — the default list
 * the builder shows when the token search is focused but empty, so a manager can pick without typing
 * (POO-347). Falls back to the alphabetical list for a network with no curated major set.
 */
export function topTokens(network: string, limit = 12): TokenInfo[] {
  const majors = MAJOR_ADDRESSES[network];
  if (!majors) return tokensForNetwork(network).slice(0, limit);
  const out: TokenInfo[] = [];
  for (const address of majors) {
    const token = findToken(network, address);
    if (token) out.push(token);
    if (out.length >= limit) break;
  }
  return out;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
