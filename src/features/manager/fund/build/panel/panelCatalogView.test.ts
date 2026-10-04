/**
 * @id PP-MGR-LIB-031
 * @name panelCatalogView tests
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks)
 *
 * Rules under test (POO-2185 rules v1):
 *   [R1] a catalog pool maps to a panel view: bare PoolId, chain, both tokens with decimals and logo,
 *        fee percent, tick spacing, current tick, canonical price, quote orientation
 *   [R2] the canonical price is derived from sqrtPriceX96 and the decimals; the price the catalog
 *        serves is only a cross-check, and a disagreement beyond 0.5% refuses the read
 *   [R3] eligibility and active liquidity are re-checked; TVL and APR are never exposed
 *   [R4] the mandate's Uniswap v4 pools of one network become list rows, with no fetch
 *   [R7] reserves join the draft tokens of the network, and an unusable one is listed with a reason
 */
import { describe, expect, it } from "vitest";
import type { CatalogPool, CatalogReserve } from "@/lib/api/v2/schemas";
import {
  findPanelPoolFixture,
  panelPoolFixtures,
  panelReserveFixtures,
} from "@/mocks/data/buildPanelFixtures";
import { fundPoolFixtures } from "@/mocks/data/fundPools";
import type { MandatePoolRef, MandateTokenRef } from "../../mandateDraft";
import {
  networkOfChain,
  type PanelPoolView,
  PRICE_CROSS_CHECK_TOLERANCE,
  panelPoolsFor,
  priceFromSqrtPriceX96,
  reserveUsability,
  selectPanelReserves,
  toLivePoolGrid,
  toPanelPoolView,
} from "./panelCatalogView";
import { presetRange } from "./poolRangeMath";

const ARB_WETH_USDC_5 = "arb-v4-weth-usdc-5";
const ARB_WETH_USDC_30 = "arb-v4-weth-usdc-30";
const RBH_WETH_USDG_5 = "rbh-v4-weth-usdg-5";

function fixture(chainId: 42161 | 4663, id: string): CatalogPool {
  const pool = findPanelPoolFixture(chainId, id);
  if (!pool) throw new Error(`no fixture ${id}`);
  return pool;
}

/** A pool with the given fields written over a fixture, deep-copied so tests never share state. */
function withPool(base: CatalogPool, patch: Partial<CatalogPool>): CatalogPool {
  return { ...structuredClone(base), ...patch };
}

function viewOf(pool: CatalogPool): PanelPoolView {
  return toPanelPoolView(pool);
}

describe("networkOfChain", () => {
  it("maps the two v2 chains to the mandate's networks", () => {
    expect(networkOfChain(42161)).toBe("arbitrum");
    expect(networkOfChain(4663)).toBe("robinhood");
  });
});

describe("priceFromSqrtPriceX96 [R2]", () => {
  const Q96 = "79228162514264337593543950336";

  it("is 1 at 2^96 with equal decimals, 4 at 2^97 and 0.25 at 2^95", () => {
    expect(priceFromSqrtPriceX96(Q96, 18, 18)).toBe(1);
    expect(priceFromSqrtPriceX96("158456325028528675187087900672", 6, 6)).toBe(4);
    expect(priceFromSqrtPriceX96("39614081257132168796771975168", 6, 6)).toBe(0.25);
  });

  it("applies the decimals: raw 1 is 10^12 token1 per token0 when token0 has 12 more decimals", () => {
    expect(priceFromSqrtPriceX96(Q96, 18, 6)).toBe(1e12);
    expect(priceFromSqrtPriceX96(Q96, 6, 18)).toBe(1e-12);
  });

  it("reads 3,050 USDC per WETH from the sqrt price of that price (18 / 6 decimals)", () => {
    // Computed offline: floor(sqrt(3050 * 10^6 / 10^18) * 2^96), an independent integer square root.
    expect(priceFromSqrtPriceX96("4375518288492161739703935", 18, 6)).toBeCloseTo(3050, 6);
  });

  it("reads a stable-first pair (6 / 18 decimals) as a small price", () => {
    // 0.0714285714 WETH-like units per USDC, same offline derivation.
    expect(priceFromSqrtPriceX96("21174617103766751077035126387589042", 6, 18)).toBeCloseTo(
      0.0714285714,
      9,
    );
  });

  it("sits within one tick of 1.0001^tick for the fixture's own tick", () => {
    const pool = fixture(42161, ARB_WETH_USDC_5);
    const price = priceFromSqrtPriceX96(pool.sqrtPriceX96, 18, 6) ?? Number.NaN;
    const atTick = 1.0001 ** pool.currentTick * 1e12;
    expect(price / atTick).toBeGreaterThanOrEqual(1);
    expect(price / atTick).toBeLessThan(1.0001);
  });

  it("answers null for a price it cannot read: zero, not digits, or out of float range", () => {
    expect(priceFromSqrtPriceX96("0", 18, 6)).toBeNull();
    expect(priceFromSqrtPriceX96("abc", 18, 6)).toBeNull();
    expect(priceFromSqrtPriceX96("", 18, 6)).toBeNull();
    expect(priceFromSqrtPriceX96("1".repeat(60), 255, 0)).toBeNull();
  });
});

