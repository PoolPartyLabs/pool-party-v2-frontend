/**
 * @id PP-MGR-MCK-005
 * @name buildPanelFixtures
 * @implements-rules-version v1 (POO-2185 rules v1, slice PC of POO-2171)
 * @analytics-events none (data hooks): a data fixture, nothing here is rendered or tracked.
 *
 * PP-MOCK. What the Build configuration panels read in MOCK mode: every hookless Uniswap v4 pool the
 * mandate's mock Pools step can offer (`fundPools.ts`, PP-MGR-MCK-003) and two Aave v3 reserves, in
 * the exact WIRE shape of the v2 catalog (`CatalogPool`, `CatalogReserve`), so the mock path goes
 * through the same mapping as the real one (`panelCatalogView`, PP-MGR-LIB-031) and a fixture that
 * drifts from the contract fails `catalogPoolSchema` in `buildPanelFixtures.test`. There is no sample
 * data in real mode (P13): these serve mock mode, tests and Storybook only.
 *
 * Which pools: three are written out (WETH / USDC at 0.05% and 0.3% on Arbitrum, WETH / USDG on
 * Robinhood Chain), and {@link panelPoolFixtures} adds one GENERATED pool for every other hookless row
 * of the mock universe, built from the row itself, so a pool a mock mandate holds always answers and
 * `Use` can enable in mock mode. A pool with a hook has no fixture: no mandate can hold one (R38).
 *
 * Realism, per docs/05_MOCK_STRATEGY.md:
 *
 * - **Real identities.** Token addresses and logos are the bundled token lists' own, decimals and
 *   names are the tokens' own, and the Aave addresses are the deployed Aave v3 Arbitrum ones. Each
 *   `poolId` is the real v4 PoolId, `keccak256(abi.encode(poolKey))`, which the test recomputes (and
 *   pins with golden values for the generated ones), so the key and the id cannot drift.
 * - **Coherent numbers.** `currentTick`, `sqrtPriceX96` and both price strings come from one price,
 *   with the decimals applied. A hand-written pool is about 3,050 USD per ETH; a generated pool takes
 *   the ratio of its two tokens' reference USD prices with a tiny deterministic spread per pool, so
 *   WBTC / WETH agrees with WBTC / USDC over WETH / USDC and a stable pair sits at parity.
 * - **Currency order is the chain's, and `tokens` and `pairSymbols` follow it.** `currency0` is the
 *   lower address, and the catalog lists `tokens[i]` as currency i (the launch composition reads it
 *   that way, `launch/composition.ts`), so the canonical price is token1 per token0 in that order.
 * - **TVL and APR are null with a reason**, as the alpha serves them: the panels never print a number
 *   for them (decision A3) and never show active liquidity as TVL.
 * - **Diverse states.** The Aave USDC reserve is usable; the WETH reserve has reached its supply cap,
 *   so a list row is disabled with its reason (P1, P13). The alpha lists USDC alone, so that second
 *   reserve is invented, and it exists to exercise the disabled state. The Robinhood NVDA token is
 *   unpriced, as the mock Pools step makes it, so its pool is ineligible (a pool the panel cannot
 *   apply), though no mandate can hold it.
 *
 * Mock-mode ids: the mandate's mock Pools step has no PoolId (its rows are slugs such as
 * `arb-v4-weth-usdc-5`), and a Pool block of a mock-mode plan holds that slug as its `poolId`. Each
 * fixture therefore carries its `mockId`, and {@link findPanelPoolFixture} answers to either the real
 * PoolId or the slug. A slug with no fixture is a not-found, never an invented pool.
 *
 * Built on first use, never at import: the generated pools resolve the bundled token lists through
 * `fundPoolFixtures()`, which throws when one is missing (see `fundPools.ts`).
 *
 * The only invented values: the price-feed addresses of non-stable tokens on Robinhood Chain and of
 * the generated pools' tokens (no registry is public; they derive from the token address), the
 * reference USD prices, the reserve supply figures of the WETH reserve and the pool liquidity.
 *
 * PP-INTEGRATION-POINT: replaced in real mode by `GET /api/v2/catalog/uniswap-v4/pools/{poolId}` and
 * `GET /api/v2/catalog/aave-v3/reserves` (server actions `getCatalogPoolAction` and
 * `getCatalogReservesAction`, POO-2133); the panels' hooks pick the source, never these files.
 */
