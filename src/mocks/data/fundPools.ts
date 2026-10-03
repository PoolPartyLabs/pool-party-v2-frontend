/**
 * @id PP-MGR-MCK-003
 * @name fund pool catalog (mock)
 * @implements-rules-version v1 (POO-2125 rules v1)
 * @analytics-events none, a data fixture
 *
 * PP-MOCK. The pools the fund-contracts Mandate step offers that the V1 catalog cannot:
 *
 * - every Uniswap v4 pool, because there is no v4 pool API yet on any network;
 * - the Uniswap v3 pools on Robinhood Chain, because `pools.ts` has none there (V1 never shipped a
 *   chain beyond the launch three in its fixtures);
 * - the Uniswap v3 pools on Arbitrum. `pools.ts` HAS four rows there and the adapter maps them as
 *   `uniswap-v3`, so on paper the hub was covered. It never was: those rows carry synthetic token
 *   addresses (`mockAddress("arbitrum-ETH")`), while the mock search matches a pool by the REAL
 *   address of a mandate token, so no V1 mock row can ever match one. A hub-only mandate on Uniswap
 *   v3 alone therefore listed no pool at all, which refuses Next and strands the manager unless they
 *   go back and add Uniswap v4. Mock mode is what design reviews and previews run on, so that was
 *   the state most people saw. The V1 rows stay in the universe (a pasted address still resolves
 *   against them); these are what a mandate's own tokens find.
 *
 * Realism, per docs/05_MOCK_STRATEGY.md:
 *
 * - **Identity is never invented.** Every token side is resolved through `findToken` against the
 *   network's bundled list, so the symbol, name and logo printed in the Pools step are the same
 *   ones the Tokens step prints for that address. The stable side's address comes from
 *   `getUsdcAddress`, the one place the app defines a chain's stable, so a fixture cannot drift
 *   from the deposit token the draft locks. Both are asserted in `fundPools.test.ts`.
 * - **`token0`/`token1` follow the chain, not taste.** Uniswap assigns them by ascending address
 *   and the app never re-orders a pair (POO-1428), so {@link fundPool} sorts the two sides itself.
 * - **Scale and spread.** TVL spans 243 thousand to 48 million with a power-law shape, APR runs
 *   2.6% to 38.6%, and one pair per protocol carries three fee tiers so the tier-share column has
 *   something to divide. Fee tiers are only the four real ones (POO-1497).
 * - **Diverse states.** Exactly two pools carry a hook, which is the only thing that exercises the
 *   Pools step's `has_hook` refusal (R38), and the Robinhood equity tokens are deliberately present
 *   and deliberately unpriced, which is what exercises the `not_priced` refusal (R28).
 *
 * Pool addresses are derived from the id (see {@link mockPoolAddress}) rather than drawn, so they
 * are stable across renders and SSR. They are the one invented value in the file, and they are
 * invented because a pool that does not exist has no address to read.
 *
 * ## Nothing is built at import
 *
 * The rows come from {@link fundPoolFixtures}, memoised, and NOT from module-level constants. The
 * reason is {@link listed}: it throws when the bundled token list cannot resolve an address, which
 * is the right behaviour for a fixture (a mock that quietly invented a symbol would put a name on
 * screen no other surface agrees with) and the wrong behaviour for a module body. `mandatePoolSource`
 * imports this file in BOTH modes, so a throw at import time would be raised inside the real-mode
 * Pools step: a PP-MOCK file taking down a screen that asked for no mock. Deferring the build moves
 * the throw to the only caller that wants these rows, which is the mock path.
 *
 * PP-INTEGRATION-POINT: becomes the fund contracts' own pool catalog (Uniswap v4 positions on the
 * hub and the spoke). There is no v4 pool endpoint today; wiring issue POO-2133 tracks it.
 */
import type { MandatePoolRef, NetworkId } from "@/features/manager/fund/mandateDraft";
import { getUsdcAddress, networkToChainId } from "@/lib/chains/config";
import { findToken } from "@/lib/tokens/tokenList";