describe("toPanelPoolView [R1]", () => {
  it("carries the bare lowercase PoolId, the chain and the network", () => {
    const pool = fixture(42161, ARB_WETH_USDC_5);
    const view = viewOf(withPool(pool, { poolId: pool.poolId.toUpperCase().replace("0X", "0x") }));
    expect(view.poolId).toBe(pool.poolId);
    expect(view.poolId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(view.chainId).toBe(42161);
    expect(view.network).toBe("arbitrum");
    expect(viewOf(fixture(4663, RBH_WETH_USDG_5)).chainId).toBe(4663);
    expect(viewOf(fixture(4663, RBH_WETH_USDG_5)).network).toBe("robinhood");
  });

  it("reads the fee as poolKey.fee / 10000 percent: 500 is 0.05, 3000 is 0.3", () => {
    expect(viewOf(fixture(42161, ARB_WETH_USDC_5)).feePct).toBe(0.05);
    expect(viewOf(fixture(42161, ARB_WETH_USDC_30)).feePct).toBe(0.3);
    expect(viewOf(fixture(42161, ARB_WETH_USDC_5)).feeTier).toBe(500);
  });

  it.each([
    [100, 0.01],
    [2500, 0.25],
    [10000, 1],
    [0, 0],
  ])("a fee of %s hundredths of a bip is %s percent", (fee, pct) => {
    const pool = fixture(42161, ARB_WETH_USDC_5);
    const patched = withPool(pool, {});
    patched.poolKey.fee = fee;
    expect(viewOf(patched).feePct).toBe(pct);
  });

  it("takes the tick spacing from the pool key, including one no v3 tier has", () => {
    expect(viewOf(fixture(42161, ARB_WETH_USDC_5)).tickSpacing).toBe(10);
    expect(viewOf(fixture(42161, ARB_WETH_USDC_30)).tickSpacing).toBe(60);
    const odd = withPool(fixture(42161, ARB_WETH_USDC_5), {});
    odd.poolKey.fee = 2500;
    odd.poolKey.tickSpacing = 50;
    expect(viewOf(odd).tickSpacing).toBe(50);
  });

  it("passes the current tick through", () => {
    expect(viewOf(fixture(42161, ARB_WETH_USDC_5)).currentTick).toBe(-196090);
    expect(viewOf(fixture(42161, ARB_WETH_USDC_30)).currentTick).toBe(-196087);
  });

  it("describes both tokens with symbol, address, decimals and logo", () => {
    const view = viewOf(fixture(42161, ARB_WETH_USDC_5));
    expect(view.token0).toEqual({
      address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      logoUrl: expect.stringContaining("http"),
    });
    expect(view.token1).toMatchObject({
      address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      symbol: "USDC",
      decimals: 6,
    });
    expect(view.token1.logoUrl).toBeTruthy();
  });

  it("keeps a missing logo as null, never an invented one", () => {
    const pool = withPool(fixture(42161, ARB_WETH_USDC_5), {});
    for (const token of pool.tokens) token.logoUrl = null;
    const view = viewOf(pool);
    expect(view.token0.logoUrl).toBeNull();
    expect(view.token1.logoUrl).toBeNull();
  });

  it("lowercases token addresses", () => {
    const pool = withPool(fixture(42161, ARB_WETH_USDC_5), {});
    const upper = (a: string) => `0x${a.slice(2).toUpperCase()}`;
    pool.poolKey.currency0 = upper(pool.poolKey.currency0);
    for (const token of pool.tokens) token.address = upper(token.address);
    const view = viewOf(pool);
    expect(view.token0.address).toBe(view.token0.address.toLowerCase());
    expect(view.token0.symbol).toBe("WETH");
  });

  describe("quote orientation: the pool key's currency order, never the written pair", () => {
    it("quotes USDC per WETH on the Arbitrum pool, where the pair is written the same way", () => {
      const view = viewOf(fixture(42161, ARB_WETH_USDC_5));
      expect(view.orientation.base.symbol).toBe("WETH");
      expect(view.orientation.quote.symbol).toBe("USDC");
      expect(view.pairLabel).toBe("WETH / USDC");
    });

    it("quotes USDG per WETH on Robinhood Chain: WETH is currency0, USDG currency1", () => {
      const view = viewOf(fixture(4663, RBH_WETH_USDG_5));
      expect(view.token0.symbol).toBe("WETH");
      expect(view.token1.symbol).toBe("USDG");
      expect(view.orientation.base.symbol).toBe("WETH");
      expect(view.orientation.quote.symbol).toBe("USDG");
      expect(view.pairLabel).toBe("WETH / USDG");
      expect(view.token0.decimals).toBe(18);
      expect(view.token1.decimals).toBe(6);
    });

    it.each([
      [42161, ARB_WETH_USDC_5, "WETH", "USDC"],
      [4663, RBH_WETH_USDG_5, "WETH", "USDG"],
    ] as const)("follows the pool key, not the order the catalog lists the tokens in (%s %s)", (chainId, id, base, quote) => {
      // Defensive: the catalog lists tokens[i] as currency i, but the key is what decides.
      const pool = withPool(fixture(chainId, id), {});
      pool.tokens = [...pool.tokens].reverse() as CatalogPool["tokens"];
      pool.pairSymbols = [...pool.pairSymbols].reverse();
      const view = viewOf(pool);
      expect(view.token0.symbol).toBe(base);
      expect(view.token1.symbol).toBe(quote);
      expect(view.token0.decimals).toBe(18);
      expect(view.token1.decimals).toBe(6);
      expect(view.orientation.quote.symbol).toBe(quote);
    });

    it("keeps the canonical price as token1 per token0 on a stable-first pool", () => {
      // currency0 is the 6-decimal USDC, so the canonical price is the small LINK per USDC.
      const pool = fixture(42161, "arb-v4-usdc-link-30");
      const view = viewOf(pool);
      expect(view.token0.symbol).toBe("USDC");
      expect(view.token1.symbol).toBe("LINK");
      expect(view.orientation.quote.symbol).toBe("LINK");
      expect(view.price).toBeGreaterThan(0.05);
      expect(view.price).toBeLessThan(0.08);
      expect(view.price).toBeCloseTo(Number(pool.currentPrice.token1PerToken0), 6);
    });
  });

  describe("canonical price (token1 per token0) [R2]", () => {
    it("is derived from sqrtPriceX96 and the decimals, and the served price confirms it", () => {
      const arbitrum = fixture(42161, ARB_WETH_USDC_5);
      expect(viewOf(arbitrum).price).toBe(
        priceFromSqrtPriceX96(arbitrum.sqrtPriceX96, 18, 6) ?? Number.NaN,
      );
      expect(viewOf(arbitrum).price).toBeCloseTo(3050.4127, 6);
      expect(viewOf(fixture(4663, RBH_WETH_USDG_5)).price).toBeCloseTo(3052.9061, 6);
    });

    it("every fixture's served price agrees with the price derived from its sqrt price", () => {
      for (const { mockId, pool } of panelPoolFixtures()) {
        const served = Number(pool.currentPrice.token1PerToken0);
        expect(Math.abs(viewOf(pool).price - served) / served, mockId).toBeLessThan(1e-9);
      }
    });

    it("keeps the derived price, not the served digits, when the two agree within the tolerance", () => {
      const pool = withPool(fixture(42161, ARB_WETH_USDC_5), {});
      pool.currentPrice.token1PerToken0 = "3040";
      const view = viewOf(pool);
      expect(view.price).toBeCloseTo(3050.4127, 6);
      expect(view.price).not.toBe(3040);
    });

    it("sets the tolerance at 0.5%", () => {
      expect(PRICE_CROSS_CHECK_TOLERANCE).toBe(0.005);
    });

    it.each([
      ["0.4% under", 0.996, true],
      ["0.4% over", 1.004, true],
      ["0.6% under", 0.994, false],
      ["0.6% over", 1.006, false],
    ])("a served price %s the derived one is %s", (_label, factor, accepted) => {
      const pool = withPool(fixture(42161, ARB_WETH_USDC_5), {});
      pool.currentPrice.token1PerToken0 = String(3050.4127 * factor);
      if (accepted) expect(viewOf(pool).price).toBeCloseTo(3050.4127, 6);
      else expect(() => viewOf(pool)).toThrow(/disagree/i);
    });

    it("refuses a served price that disagrees with sqrtPriceX96", () => {
      const pool = withPool(fixture(42161, ARB_WETH_USDC_5), {});
      pool.currentPrice.token1PerToken0 = "3000";
      expect(() => viewOf(pool)).toThrow(/disagree/i);
    });

    it("refuses a served price quoted the other way round (the reciprocal)", () => {
      const pool = withPool(fixture(4663, RBH_WETH_USDG_5), {});
      pool.currentPrice.token1PerToken0 = pool.currentPrice.token0PerToken1;
      expect(() => viewOf(pool)).toThrow(/inverted/i);
    });

    it("refuses a served price that is not a positive number, since it can confirm nothing", () => {
      for (const served of ["0", "-3050.4127"]) {
        const pool = withPool(fixture(42161, ARB_WETH_USDC_5), {});
        pool.currentPrice.token1PerToken0 = served;
        expect(() => viewOf(pool), served).toThrow(/disagree/i);
      }
    });

    it("refuses a pool whose sqrt price is zero: there is no price to derive", () => {
      const pool = withPool(fixture(42161, ARB_WETH_USDC_5), { sqrtPriceX96: "0" });
      expect(() => viewOf(pool)).toThrow(/price/i);
    });

    it("refuses a pool whose decimals make the served price wrong (a decimals slip)", () => {
      const pool = withPool(fixture(42161, ARB_WETH_USDC_5), {});
      const [weth] = pool.tokens;
      if (!weth) throw new Error("tokens");
      weth.decimals = 6;
      expect(() => viewOf(pool)).toThrow(/disagree/i);
    });
  });

  describe("toLivePoolGrid: the range maths' view of the pool", () => {
    it("hands over the pool's own decimals, spacing, price and tick", () => {
      const view = viewOf(fixture(42161, ARB_WETH_USDC_5));
      expect(toLivePoolGrid(view)).toEqual({
        decimals0: 18,
        decimals1: 6,
        tickSpacing: 10,
        currentPrice: view.price,
        currentTick: -196090,
      });
    });

    it.each(
      panelPoolFixtures().map(({ mockId, pool }) => [mockId, pool] as const),
    )("the 10 percent preset on %s is aligned to the pool's own spacing and brackets its tick", (_id, pool) => {
      const view = viewOf(pool);
      const range = presetRange(toLivePoolGrid(view), 10);
      expect(range).not.toBeNull();
      if (!range) return;
      expect(Math.abs(range.tickLower % view.tickSpacing)).toBe(0);
      expect(Math.abs(range.tickUpper % view.tickSpacing)).toBe(0);
      expect(range.tickLower).toBeLessThan(view.currentTick);
      expect(range.tickUpper).toBeGreaterThan(view.currentTick);
      expect(range.tickUpper - range.tickLower).toBeGreaterThanOrEqual(2 * view.tickSpacing);
    });
  });

  it("refuses a pool whose key names a currency its tokens do not carry", () => {
    const pool = withPool(fixture(42161, ARB_WETH_USDC_5), {});
    pool.poolKey.currency1 = `0x${"9".repeat(40)}`;
    expect(() => viewOf(pool)).toThrow(/currency/i);
  });

  it("does not expose TVL or APR, whatever the catalog served [R3]", () => {
    const pool = withPool(fixture(42161, ARB_WETH_USDC_5), {
      tvlUsd: "96000000",
      feesApr: "12.4",
    });
    const view = viewOf(pool) as unknown as Record<string, unknown>;
    expect(Object.keys(view).filter((key) => /tvl|apr|apy/i.test(key))).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("96000000");
    expect(JSON.stringify(view)).not.toContain("12.4");
  });

  describe("eligibility and active liquidity are re-checked [R3]", () => {
    const base = () => fixture(42161, ARB_WETH_USDC_5);

    it("is eligible with active liquidity for a clean pool", () => {
      const view = viewOf(base());
      expect(view.eligible).toBe(true);
      expect(view.hasActiveLiquidity).toBe(true);
    });

    it("is not eligible when the catalog says so", () => {
      expect(viewOf(withPool(base(), { eligible: false })).eligible).toBe(false);
    });

    it("is not eligible when the pool is hooked, by flag or by hooks address", () => {
      expect(viewOf(withPool(base(), { hooked: true })).eligible).toBe(false);
      const hooked = withPool(base(), {});
      hooked.poolKey.hooks = `0x${"1".repeat(40)}`;
      expect(viewOf(hooked).eligible).toBe(false);
    });

    it("is not eligible when a currency is the native zero address", () => {
      const native = withPool(base(), {});
      const [first, second] = native.tokens;
      if (!first || !second) throw new Error("tokens");
      first.address = `0x${"0".repeat(40)}`;
      native.poolKey.currency0 = first.address;
      expect(viewOf(native).eligible).toBe(false);
    });

    it("is not eligible when a token has no hub price", () => {
      const unpriced = withPool(base(), {});
      const token = unpriced.tokens[1];
      if (!token) throw new Error("tokens");
      token.hubPriced = false;
      expect(viewOf(unpriced).eligible).toBe(false);
    });

    it("has no active liquidity at zero, and says so apart from eligibility", () => {
      const view = viewOf(withPool(base(), { liquidity: "0" }));
      expect(view.hasActiveLiquidity).toBe(false);
      expect(view.eligible).toBe(true);
    });
  });
});

describe("panelPoolsFor [R4]", () => {
  /** A mandate pool the way real mode's `mapV2Pool` builds it: composite row id, bare PoolId. */
  function realRow(pool: CatalogPool): MandatePoolRef {
    const side = (address: string) => {
      const token = pool.tokens.find((entry) => entry.address === address);
      if (!token) throw new Error("token");
      return {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        logoUrl: token.logoUrl,
      };
    };
    return {
      id: `${pool.chainId}:${pool.poolId}`,
      address: pool.poolId,
      poolId: pool.poolId,
      poolKey: pool.poolKey,
      network: pool.chainId === "42161" ? "arbitrum" : "robinhood",
      protocol: "uniswap-v4",
      token0: side(pool.poolKey.currency0),
      token1: side(pool.poolKey.currency1),
      feeTier: pool.poolKey.fee,
      feeBps: pool.poolKey.fee / 100,
      tvlUsd: null,
      aprPct: null,
      tierSharePct: null,
      hasHook: pool.hooked,
    };
  }

  const realPools = [
    realRow(fixture(42161, ARB_WETH_USDC_5)),
    realRow(fixture(42161, ARB_WETH_USDC_30)),
    realRow(fixture(4663, RBH_WETH_USDG_5)),
  ];

  it("lists the Uniswap v4 pools of one network, in the mandate's order", () => {
    const rows = panelPoolsFor({ pools: realPools }, 42161);
    expect(rows.map((row) => row.feePct)).toEqual([0.05, 0.3]);
    expect(panelPoolsFor({ pools: realPools }, 4663)).toHaveLength(1);
  });

  it("gives each row the bare PoolId, the draft row id, the pair, the fee and both logos", () => {
    const [first] = panelPoolsFor({ pools: realPools }, 42161);
    const pool = fixture(42161, ARB_WETH_USDC_5);
    expect(first?.poolId).toBe(pool.poolId);
    expect(first?.poolId).not.toContain(":");
    expect(first?.rowId).toBe(`42161:${pool.poolId}`);
    expect(first?.pairLabel).toBe("WETH / USDC");
    expect(first?.token0.symbol).toBe("WETH");
    expect(first?.token1.symbol).toBe("USDC");
    expect(first?.token0.logoUrl).toBeTruthy();
    expect(first?.token1.logoUrl).toBeTruthy();
    expect(first?.feeTier).toBe(500);
    expect(first?.feePct).toBe(0.05);
    expect(first?.tickSpacing).toBe(10);
  });

  it("uses the row id as the PoolId in mock mode, where a mandate pool has none", () => {
    const mock = fundPoolFixtures().uniswapV4.filter((pool) => pool.network === "arbitrum");
    const rows = panelPoolsFor({ pools: mock }, 42161);
    const first = rows.find((row) => row.rowId === ARB_WETH_USDC_5);
    expect(first?.poolId).toBe(ARB_WETH_USDC_5);
    expect(first?.feePct).toBe(0.05);
    expect(first?.tickSpacing).toBeNull();
  });

  it("leaves out pools of another protocol, another network and any pool with a hook", () => {
    const v3 = {
      ...realPools[0],
      id: "v3",
      poolId: undefined,
      protocol: "uniswap-v3",
    } as MandatePoolRef;
    const hooked = { ...realPools[0], id: "hooked", hasHook: true } as MandatePoolRef;
    const rows = panelPoolsFor({ pools: [v3, hooked, ...realPools] }, 42161);
    expect(rows.map((row) => row.rowId)).toEqual([
      `42161:${fixture(42161, ARB_WETH_USDC_5).poolId}`,
      `42161:${fixture(42161, ARB_WETH_USDC_30).poolId}`,
    ]);
  });

  it("is empty for a mandate with no v4 pool on that network", () => {
    expect(panelPoolsFor({ pools: [] }, 42161)).toEqual([]);
    expect(panelPoolsFor({ pools: [realPools[2] as MandatePoolRef] }, 42161)).toEqual([]);
  });

  it("exposes no TVL or APR, even for a mock pool that carries them", () => {
    const mock = fundPoolFixtures().uniswapV4.filter((pool) => pool.network === "arbitrum");
    expect(mock.some((pool) => pool.tvlUsd !== null)).toBe(true);
    const rows = panelPoolsFor({ pools: mock }, 42161) as unknown as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(Object.keys(row).filter((key) => /tvl|apr/i.test(key))).toEqual([]);
    }
  });

  it("does not mutate the draft", () => {
    const pools = structuredClone(realPools);
    panelPoolsFor({ pools }, 42161);
    expect(pools).toEqual(realPools);
  });
});