import { encodeAbiParameters, keccak256, toHex } from "viem";
import type { MandatePoolRef } from "@/features/manager/fund/mandateDraft";
import type { CatalogPool, CatalogReserve, CatalogToken, V2ChainId } from "@/lib/api/v2/schemas";
import { fundPoolFixtures } from "./fundPools";

/** Mock latency band for a panel read, in ms: wide enough that the skeleton is visible in review. */
export const PANEL_MOCK_LATENCY_MS: readonly [number, number] = [120, 320];

/** Mock failure probability of a panel read, the "realistic 2-5%" band of docs/05_MOCK_STRATEGY.md. */
export const PANEL_MOCK_FAILURE_RATE = 0.02;

const NO_HOOKS = "0x0000000000000000000000000000000000000000";

/** A recent unix second, so a price reads as fresh (2026-10-04 03:00 UTC). */
const PRICE_UPDATED_AT = "1791082800";

const TVL_REASON = "TVL is not indexed for v4 pools yet.";
const APR_REASON = "Fees APR is not indexed for v4 pools yet.";

// ---------------------------------------------------------------------------
// Tokens (hand-written pools)
// ---------------------------------------------------------------------------

const WETH_ARBITRUM: CatalogToken = {
  protocolVersion: "v2",
  chainId: "42161",
  address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
  logoUrl:
    "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png",
  hubPriced: true,
  priceUsd: "3050.4127",
  priceUpdatedAt: PRICE_UPDATED_AT,
  // Chainlink ETH / USD on Arbitrum One.
  priceSource: "0x639fe6ab55c921f74e7fac1ee960c0b6293ba612",
  priceProvenance: "chainlink",
  priceUnavailableReason: null,
};

/** Stables are fixed 1:1 and name themselves as the price source, in every fixture. */
const USDC_ARBITRUM: CatalogToken = {
  protocolVersion: "v2",
  chainId: "42161",
  address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  logoUrl: "https://arbiscan.io/token/images/centre-usdc_28.png",
  hubPriced: true,
  priceUsd: "1",
  priceUpdatedAt: PRICE_UPDATED_AT,
  priceSource: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  priceProvenance: "fixed-1:1",
  priceUnavailableReason: null,
};

const WETH_ROBINHOOD: CatalogToken = {
  protocolVersion: "v2",
  chainId: "4663",
  address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
  logoUrl: "/tokens/weth.png",
  hubPriced: true,
  priceUsd: "3052.9061",
  priceUpdatedAt: PRICE_UPDATED_AT,
  // Invented: Robinhood Chain has no public price-source registry yet.
  priceSource: "0x1d4c9a0e5b7f3a62c8d1e0f9b2a3c4d5e6f70812",
  priceProvenance: "chainlink",
  priceUnavailableReason: null,
};

const USDG_ROBINHOOD: CatalogToken = {
  protocolVersion: "v2",
  chainId: "4663",
  address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  symbol: "USDG",
  name: "Global Dollar",
  decimals: 6,
  logoUrl: "https://coin-images.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png",
  hubPriced: true,
  priceUsd: "1",
  priceUpdatedAt: PRICE_UPDATED_AT,
  priceSource: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  priceProvenance: "fixed-1:1",
  priceUnavailableReason: null,
};

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/** One fixture pool plus the slug the mandate's mock Pools step knows it by. */
export interface PanelPoolFixture {
  /** The `id` of the same pool in `fundPools.ts` (PP-MGR-MCK-003), the mock-mode `poolId`. */
  mockId: string;
  pool: CatalogPool;
}

/**
 * The hand-written pools, deepest first. Prices are token1 per token0, the canonical orientation,
 * and `tokens` and `pairSymbols` follow the pool key's currency order.
 *
 * - Arbitrum WETH / USDC 0.05%, spacing 10, about 3,050.
 * - Arbitrum WETH / USDC 0.3%, spacing 60, a few ticks away (a different book of the same pair).
 * - Robinhood Chain WETH / USDG 0.05%, spacing 10: WETH is currency0 (its address sorts below
 *   USDG's), so the canonical price there is USDG per WETH.
 */