/** One side of a fixture pool, in `MandatePoolRef`'s token shape. */
type PoolTokenRef = MandatePoolRef["token0"];

/**
 * A deterministic, high-entropy mock pool address (`0x` + 40 lowercase hex) derived from the pool
 * id. FNV-1a over the seed, re-hashed per 8-character block.
 *
 * `pools.ts`'s own `mockAddress` is not reused because it is private to that module and its output
 * is visibly patterned (consecutive nibbles walk upward), which reads as fake in a list of
 * addresses the manager can copy. Same contract: no `Math.random`, so the value is identical on the
 * server and the client and a snapshot cannot flake.
 */
function mockPoolAddress(seed: string): string {
  let hex = "";
  let hash = 0x811c9dc5;
  while (hex.length < 40) {
    for (let i = 0; i < seed.length; i++) {
      hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    }
    hash = Math.imul(hash ^ hex.length, 0x01000193) >>> 0;
    hex += hash.toString(16).padStart(8, "0");
  }
  return `0x${hex.slice(0, 40)}`;
}

/**
 * The token at `address` on `network`, as the bundled list describes it.
 *
 * Throws at module load when the list cannot resolve it, which is deliberate: a fixture that
 * silently fell back to an invented symbol would put a token name on screen that no other surface
 * agrees with. A token list that drops an entry should break this file loudly.
 */
function listed(network: NetworkId, address: string): PoolTokenRef {
  const info = findToken(network, address);
  if (!info) {
    throw new Error(`fundPools: ${address} is not in the ${network} token list`);
  }
  return {
    address: info.address,
    symbol: info.symbol,
    name: info.name,
    logoUrl: info.iconUrl ?? null,
  };
}

