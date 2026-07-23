/**
 * @id PP-STR-LIB-012
 * @name tokenClassRegistry
 * @description Curated (chainId, address)-keyed classifier that maps an on-chain token to exactly one
 *   TokenClass, with a mock-only symbol fallback and the wiring resolver used to tag strategies.
 * @linear https://linear.app/yeildbay/issue/POO-830
 * @owner core-team
 * @since 2026-07-11
 * @implements-rules-version v1
 *
 * @integration-points
 * - tokenClass(): a curated ALLOWLIST today (mock-first). The backend should serve a per-token
 *   category so the FE reads it directly instead of maintaining these lists (see PP-INTEGRATION-POINT).
 *
 * @notes
 * [R1] Each token maps to exactly one {@link TokenClass}. The PRODUCTION contract is the address
 * registry, keyed by `(chainId, address)` with the address lowercased — symbols are spoofable, so a
 * token is NEVER classified by its symbol in production. The symbol map ({@link tokenClassBySymbol})
 * is a MOCK-ONLY / legacy fallback (mock pools reference tokens by symbol and use non-real addresses;
 * the legacy `/pools` v1 payload carries symbols but no addresses). Precedence when a token would
 * match multiple lists: stablecoin > bitcoin > ethereum > meme > altcoin.
 *
 * v1 folds (R1): yield-bearing stables (sDAI, sUSDe) → stablecoin; RWA (PAXG, tokenized treasuries)
 * → altcoin. These live in the class lists below.
 *
 * This surface is ADDITIVE and separate from the risk classifier (`riskProfile.ts`,
 * STEADY/DYNAMIC token lists) and `StrategyCategory` — those are intentionally left untouched. A
 * future refactor could single-source the token lists; not done here to avoid changing existing risk
 * behavior.
 */

/** The single class a token maps to. `unverified` = absent from the curated registry. */
export type TokenClass = "stablecoin" | "bitcoin" | "ethereum" | "altcoin" | "meme" | "unverified";

/**
 * Precedence order for the tie-break when a token would match multiple class lists (R1). Earlier
 * wins. `unverified` is not ranked — it is only the default when nothing matches.
 */
export const CLASS_PRECEDENCE: readonly TokenClass[] = [
  "stablecoin",
  "bitcoin",
  "ethereum",
  "meme",
  "altcoin",
];

/**
 * Pick the highest-precedence class among a set of candidate matches (R1 tie-break). Returns
 * `unverified` when there is no ranked candidate.
 */
export function classByPrecedence(candidates: Iterable<TokenClass>): TokenClass {
  const set = new Set(candidates);
  for (const candidate of CLASS_PRECEDENCE) {
    if (set.has(candidate)) return candidate;
  }
  return "unverified";
}

/**
 * Per-class SYMBOL allowlists (uppercased at build time). MOCK-ONLY: symbols are spoofable and must
 * never be trusted in production — used only where no address is available (mocks, legacy v1 rows).
 * Includes the R1 folds: sDAI/sUSDe → stablecoin; PAXG/XAUT/OUSG (RWA) → altcoin.
 */
const STABLECOIN_SYMBOLS = [
  "USDC",
  "USDT",
  "DAI",
  "USDBC",
  "USDC.E",
  "USDS",
  "FRAX",
  "LUSD",
  "PYUSD",
  "EURC",
  "TUSD",
  "USDP",
  "GUSD",
  "BUSD",
  "SUSD",
  "GHO",
  "CRVUSD",
  "USDE",
  "USD+",
  "USDM",
  "SDAI", // yield-bearing stable (fold)
  "SUSDE", // yield-bearing stable (fold)
];
const BITCOIN_SYMBOLS = ["BTC", "WBTC", "CBBTC", "TBTC", "LBTC", "BTCB"];
const ETHEREUM_SYMBOLS = [
  "ETH",
  "WETH",
  "STETH",
  "WSTETH",
  "WEETH",
  "CBETH",
  "RETH",
  "EETH",
  "OSETH",
  "ETHX",
];
const MEME_SYMBOLS = [
  "PEPE",
  "DEGEN",
  "BRETT",
  "SHIB",
  "DOGE",
  "WIF",
  "BONK",
  "MOG",
  "TOSHI",
  "FLOKI",
  "MEW",
];
const ALTCOIN_SYMBOLS = [
  "AERO",
  "ARB",
  "GMX",
  "OP",
  "LINK",
  "UNI",
  "CRV",
  "LDO",
  "AAVE",
  "PENDLE",
  "SOL",
  "MATIC",
  "POL",
  "WMATIC",
  "WPOL",
  "MORPHO",
  "VIRTUAL",
  "PAXG", // RWA gold (fold)
  "XAUT", // RWA gold (fold)
  "OUSG", // tokenized treasuries (fold)
];

/** Class lists paired with their class, iterated in precedence order so the tie-break holds. */
const SYMBOL_LISTS: ReadonlyArray<readonly [TokenClass, readonly string[]]> = [
  ["stablecoin", STABLECOIN_SYMBOLS],
  ["bitcoin", BITCOIN_SYMBOLS],
  ["ethereum", ETHEREUM_SYMBOLS],
  ["meme", MEME_SYMBOLS],
  ["altcoin", ALTCOIN_SYMBOLS],
];

/** Symbol (uppercased) → class. Built in precedence order; the first write wins on any collision. */
const SYMBOL_TO_CLASS: ReadonlyMap<string, TokenClass> = (() => {
  const map = new Map<string, TokenClass>();
  for (const [tokenClassName, symbols] of SYMBOL_LISTS) {
    for (const symbol of symbols) {
      const key = symbol.toUpperCase();
      if (!map.has(key)) map.set(key, tokenClassName);
    }
  }
  return map;
})();