export const PANEL_POOL_FIXTURES: readonly PanelPoolFixture[] = [
  {
    mockId: "arb-v4-weth-usdc-5",
    pool: {
      protocolVersion: "v2",
      chainId: "42161",
      adapterKind: "uniswap-v4",
      poolId: "0xfc7b3ad139daaf1e9c3637ed921c154d1b04286f8a82b805a6c352da57028653",
      poolKey: {
        protocolVersion: "v2",
        currency0: WETH_ARBITRUM.address,
        currency1: USDC_ARBITRUM.address,
        fee: 500,
        tickSpacing: 10,
        hooks: NO_HOOKS,
      },
      tokens: [WETH_ARBITRUM, USDC_ARBITRUM],
      pairSymbols: ["WETH", "USDC"],
      hooked: false,
      currentTick: -196090,
      sqrtPriceX96: "4375814307396461083613940",
      currentPrice: {
        protocolVersion: "v2",
        token1PerToken0: "3050.4127",
        token0PerToken1: "0.000327824494043",
      },
      liquidity: "5832911739405273",
      eligible: true,
      registration: "at-fund-creation",
      tvlUsd: null,
      feesApr: null,
      tvlUnavailableReason: TVL_REASON,
      feesAprUnavailableReason: APR_REASON,
    },
  },
  {
    mockId: "arb-v4-weth-usdc-30",
    pool: {
      protocolVersion: "v2",
      chainId: "42161",
      adapterKind: "uniswap-v4",
      poolId: "0xc9bc8043294146424a4e4607d8ad837d6a659142822bbaaabc83bb57e7447461",
      poolKey: {
        protocolVersion: "v2",
        currency0: WETH_ARBITRUM.address,
        currency1: USDC_ARBITRUM.address,
        fee: 3000,
        tickSpacing: 60,
        hooks: NO_HOOKS,
      },
      tokens: [WETH_ARBITRUM, USDC_ARBITRUM],
      pairSymbols: ["WETH", "USDC"],
      hooked: false,
      currentTick: -196087,
      sqrtPriceX96: "4376435186288938366366584",
      currentPrice: {
        protocolVersion: "v2",
        token1PerToken0: "3051.2784",
        token0PerToken1: "0.000327731484613",
      },
      liquidity: "1294077512083344",
      eligible: true,
      registration: "at-fund-creation",
      tvlUsd: null,
      feesApr: null,
      tvlUnavailableReason: TVL_REASON,
      feesAprUnavailableReason: APR_REASON,
    },
  },
  {
    mockId: "rbh-v4-weth-usdg-5",
    pool: {
      protocolVersion: "v2",
      chainId: "4663",
      adapterKind: "uniswap-v4",
      poolId: "0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593",
      poolKey: {
        protocolVersion: "v2",
        currency0: WETH_ROBINHOOD.address,
        currency1: USDG_ROBINHOOD.address,
        fee: 500,
        tickSpacing: 10,
        hooks: NO_HOOKS,
      },
      tokens: [WETH_ROBINHOOD, USDG_ROBINHOOD],
      pairSymbols: ["WETH", "USDG"],
      hooked: false,
      currentTick: -196082,
      sqrtPriceX96: "4377602332131435572646444",
      currentPrice: {
        protocolVersion: "v2",
        token1PerToken0: "3052.9061",
        token0PerToken1: "0.000327556749944",
      },
      liquidity: "348120956711820",
      eligible: true,
      registration: "at-fund-creation",
      tvlUsd: null,
      feesApr: null,
      tvlUnavailableReason: TVL_REASON,
      feesAprUnavailableReason: APR_REASON,
    },
  },
];

// ---------------------------------------------------------------------------
// Generated pools: one per other hookless Uniswap v4 row of the mock Pools step
// ---------------------------------------------------------------------------

/** What a generated pool needs to know about a token: its own facts and a reference price. */
interface MockTokenSpec {
  symbol: string;
  name: string;
  decimals: number;
  /** Reference USD price. A stable is exactly 1. */
  usd: number;
  stable: boolean;
  /** Whether the hub can price it: the same answer `isPricedSymbol` gives the Mandate step. */
  priced: boolean;
}

