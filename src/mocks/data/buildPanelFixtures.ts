/**
 * @id PP-MGR-MCK-005
 * @name buildPanelFixtures
 * @implements-rules-version v1 (POO-2185 rules v1, slice PC of POO-2171)
 * @analytics-events none (data hooks): a data fixture, nothing here is rendered or tracked.
 *
 * PP-MOCK. What the Build configuration panels read in MOCK mode: three Uniswap v4 pools and two
 * Aave v3 reserves, in the exact WIRE shape of the v2 catalog (`CatalogPool`, `CatalogReserve`), so
 * the mock path goes through the same mapping as the real one (`panelCatalogView`, PP-MGR-LIB-031)
 * and a fixture that drifts from the contract fails `catalogPoolSchema` in `buildPanelFixtures.test`.
 * There is no sample data in real mode (P13): these serve mock mode, tests and Storybook only.
 *
 * Realism, per docs/05_MOCK_STRATEGY.md:
 *
 * - **Real identities.** Token addresses, decimals and logos are the bundled token lists' own, and
 *   the Aave addresses are the deployed Aave v3 Arbitrum ones. Each `poolId` is the real v4 PoolId,
 *   `keccak256(abi.encode(poolKey))`, which the test recomputes, so the key and the id cannot drift.
 * - **Coherent numbers.** `currentTick`, `sqrtPriceX96` and both price strings come from one price
 *   (about 3,050 USD per ETH), with the decimals applied (WETH 18, USDC and USDG 6), so a mapper that
 *   reads either source lands on the same price.
 * - **Currency order is the chain's, not taste.** `currency0` is the lower address. On Robinhood
 *   Chain the WETH address sorts below USDG's, so the canonical price there is USDG per WETH, while
 *   the catalog WRITES that pair as `USDG / WETH` (`tokens` and `pairSymbols`). The mapper must
 *   follow the pool key, never the written order (handoff v1.2, "Range bounds"), and this pool is
 *   the one that proves it.
 * - **TVL and APR are null with a reason**, as the alpha serves them: the panels never print a number
 *   for them (decision A3) and never show active liquidity as TVL.
 * - **Diverse states.** The Aave USDC reserve is usable; the WETH reserve has reached its supply
 *   cap, so a list row is disabled with its reason (P1, P13). The alpha lists USDC alone, so that
 *   second reserve is the one invented row, and it exists to exercise the disabled state.
 *
 * Mock-mode ids: the mandate's mock Pools step (`fundPools.ts`, PP-MGR-MCK-003) has no PoolId (its
 * rows are slugs such as `arb-v4-weth-usdc-5`), and a Pool block of a mock-mode plan holds that slug
 * as its `poolId`. Each fixture therefore carries its `mockId` and {@link findPanelPoolFixture}
 * answers to either the real PoolId or the slug. A slug with no fixture is a not-found, never an
 * invented pool.
 *
 * The only invented values: the oracle addresses on Robinhood Chain (no registry is public yet), the
 * reserve key (a hash of the reserve identity) and the pool liquidity figures.
 *
 * PP-INTEGRATION-POINT: replaced in real mode by `GET /api/v2/catalog/uniswap-v4/pools/{poolId}` and
 * `GET /api/v2/catalog/aave-v3/reserves` (server actions `getCatalogPoolAction` and
 * `getCatalogReservesAction`, POO-2133); the panels' hooks pick the source, never these files.
 */
import type { CatalogPool, CatalogReserve, CatalogToken, V2ChainId } from "@/lib/api/v2/schemas";

/** Mock latency band for a panel read, in ms: wide enough that the skeleton is visible in review. */
export const PANEL_MOCK_LATENCY_MS: readonly [number, number] = [120, 320];

/** Mock failure probability of a panel read, the "realistic 2-5%" band of docs/05_MOCK_STRATEGY.md. */
export const PANEL_MOCK_FAILURE_RATE = 0.02;

const NO_HOOKS = "0x0000000000000000000000000000000000000000";

/** A recent unix second, so a price reads as fresh (2026-10-04 03:00 UTC). */
const PRICE_UPDATED_AT = "1791082800";

// ---------------------------------------------------------------------------
// Tokens
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
  // Chainlink USDC / USD on Arbitrum One.
  priceSource: "0x50834f3163758fcc1df9973b6e91f0f0f0434ad3",
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
  // Invented, as above.
  priceSource: "0x7a2e5f1c9d3b8a40e6c1f2d3b4a5968778695a4b",
  priceProvenance: "fixed-1:1",
  priceUnavailableReason: null,
};

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

const TVL_REASON = "TVL is not indexed for v4 pools yet.";
const APR_REASON = "Fees APR is not indexed for v4 pools yet.";

/** One fixture pool plus the slug the mandate's mock Pools step knows it by. */
export interface PanelPoolFixture {
  /** The `id` of the same pool in `fundPools.ts` (PP-MGR-MCK-003), the mock-mode `poolId`. */
  mockId: string;
  pool: CatalogPool;
}

/**
 * The pool fixtures, deepest first. Prices are token1 per token0, the canonical orientation.
 *
 * - Arbitrum WETH / USDC 0.05%, spacing 10, about 3,050.
 * - Arbitrum WETH / USDC 0.3%, spacing 60, a few ticks away (a different book of the same pair).
 * - Robinhood Chain WETH / USDG 0.05%, WRITTEN `USDG / WETH` by the catalog, with the pool key in
 *   the chain's order (WETH is currency0), see the file header.
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
      // The catalog WRITES this pair stable first. The pool key above is the chain's order.
      tokens: [USDG_ROBINHOOD, WETH_ROBINHOOD],
      pairSymbols: ["USDG", "WETH"],
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

/**
 * The pool of a mock-mode Pool block, by real PoolId (case-insensitive) or by the mock Pools step's
 * slug, on one network. A copy, so a caller can never write through the module constant. Null when
 * no fixture matches: the mock never invents a pool for an id it does not know.
 */
export function findPanelPoolFixture(chainId: V2ChainId, poolId: string): CatalogPool | null {
  const wanted = poolId.toLowerCase();
  const hit = PANEL_POOL_FIXTURES.find(
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
    poolKey: "0x2b1f6b0a8c3d4e5f7081928374655647382910afbecdc1d2e3f405162738495a",
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
    poolKey: "0x9d3e0c1b2a4f5e6d7c8b9a0f1e2d3c4b5a69788796a5b4c3d2e1f00a1b2c3d4e",
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