/**
 * Per-class ADDRESS allowlist across the supported chains (Base 8453, Arbitrum 42161, Polygon 137).
 * Real public contract addresses; the map is keyed `${chainId}:${lowercased address}`. This is the
 * production-trusted source (R1). Extend as real strategies surface new pairs.
 * PP-INTEGRATION-POINT: replace this curated allowlist with a backend-served per-token category on
 * the strategy/pool DTO (the same channel the risk classifier wants for `riskProfile`), so the FE
 * drops these lists and reads the class directly (avoids drift as new tokens are added).
 */
const ADDRESS_LISTS: ReadonlyArray<
  readonly [TokenClass, ReadonlyArray<readonly [number, string]>]
> = [
  [
    "stablecoin",
    [
      // Base
      [8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"], // USDC
      [8453, "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA"], // USDbC
      [8453, "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"], // DAI
      [8453, "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"], // USDT
      // Arbitrum
      [42161, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"], // USDC
      [42161, "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"], // USDC.e
      [42161, "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"], // USDT
      [42161, "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"], // DAI
      [42161, "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F"], // FRAX
      // Polygon
      [137, "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"], // USDC (native)
      [137, "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"], // USDC.e
      [137, "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"], // USDT
      [137, "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"], // DAI
    ],
  ],
  [
    "bitcoin",
    [
      [8453, "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"], // cbBTC
      [42161, "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"], // WBTC
      [137, "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6"], // WBTC
    ],
  ],
  [
    "ethereum",
    [
      // Base
      [8453, "0x4200000000000000000000000000000000000006"], // WETH
      [8453, "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22"], // cbETH
      [8453, "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452"], // wstETH
      // Arbitrum
      [42161, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"], // WETH
      [42161, "0x5979D7b546E38E414F7E9822514be443A4800529"], // wstETH
      [42161, "0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe"], // weETH
      // Polygon
      [137, "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"], // WETH
    ],
  ],
  [
    "altcoin",
    [
      // Base
      [8453, "0x940181a94A35A4569E4529A3CDfB74e38FD98631"], // AERO
      // Arbitrum
      [42161, "0x912CE59144191C1204E64559FE8253a0e49E6548"], // ARB
      [42161, "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a"], // GMX
      [42161, "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4"], // LINK
      [42161, "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0"], // UNI
      [42161, "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196"], // AAVE
      [42161, "0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978"], // CRV
      [42161, "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8"], // PENDLE
      // Polygon
      [137, "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"], // WPOL / WMATIC
      [137, "0xD6DF932A45C0f255f85145f286eA0b292B21C90B"], // AAVE
      [137, "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39"], // LINK
      [137, "0x172370d5Cd63279eFa6d502DAB29171933a610AF"], // CRV
      [137, "0xb33EaAd8d922B1083446DC23f610c2567fB5180f"], // UNI
    ],
  ],
  [
    "meme",
    [
      [8453, "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"], // DEGEN
      [8453, "0x532f27101965dd16442E59d40670FaF5eBB142E4"], // BRETT
    ],
  ],
];

/** `${chainId}:${lowercased address}` → class. Built in precedence order; first write wins. */
const ADDRESS_TO_CLASS: ReadonlyMap<string, TokenClass> = (() => {
  const map = new Map<string, TokenClass>();
  for (const [tokenClassName, entries] of ADDRESS_LISTS) {
    for (const [chainId, address] of entries) {
      const key = `${chainId}:${address.toLowerCase()}`;
      if (!map.has(key)) map.set(key, tokenClassName);
    }
  }
  return map;
})();

/**
 * Classify a token by its `(chainId, address)` — the PRODUCTION contract (R1). The address is
 * lowercased before lookup. Returns `unverified` when the token is absent from the curated allowlist.
 * Never reads a symbol: an unknown address stays unverified (anti-spoofing).
 */
export function tokenClass(chainId: number, address: string): TokenClass {
  return ADDRESS_TO_CLASS.get(`${chainId}:${address.toLowerCase()}`) ?? "unverified";
}

/**
 * MOCK-ONLY / legacy fallback: classify a token by its SYMBOL (uppercased). Symbols are spoofable, so
 * this must NEVER be trusted in production — it exists only where no address is available (mocks, the
 * legacy v1 `/pools` payload). Returns `unverified` for an unknown or blank symbol.
 */
export function tokenClassBySymbol(symbol: string): TokenClass {
  if (!symbol) return "unverified";
  return SYMBOL_TO_CLASS.get(symbol.toUpperCase()) ?? "unverified";
}

/** A token descriptor as it arrives at a mapper: an address+chain (production) and/or a symbol. */
export interface TokenClassInput {
  /** EVM chain id the token lives on. Required for the trusted address lookup. */
  chainId?: number | null;
  /** Token contract address (any case). The production key when paired with `chainId`. */
  address?: string | null;
  /** Token symbol. MOCK-ONLY / legacy fallback when no usable address is present. */
  symbol?: string | null;
}

/**
 * Resolve a token descriptor to its class for the strategy-tag wiring. Production discipline (R1):
 * when a usable `(chainId, address)` is present, the ADDRESS registry is the sole source — an unknown
 * address stays `unverified` and is NEVER upgraded through the spoofable symbol. Only when there is no
 * usable address (legacy v1 rows, mock pools) does it fall back to the mock-only symbol map.
 */
export function resolveTokenClass(input: TokenClassInput): TokenClass {
  const { chainId, address, symbol } = input;
  if (address && chainId != null) {
    // Trusted production path: the address is the key; symbol is deliberately ignored.
    return tokenClass(chainId, address);
  }
  // Degraded/mock path: no usable (chainId, address) → the mock-only symbol fallback.
  return tokenClassBySymbol(symbol ?? "");
}