/** The tokens of the mock universe's hookless v4 rows, by lowercase address. */
const MOCK_TOKEN_SPECS: Readonly<Record<string, MockTokenSpec>> = {
  // Arbitrum One.
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": {
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    usd: 3050.4127,
    stable: false,
    priced: true,
  },
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    usd: 1,
    stable: true,
    priced: true,
  },
  "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": {
    symbol: "WBTC",
    name: "Wrapped BTC",
    decimals: 8,
    usd: 94850.5,
    stable: false,
    priced: true,
  },
  "0x912ce59144191c1204e64559fe8253a0e49e6548": {
    symbol: "ARB",
    name: "Arbitrum",
    decimals: 18,
    usd: 0.624,
    stable: false,
    priced: true,
  },
  "0xf97f4df75117a78c1a5a0dbb814af92458539fb4": {
    symbol: "LINK",
    name: "ChainLink Token",
    decimals: 18,
    usd: 15.82,
    stable: false,
    priced: true,
  },
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    usd: 1,
    stable: true,
    priced: true,
  },
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": {
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
    usd: 1,
    stable: true,
    priced: true,
  },
  // Robinhood Chain. The equity token is unpriced on purpose, as in the mock Pools step.
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73": {
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    usd: 3052.9061,
    stable: false,
    priced: true,
  },
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168": {
    symbol: "USDG",
    name: "Global Dollar",
    decimals: 6,
    usd: 1,
    stable: true,
    priced: true,
  },
  "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": {
    symbol: "NVDA",
    name: "NVIDIA (tokenised)",
    decimals: 18,
    usd: 187.35,
    stable: false,
    priced: false,
  },
};

/** The standard Uniswap v4 tick spacing of each fee tier the mock universe uses. */
const V4_SPACING_OF_FEE: Readonly<Record<number, number>> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

// The compile target is ES2017, which has no BigInt literals: the constants use the function.
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
/** 2^192: the square of the Q64.96 scale. */
const Q192 = ONE << BigInt(192);

/** Integer square root (Newton), rounded down. */
function isqrt(value: bigint): bigint {
  if (value < TWO) return value;
  let x = value;
  let y = (x + ONE) / TWO;
  while (y < x) {
    x = y;
    y = (x + value / x) / TWO;
  }
  return x;
}

/** A plain decimal string for the catalog's `decimal` fields: 12 significant digits, no exponent. */
function decimalString(value: number): string {
  const text = value.toPrecision(12);
  return text.includes("e") ? value.toFixed(20) : text;
}

/** `sqrtPriceX96` of a human price (token1 per token0, a plain decimal string) at the two decimals. */
function sqrtPriceX96For(price: string, decimals0: number, decimals1: number): bigint {
  const [whole = "0", fraction = ""] = price.split(".");
  const numerator = BigInt(`${whole}${fraction}`) * TEN ** BigInt(decimals1);
  const denominator = TEN ** BigInt(fraction.length + decimals0);
  return isqrt((numerator * Q192) / denominator);
}

/** A small, deterministic spread between the pools of one pair (within +/-0.016%), from the slug. */
function spreadFor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return ((hash % 9) - 4) * 0.00004;
}

/**
 * The four fields that carry a pool's price, kept coherent: the tick, the sqrt price and both
 * served price strings, all from one price (token1 per token0) at the two decimals.
 */
function priceFieldsOf(
  price: number,
  decimals0: number,
  decimals1: number,
): Pick<CatalogPool, "currentTick" | "sqrtPriceX96" | "currentPrice"> {
  const text = decimalString(price);
  const raw = Number(text) * 10 ** (decimals1 - decimals0);
  return {
    currentTick: Math.floor(Math.log(raw) / Math.log(1.0001)),
    sqrtPriceX96: sqrtPriceX96For(text, decimals0, decimals1).toString(),
    currentPrice: {
      protocolVersion: "v2",
      token1PerToken0: text,
      token0PerToken1: decimalString(1 / Number(text)),
    },
  };
}

/**
 * A copy of `pool` with the market moved to `price` (token1 per token0): the sqrt price, the tick and
 * both price strings move together, so the copy is still one coherent answer of the catalog. For tests
 * and stories that need a refresh to change the price, or a price outside a range.
 */