describe("reserveUsability [R7]", () => {
  function reserve(patch: Partial<CatalogReserve> = {}): CatalogReserve {
    const usdc = panelReserveFixtures()[0];
    if (!usdc) throw new Error("fixture");
    return { ...usdc, ...patch };
  }

  it("is usable when available, active, not frozen, not paused and the cap is not reached", () => {
    expect(reserveUsability(reserve())).toEqual({ usable: true, reason: null });
  });

  it.each([
    ["active", { active: false }, "inactive"],
    ["frozen", { frozen: true }, "frozen"],
    ["paused", { paused: true }, "paused"],
    ["supplyCapReached", { supplyCapReached: true }, "supplyCapReached"],
    ["available", { available: false }, "unavailable"],
  ] as const)("is not usable when %s fails, with the reason %s", (_flag, patch, reason) => {
    expect(reserveUsability(reserve(patch))).toEqual({ usable: false, reason });
  });

  it("names the specific cause first when the overall flag is down too", () => {
    expect(reserveUsability(reserve({ available: false, frozen: true })).reason).toBe("frozen");
    expect(reserveUsability(reserve({ available: false, supplyCapReached: true })).reason).toBe(
      "supplyCapReached",
    );
  });
});

describe("selectPanelReserves [R7]", () => {
  const usdcAddress = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
  const wethAddress = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";

  function draftToken(
    address: string,
    symbol: string,
    network: MandateTokenRef["network"] = "arbitrum",
    locked = false,
  ): MandateTokenRef {
    return { address, symbol, name: `${symbol} name`, network, logoUrl: `logo:${symbol}`, locked };
  }

  const tokens = [
    draftToken(usdcAddress, "USDC", "arbitrum", true),
    draftToken(wethAddress, "WETH"),
  ];

  it("joins the reserves to the draft tokens of the network and lists a usable and an unusable row", () => {
    const rows = selectPanelReserves(panelReserveFixtures(), tokens, 42161);
    expect(rows.map((row) => [row.token.symbol, row.usable, row.reason])).toEqual([
      ["USDC", true, null],
      ["WETH", false, "supplyCapReached"],
    ]);
  });

  it("serves the supply APY exactly as the catalog wrote it", () => {
    const rows = selectPanelReserves(panelReserveFixtures(), tokens, 42161);
    expect(rows.map((row) => row.supplyApy)).toEqual(["4.12", "1.92"]);
    expect(typeof rows[0]?.supplyApy).toBe("string");
  });

  it("gives each row the asset key a Supply block's config holds: network:address, lowercase", () => {
    const rows = selectPanelReserves(panelReserveFixtures(), tokens, 42161);
    expect(rows.map((row) => row.assetKey)).toEqual([
      `arbitrum:${usdcAddress}`,
      `arbitrum:${wethAddress}`,
    ]);
  });

  it("describes the token as the manager chose it in the mandate, with the catalog's decimals", () => {
    const [usdc] = selectPanelReserves(panelReserveFixtures(), tokens, 42161);
    expect(usdc?.token).toEqual({
      address: usdcAddress,
      symbol: "USDC",
      name: "USDC name",
      decimals: 6,
      logoUrl: "logo:USDC",
    });
  });

  it("leaves out a reserve whose token the mandate does not hold (mandate only)", () => {
    const rows = selectPanelReserves(panelReserveFixtures(), [tokens[0] as MandateTokenRef], 42161);
    expect(rows.map((row) => row.token.symbol)).toEqual(["USDC"]);
  });

  it("matches addresses regardless of letter case", () => {
    const shouting = [draftToken(usdcAddress.toUpperCase().replace("0X", "0x"), "USDC")];
    expect(selectPanelReserves(panelReserveFixtures(), shouting, 42161)).toHaveLength(1);
  });

  it("does not count a token of another network", () => {
    const spoke = [draftToken(usdcAddress, "USDC", "robinhood")];
    expect(selectPanelReserves(panelReserveFixtures(), spoke, 42161)).toEqual([]);
  });

  it("is empty on a spoke: Aave is on the hub only", () => {
    const both = [...tokens, draftToken(usdcAddress, "USDC", "robinhood")];
    expect(selectPanelReserves(panelReserveFixtures(), both, 4663)).toEqual([]);
  });

  describe("the mandate's own Aave reserve selection", () => {
    it("lists only the reserves the draft selected when it names them", () => {
      const rows = selectPanelReserves(panelReserveFixtures(), tokens, 42161, [usdcAddress]);
      expect(rows.map((row) => row.token.symbol)).toEqual(["USDC"]);
    });

    it("lists a selected reserve even when Aave cannot take it, disabled with its reason", () => {
      const rows = selectPanelReserves(panelReserveFixtures(), tokens, 42161, [wethAddress]);
      expect(rows.map((row) => [row.token.symbol, row.usable, row.reason])).toEqual([
        ["WETH", false, "supplyCapReached"],
      ]);
    });

    it("lists nothing when the draft selected no reserve", () => {
      expect(selectPanelReserves(panelReserveFixtures(), tokens, 42161, [])).toEqual([]);
    });

    it("lists every reserve of the mandate's tokens when the draft names none (undefined)", () => {
      expect(selectPanelReserves(panelReserveFixtures(), tokens, 42161, undefined)).toHaveLength(2);
    });

    it("matches the selection regardless of letter case", () => {
      const rows = selectPanelReserves(panelReserveFixtures(), tokens, 42161, [
        usdcAddress.toUpperCase().replace("0X", "0x"),
      ]);
      expect(rows.map((row) => row.token.symbol)).toEqual(["USDC"]);
    });
  });

  it("keeps the catalog's order and is empty when the catalog has no reserve", () => {
    expect(selectPanelReserves([], tokens, 42161)).toEqual([]);
    const reversed = [...panelReserveFixtures()].reverse();
    expect(selectPanelReserves(reversed, tokens, 42161).map((row) => row.token.symbol)).toEqual([
      "WETH",
      "USDC",
    ]);
  });

  it("does not mutate its inputs", () => {
    const reserves = panelReserveFixtures();
    const before = structuredClone(reserves);
    const tokensBefore = structuredClone(tokens);
    selectPanelReserves(reserves, tokens, 42161);
    expect(reserves).toEqual(before);
    expect(tokens).toEqual(tokensBefore);
  });
});