/** The chain's stable, by address, from the single source `lib/chains/config.ts` owns. */
function stable(network: NetworkId): PoolTokenRef {
  const chainId = networkToChainId(network);
  const address = chainId == null ? undefined : getUsdcAddress(chainId);
  if (!address) {
    throw new Error(`fundPools: ${network} has no configured stable currency`);
  }
  return listed(network, address.toLowerCase());
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

interface FundPoolInput {
  /** Stable slug, e.g. `arb-v4-weth-usdc-5`. The pool address derives from it. */
  id: string;
  network: NetworkId;
  protocol: MandatePoolRef["protocol"];
  /** The two sides, in any order: Uniswap's own ascending-address order is applied here. */
  sides: readonly [PoolTokenRef, PoolTokenRef];
  /** Fee in basis points. One of the four real Uniswap tiers. */
  feeBps: number;
  tvlUsd: number;
  aprPct: number;
  /** Uniswap v4 only. A hooked pool cannot enter a mandate (R38). */
  hasHook?: boolean;
}

/** One fixture pool, with `token0`/`token1` ordered the way the chain orders them. */
function fundPool(input: FundPoolInput): MandatePoolRef {
  const [first, second] = input.sides;
  const ascending = first.address < second.address;
  return {
    id: input.id,
    address: mockPoolAddress(input.id),
    network: input.network,
    protocol: input.protocol,
    token0: ascending ? first : second,
    token1: ascending ? second : first,
    feeBps: input.feeBps,
    // Hundredths of a bip, the unit `/dex-pools` and create-pool both speak (5 bps → 500).
    feeTier: input.feeBps * 100,
    tvlUsd: input.tvlUsd,
    aprPct: input.aprPct,
    // Never baked in: the share is a property of the pools a search actually returned, so
    // `mandatePoolSource.tierShare` fills it and a fixture that carried a number would be a
    // fabricated figure (POO-1469).
    tierSharePct: null,
    hasHook: input.hasHook ?? false,
  };
}

/** The fund-contracts pool fixtures, split the way the adapter consumes them. */
export interface FundPoolFixtures {
  /**
   * PP-MOCK: Uniswap v4 pools on the hub and the spoke. The hub carries the depth (ETH/USDC at
   * three tiers, the stable pairs), the spoke carries the thin early-chain book.
   */
  uniswapV4: MandatePoolRef[];
  /**
   * PP-MOCK: Uniswap v3 pools on Robinhood Chain. The V1 catalog in `pools.ts` stops at the launch
   * three, so without these a mandate that selects the spoke and `uniswap-v3` would show an empty
   * Pools step and look broken rather than thin.
   *
   * No hooks here, ever: Uniswap v3 has none.
   */
  robinhoodV3: MandatePoolRef[];
  /**
   * PP-MOCK: Uniswap v3 pools on Arbitrum, the hub. These exist because the V1 rows `pools.ts`
   * carries for Arbitrum are unreachable from a mandate: their token addresses are synthetic, and
   * the mock search matches on a mandate token's real address (see the file header). Every priced
   * token the catalog offers on the hub is paired into at least one of these, so a mandate holding
   * any of them finds a pool.
   *
   * No hooks here either: Uniswap v3 has none.
   */
  arbitrumV3: MandatePoolRef[];
}

/** Built on the first call, then handed back by reference. See the file header for why. */
let fixtures: FundPoolFixtures | null = null;

/** Every fund-contracts pool fixture. Resolves the token lists on first use, never at import. */
export function fundPoolFixtures(): FundPoolFixtures {
  fixtures ??= buildFundPoolFixtures();
  return fixtures;
}

/** Resolve every token side, then lay out the rows. The only place `listed`/`stable` can throw. */
function buildFundPoolFixtures(): FundPoolFixtures {
  /**
   * Arbitrum sides. The wrapped-ether entry resolves to the app-wide canonical "ETH" symbol
   * (`canonicalTokenSymbol`), so a manager who sees ETH in the wallet sees ETH here.
   *
   * `cbBTC` is absent on purpose: it has no entry in `src/lib/tokens/data/arbitrum.json`, and a
   * pool for a token the app cannot name is worse than one pool fewer.
   */
  const ARB = {
    usdc: stable("arbitrum"),
    weth: listed("arbitrum", "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"),
    wbtc: listed("arbitrum", "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f"),
    arb: listed("arbitrum", "0x912ce59144191c1204e64559fe8253a0e49e6548"),
    link: listed("arbitrum", "0xf97f4df75117a78c1a5a0dbb814af92458539fb4"),
    usdt: listed("arbitrum", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9"),
    dai: listed("arbitrum", "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1"),
    wsteth: listed("arbitrum", "0x0fbcbaea96ce0cf7ee00a8c19c3ab6f5dc8e1921"),
  } as const;

  /**
   * Robinhood Chain sides. The chain's stable is USDG, and this file prints the label the chain
   * config carries for it (POO-1779 [R1]: never print "USDC" beside a USDG amount). The equity
   * tokens are the chain's actual listings and are deliberately outside `PRICED_SYMBOLS`.
   */
  const RBH = {
    usdg: stable("robinhood"),
    weth: listed("robinhood", "0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
    nvda: listed("robinhood", "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec"),
    aapl: listed("robinhood", "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9"),
    tsla: listed("robinhood", "0x322f0929c4625ed5bad873c95208d54e1c003b2d"),
  } as const;

  const uniswapV4: MandatePoolRef[] = [
    fundPool({
      id: "arb-v4-weth-usdc-5",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.weth, ARB.usdc],
      feeBps: 5,
      tvlUsd: 48_200_000,
      aprPct: 12.4,
    }),
    fundPool({
      id: "arb-v4-weth-usdc-30",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.weth, ARB.usdc],
      feeBps: 30,
      tvlUsd: 11_600_000,
      aprPct: 8.7,
    }),
    fundPool({
      id: "arb-v4-weth-usdc-1",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.weth, ARB.usdc],
      feeBps: 1,
      tvlUsd: 2_350_000,
      aprPct: 4.1,
    }),
    fundPool({
      id: "arb-v4-usdc-usdt-1",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.usdc, ARB.usdt],
      feeBps: 1,
      tvlUsd: 23_400_000,
      aprPct: 3.2,
    }),
    fundPool({
      id: "arb-v4-wbtc-usdc-30",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.wbtc, ARB.usdc],
      feeBps: 30,
      tvlUsd: 9_840_000,
      aprPct: 9.6,
    }),
    fundPool({
      id: "arb-v4-wbtc-weth-5",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.wbtc, ARB.weth],
      feeBps: 5,
      tvlUsd: 4_150_000,
      aprPct: 6.3,
    }),
    fundPool({
      id: "arb-v4-arb-usdc-30",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.arb, ARB.usdc],
      feeBps: 30,
      tvlUsd: 5_920_000,
      aprPct: 21.8,
    }),
    fundPool({
      id: "arb-v4-usdc-link-30",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.usdc, ARB.link],
      feeBps: 30,
      tvlUsd: 1_260_000,
      aprPct: 17.5,
    }),
    fundPool({
      id: "arb-v4-usdc-dai-1",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.usdc, ARB.dai],
      feeBps: 1,
      tvlUsd: 1_480_000,
      aprPct: 2.6,
    }),
    // The two hooked pools. A liquid-staking pair and a long-tail volatile pair, so the refusal shows
    // up on a pool a manager would plausibly want rather than only on an obscure one.
    fundPool({
      id: "arb-v4-wsteth-weth-1",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.wsteth, ARB.weth],
      feeBps: 1,
      tvlUsd: 6_740_000,
      aprPct: 3.4,
      hasHook: true,
    }),
    fundPool({
      id: "arb-v4-weth-arb-100",
      network: "arbitrum",
      protocol: "uniswap-v4",
      sides: [ARB.weth, ARB.arb],
      feeBps: 100,
      tvlUsd: 418_000,
      aprPct: 38.6,
      hasHook: true,
    }),
    fundPool({
      id: "rbh-v4-weth-usdg-5",
      network: "robinhood",
      protocol: "uniswap-v4",
      sides: [RBH.weth, RBH.usdg],
      feeBps: 5,
      tvlUsd: 3_120_000,
      aprPct: 11.2,
    }),
    fundPool({
      id: "rbh-v4-weth-usdg-30",
      network: "robinhood",
      protocol: "uniswap-v4",
      sides: [RBH.weth, RBH.usdg],
      feeBps: 30,
      tvlUsd: 864_000,
      aprPct: 7.4,
    }),
    fundPool({
      id: "rbh-v4-usdg-nvda-30",
      network: "robinhood",
      protocol: "uniswap-v4",
      sides: [RBH.usdg, RBH.nvda],
      feeBps: 30,
      tvlUsd: 1_540_000,
      aprPct: 24.3,
    }),
  ];

  const robinhoodV3: MandatePoolRef[] = [
    fundPool({
      id: "rbh-v3-weth-usdg-5",
      network: "robinhood",
      protocol: "uniswap-v3",
      sides: [RBH.weth, RBH.usdg],
      feeBps: 5,
      tvlUsd: 2_240_000,
      aprPct: 9.8,
    }),
    fundPool({
      id: "rbh-v3-weth-usdg-30",
      network: "robinhood",
      protocol: "uniswap-v3",
      sides: [RBH.weth, RBH.usdg],
      feeBps: 30,
      tvlUsd: 642_000,
      aprPct: 6.9,
    }),
    fundPool({
      id: "rbh-v3-usdg-aapl-30",
      network: "robinhood",
      protocol: "uniswap-v3",
      sides: [RBH.usdg, RBH.aapl],
      feeBps: 30,
      tvlUsd: 985_000,
      aprPct: 15.1,
    }),
    fundPool({
      id: "rbh-v3-tsla-usdg-100",
      network: "robinhood",
      protocol: "uniswap-v3",
      sides: [RBH.tsla, RBH.usdg],
      feeBps: 100,
      tvlUsd: 312_000,
      aprPct: 31.7,
    }),
  ];

  /**
   * The hub's Uniswap v3 book: the deep stable and majors pairs a real Arbitrum catalog leads with,
   * down to a thin 1% long-tail pool. Every priced hub token the catalog offers appears here, which
   * is the property `fundPools.test.ts` pins: a mandate that holds one of them must find a pool.
   *
   * Depths are ordered the way the real book is, not drawn: ETH/USDC at 0.05% carries most of the
   * volume, the 0.30% tier an order of magnitude less, the 0.01% tier less again, and the stable
   * pairs sit deep with a low APR while the long tail is thin with a high one.
   */
  const arbitrumV3: MandatePoolRef[] = [
    fundPool({
      id: "arb-v3-weth-usdc-5",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.weth, ARB.usdc],
      feeBps: 5,
      tvlUsd: 34_600_000,
      aprPct: 15.3,
    }),
    fundPool({
      id: "arb-v3-weth-usdc-30",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.weth, ARB.usdc],
      feeBps: 30,
      tvlUsd: 2_180_000,
      aprPct: 6.8,
    }),
    fundPool({
      id: "arb-v3-weth-usdc-1",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.weth, ARB.usdc],
      feeBps: 1,
      tvlUsd: 517_000,
      aprPct: 4.4,
    }),
    fundPool({
      id: "arb-v3-usdc-usdt-1",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.usdc, ARB.usdt],
      feeBps: 1,
      tvlUsd: 16_900_000,
      aprPct: 2.9,
    }),
    fundPool({
      id: "arb-v3-wbtc-weth-5",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.wbtc, ARB.weth],
      feeBps: 5,
      tvlUsd: 8_730_000,
      aprPct: 5.7,
    }),
    fundPool({
      id: "arb-v3-wbtc-usdc-30",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.wbtc, ARB.usdc],
      feeBps: 30,
      tvlUsd: 3_260_000,
      aprPct: 11.4,
    }),
    fundPool({
      id: "arb-v3-wsteth-weth-1",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.wsteth, ARB.weth],
      feeBps: 1,
      tvlUsd: 5_380_000,
      aprPct: 3.3,
    }),
    fundPool({
      id: "arb-v3-arb-usdc-30",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.arb, ARB.usdc],
      feeBps: 30,
      tvlUsd: 4_910_000,
      aprPct: 18.9,
    }),
    fundPool({
      id: "arb-v3-usdt-weth-5",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.usdt, ARB.weth],
      feeBps: 5,
      tvlUsd: 1_640_000,
      aprPct: 9.2,
    }),
    fundPool({
      id: "arb-v3-arb-weth-30",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.arb, ARB.weth],
      feeBps: 30,
      tvlUsd: 1_070_000,
      aprPct: 26.2,
    }),
    fundPool({
      id: "arb-v3-usdc-link-30",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.usdc, ARB.link],
      feeBps: 30,
      tvlUsd: 968_000,
      aprPct: 16.7,
    }),
    fundPool({
      id: "arb-v3-usdc-dai-1",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.usdc, ARB.dai],
      feeBps: 1,
      tvlUsd: 694_000,
      aprPct: 3.8,
    }),
    // The long tail: the 1% tier on a pair whose depth lives elsewhere. Thin, and the highest APR in
    // the set, which is what a thin pool looks like.
    fundPool({
      id: "arb-v3-link-weth-100",
      network: "arbitrum",
      protocol: "uniswap-v3",
      sides: [ARB.link, ARB.weth],
      feeBps: 100,
      tvlUsd: 243_000,
      aprPct: 29.4,
    }),
  ];

  return { uniswapV4, robinhoodV3, arbitrumV3 };
}