export function panelPoolAtPrice(pool: CatalogPool, price: number): CatalogPool {
  const token0 = pool.tokens.find((token) => token.address === pool.poolKey.currency0);
  const token1 = pool.tokens.find((token) => token.address === pool.poolKey.currency1);
  if (!token0 || !token1) throw new Error("buildPanelFixtures: pool currency missing");
  return {
    ...structuredClone(pool),
    ...priceFieldsOf(price, token0.decimals, token1.decimals),
  };
}

/** The real v4 PoolId of a pool key: `keccak256(abi.encode(poolKey))`. */
function poolIdOf(key: CatalogPool["poolKey"]): string {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [
        key.currency0 as `0x${string}`,
        key.currency1 as `0x${string}`,
        key.fee,
        key.tickSpacing,
        key.hooks as `0x${string}`,
      ],
    ),
  );
}

interface MockSide {
  address: string;
  spec: MockTokenSpec;
  logoUrl: string | null;
}

/** One side of a mock row, with the facts the table holds. Throws for a token the table lacks. */
function sideOf(ref: MandatePoolRef["token0"]): MockSide {
  const address = ref.address.toLowerCase();
  const spec = MOCK_TOKEN_SPECS[address];
  if (!spec) {
    throw new Error(`buildPanelFixtures: no reference price for ${ref.symbol} (${address})`);
  }
  return { address, spec, logoUrl: ref.logoUrl };
}

function catalogTokenOf(chainId: "42161" | "4663", side: MockSide): CatalogToken {
  const { address, spec } = side;
  return {
    protocolVersion: "v2",
    chainId,
    address,
    symbol: spec.symbol,
    name: spec.name,
    decimals: spec.decimals,
    logoUrl: side.logoUrl,
    hubPriced: spec.priced,
    priceUsd: spec.priced ? String(spec.usd) : null,
    priceUpdatedAt: spec.priced ? PRICE_UPDATED_AT : null,
    // Invented for a non-stable token, derived from its address so it never changes.
    priceSource: spec.stable
      ? address
      : `0x${keccak256(toHex(`pp-mock-feed:${address}`)).slice(-40)}`,
    priceProvenance: spec.stable ? "fixed-1:1" : "chainlink",
    priceUnavailableReason: spec.priced ? null : "No hub price feed for this token yet.",
  };
}

/** One pool of the mock universe as a catalog pool. */
function generatedPool(row: MandatePoolRef): CatalogPool {
  const chainId = row.network === "arbitrum" ? "42161" : "4663";
  const side0 = sideOf(row.token0);
  const side1 = sideOf(row.token1);
  const spacing = V4_SPACING_OF_FEE[row.feeTier];
  if (spacing === undefined) {
    throw new Error(`buildPanelFixtures: no tick spacing for fee ${row.feeTier} (${row.id})`);
  }
  const token0 = catalogTokenOf(chainId, side0);
  const token1 = catalogTokenOf(chainId, side1);
  const poolKey: CatalogPool["poolKey"] = {
    protocolVersion: "v2",
    currency0: side0.address,
    currency1: side1.address,
    fee: row.feeTier,
    tickSpacing: spacing,
    hooks: NO_HOOKS,
  };
  const price = (side0.spec.usd / side1.spec.usd) * (1 + spreadFor(row.id));
  return {
    protocolVersion: "v2",
    chainId,
    adapterKind: "uniswap-v4",
    poolId: poolIdOf(poolKey),
    poolKey,
    tokens: [token0, token1],
    pairSymbols: [token0.symbol, token1.symbol],
    hooked: false,
    ...priceFieldsOf(price, side0.spec.decimals, side1.spec.decimals),
    // Scaled from the mock row's own depth, so a deeper book has more liquidity.
    liquidity: String(Math.round(row.tvlUsd ?? 1_000_000) * 120_000_000),
    eligible: token0.hubPriced && token1.hubPriced,
    registration: "at-fund-creation",
    tvlUsd: null,
    feesApr: null,
    tvlUnavailableReason: TVL_REASON,
    feesAprUnavailableReason: APR_REASON,
  };
}

let allPools: readonly PanelPoolFixture[] | null = null;

/**
 * Every pool a mock mandate can hold: the hand-written fixtures, then one generated pool for each
 * other hookless Uniswap v4 row of the mock Pools step, in that step's order. Built on first use and
 * handed back by reference; callers read it and must not write through it (`findPanelPoolFixture`
 * hands out copies).
 */
export function panelPoolFixtures(): readonly PanelPoolFixture[] {
  allPools ??= [
    ...PANEL_POOL_FIXTURES,
    ...fundPoolFixtures()
      .uniswapV4.filter(
        (row) => !row.hasHook && !PANEL_POOL_FIXTURES.some(({ mockId }) => mockId === row.id),
      )
      .map((row) => ({ mockId: row.id, pool: generatedPool(row) })),
  ];
  return allPools;
}

/**
 * The pool of a mock-mode Pool block, by real PoolId (case-insensitive) or by the mock Pools step's
 * slug, on one network. A copy, so a caller can never write through the module's data. Null when no
 * fixture matches: the mock never invents a pool for an id it does not know.
 */
export function findPanelPoolFixture(chainId: V2ChainId, poolId: string): CatalogPool | null {
  const wanted = poolId.toLowerCase();
  const hit = panelPoolFixtures().find(
    ({ mockId, pool }) =>
      pool.chainId === String(chainId) &&
      (pool.poolId.toLowerCase() === wanted || mockId.toLowerCase() === wanted),
  );
  return hit ? structuredClone(hit.pool) : null;
}

// ---------------------------------------------------------------------------
// Aave v3 reserves (Arbitrum, supply)
// ---------------------------------------------------------------------------

/** The deployed Aave v3 Arbitrum addresses, shared by every reserve. */
const AAVE_V3_ARBITRUM = {
  poolAddress: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
  dataProviderAddress: "0x69fa688f1dc47d4b5d8029d5a35fb7a548310654",
} as const;

/** The reserve key the launch builds for an Aave pool: the asset address, left-padded to 32 bytes. */
function reserveKeyOf(token: CatalogToken): string {
  return `0x${token.address.slice(2).padStart(64, "0")}`;
}

/**
 * The reserve fixtures. USDC is usable at a plausible 4.12% supply APY. WETH has reached its supply
 * cap, so it is listed but disabled: a reserve that fails any of the mandate step's checks (available,
 * active, not frozen, not paused, cap not reached) renders disabled with its reason.
 */
export const PANEL_RESERVE_FIXTURES: readonly CatalogReserve[] = [
  {
    protocolVersion: "v2",
    chainId: "42161",
    adapterKind: "aave-v3",
    mode: "supply",
    token: USDC_ARBITRUM,
    poolKey: reserveKeyOf(USDC_ARBITRUM),
    ...AAVE_V3_ARBITRUM,
    // aArbUSDCn
    aTokenAddress: "0x724dc807b04555b71ed48a6896b6f41593b8c637",
    supplyApy: "4.12",
    // The same rate as an APR in ray (27 decimals): 4.04%.
    supplyRateRay: "40400000000000000000000000",
    supplyCap: "430000000",
    currentSupply: { protocolVersion: "v2", raw: "301254879422103", decimal: "301254879.422103" },
    active: true,
    frozen: false,
    paused: false,
    supplyCapReached: false,
    available: true,
    mandateRequired: true,
  },
  {
    protocolVersion: "v2",
    chainId: "42161",
    adapterKind: "aave-v3",
    mode: "supply",
    token: WETH_ARBITRUM,
    poolKey: reserveKeyOf(WETH_ARBITRUM),
    ...AAVE_V3_ARBITRUM,
    // aArbWETH
    aTokenAddress: "0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8",
    supplyApy: "1.92",
    supplyRateRay: "19020000000000000000000000",
    supplyCap: "48000",
    currentSupply: {
      protocolVersion: "v2",
      raw: "48000000000000000000000",
      decimal: "48000.000000000000000000",
    },
    active: true,
    frozen: false,
    paused: false,
    supplyCapReached: true,
    available: false,
    mandateRequired: true,
  },
];

/** A copy of the reserve fixtures, so a caller can never write through the module constant. */
export function panelReserveFixtures(): CatalogReserve[] {
  return structuredClone([...PANEL_RESERVE_FIXTURES]);
}
