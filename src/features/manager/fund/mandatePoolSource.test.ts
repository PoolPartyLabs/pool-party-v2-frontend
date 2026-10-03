/**
 * @id PP-MGR-CMP-038
 * @name mandatePoolSource tests
 * @implements-rules-version v1 (POO-2125 rules v1)
 * @analytics-events none, a data adapter
 *
 * The Pools step's data adapter, both modes. The two that matter most here are the ones a screen
 * test cannot reach: that `uniswap-v4` contributes NOTHING in real mode (there is no v4 API yet, and
 * the alternative: quietly serving v3 pools labelled v4: would put a pool in a mandate the
 * contracts cannot hold), and that `tierShare` reproduces the V1 arithmetic exactly, because the
 * same "{pct}% selected" copy is about to appear on a second screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UniswapPool } from "@/lib/schemas";

const services = vi.hoisted(() => ({ mockMode: true }));

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return services.mockMode;
  },
}));

vi.mock("@/features/manager/actions", () => ({
  getDexPoolsAction: vi.fn(),
  getDexPoolByAddressAction: vi.fn(),
}));

import { getDexPoolByAddressAction, getDexPoolsAction } from "@/features/manager/actions";
import { fundPoolFixtures } from "@/mocks/data/fundPools";
import { uniswapPools } from "@/mocks/data/pools";
import type { DexProtocolId, MandatePoolRef } from "./mandateDraft";
import {
  findMandatePoolByAddress,
  mapUniswapPoolToMandatePool,
  searchMandatePools,
  tierShare,
} from "./mandatePoolSource";

/** Arbitrum's real USDC and wrapped-ether addresses, the ones the fixtures and token lists carry. */
const ARB_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const ARB_WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";

/** A mandate that chose both position protocols, which is what most of these cases assume. */
const BOTH_DEX: DexProtocolId[] = ["uniswap-v3", "uniswap-v4"];

const { uniswapV4: fundUniswapV4Pools, robinhoodV3: fundRobinhoodV3Pools } = fundPoolFixtures();

/**
 * Drain a promise that is parked on the mock latency timer. `simulateDelay` schedules a real
 * `setTimeout`, so every mock-mode call has to be advanced rather than awaited directly.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  // The no-op handler is attached BEFORE the timers advance on purpose. The mock-failure case
  // rejects the moment the latency timer fires, which is earlier than the `rejects.toThrow`
  // assertion can attach, and Vitest reports that gap as an unhandled rejection that "might cause
  // false positive tests". Holding a handler across the advance closes the gap; the caller still
  // asserts on the original promise.
  const guarded = promise.catch(() => undefined);
  await vi.runAllTimersAsync();
  await guarded;
  return promise;
}

/** A V1 `UniswapPool` with the fields `mapUniswapPoolToMandatePool` reads. */
function uniswapPool(overrides: Partial<UniswapPool> = {}): UniswapPool {
  return {
    id: "0x1111111111111111111111111111111111111111",
    network: "arbitrum",
    networkName: "Arbitrum",
    token0: "ETH",
    token1: "USDC",
    feeBps: 5,
    tvlUsd: 10_000_000,
    aprPct: 12.5,
    currentPrice: 3050,
    address: "0x1111111111111111111111111111111111111111",
    token0Address: ARB_WETH,
    token1Address: ARB_USDC,
    ...overrides,
  };
}

/** A `MandatePoolRef` for the pure `tierShare` cases. */
function ref(overrides: Partial<MandatePoolRef> = {}): MandatePoolRef {
  return {
    id: "pool-1",
    address: "0x2222222222222222222222222222222222222222",
    network: "arbitrum",
    protocol: "uniswap-v4",
    token0: { address: ARB_WETH, symbol: "ETH", name: "Wrapped Ether", logoUrl: null },
    token1: { address: ARB_USDC, symbol: "USDC", name: "USD Coin", logoUrl: null },
    feeBps: 5,
    feeTier: 500,
    tvlUsd: 1_000_000,
    aprPct: 10,
    tierSharePct: null,
    hasHook: false,
    ...overrides,
  };
}

beforeEach(() => {
  services.mockMode = true;
  vi.useFakeTimers();
  // Deterministic mock behaviour: 0.5 is above the 2% failure probability, so nothing throws, and
  // it puts the latency draw in the middle of the band. The repo's own convention for making
  // `simulateDelay` / a probability draw deterministic (see src/mocks/utils/simulate.test.ts).
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(getDexPoolsAction).mockReset();
  vi.mocked(getDexPoolByAddressAction).mockReset();
});

describe("mapUniswapPoolToMandatePool", () => {
  // @rule R-S5a-11: the V1 pool shape maps onto `MandatePoolRef` without inventing anything.
  it("maps the V1 pool shape onto a mandate pool", () => {
    const mapped = mapUniswapPoolToMandatePool(uniswapPool({ feeTier: 500 }), "uniswap-v3");

    expect(mapped.id).toBe("0x1111111111111111111111111111111111111111");
    expect(mapped.address).toBe("0x1111111111111111111111111111111111111111");
    expect(mapped.network).toBe("arbitrum");
    expect(mapped.protocol).toBe("uniswap-v3");
    expect(mapped.feeBps).toBe(5);
    expect(mapped.feeTier).toBe(500);
    expect(mapped.tvlUsd).toBe(10_000_000);
    expect(mapped.aprPct).toBe(12.5);
    expect(mapped.tierSharePct).toBeNull();
    expect(mapped.hasHook).toBe(false);
  });

  // @rule R-S5a-12: `feeTier` is absent on the V1 mock catalog; derive it from `feeBps` rather than
  // leaving a required field undefined (the schema itself documents this fallback).
  it("derives feeTier from feeBps when the pool omits it", () => {
    const mapped = mapUniswapPoolToMandatePool(uniswapPool({ feeBps: 30 }), "uniswap-v3");
    expect(mapped.feeTier).toBe(3000);
  });

  // @rule R-S5a-13: names and logos come from the token list, so the Pools step can print a token
  // name without a second round trip.
  it("reads symbol, name and logo from the token list", () => {
    const mapped = mapUniswapPoolToMandatePool(uniswapPool(), "uniswap-v4");

    expect(mapped.token0.address).toBe(ARB_WETH);
    expect(mapped.token0.symbol).toBe("ETH");
    expect(mapped.token0.name).toBe("Wrapped Ether");
    expect(mapped.token1.symbol).toBe("USDC");
    expect(mapped.token1.name).toBe("USD Coin");
  });

  it("falls back to the pool's own symbol for a token no list knows", () => {
    const unknown = "0x9999999999999999999999999999999999999999";
    const mapped = mapUniswapPoolToMandatePool(
      uniswapPool({ token0Address: unknown, token0: "MYST" }),
      "uniswap-v3",
    );

    expect(mapped.token0.address).toBe(unknown);
    expect(mapped.token0.symbol).toBe("MYST");
    expect(mapped.token0.name).toBe("MYST");
    expect(mapped.token0.logoUrl).toBeNull();
  });

  it("lowercases token addresses", () => {
    const mapped = mapUniswapPoolToMandatePool(
      uniswapPool({ token0Address: ARB_WETH.toUpperCase().replace("0X", "0x") }),
      "uniswap-v3",
    );
    expect(mapped.token0.address).toBe(ARB_WETH);
  });
});

describe("tierShare", () => {
  // @rule R-S5a-14: the same arithmetic as V1 MandateStep.tsx lines 416-428: a pool's TVL over the
  // pair's total, rounded to an integer percent.
  it("splits a three-tier pair by TVL share, rounded", () => {
    const pools = [
      ref({ id: "a", feeBps: 1, tvlUsd: 500_000 }),
      ref({ id: "b", feeBps: 5, tvlUsd: 300_000 }),
      ref({ id: "c", feeBps: 30, tvlUsd: 200_000 }),
    ];

    const shares = tierShare(pools);

    expect(shares.get("a")).toBe(50);
    expect(shares.get("b")).toBe(30);
    expect(shares.get("c")).toBe(20);
  });

  it("rounds the way V1 rounds", () => {
    const pools = [
      ref({ id: "a", tvlUsd: 1 }),
      ref({ id: "b", tvlUsd: 1 }),
      ref({ id: "c", tvlUsd: 1 }),
    ];

    const shares = tierShare(pools);

    // 1/3 → 33 on every row, exactly as `Math.round((tvl / total) * 100)` gives.
    expect([shares.get("a"), shares.get("b"), shares.get("c")]).toEqual([33, 33, 33]);
  });

  // @rule R-S5a-15: a pair with no liquidity has no share to report. V1 printed 0% here; a mandate
  // row must not claim "0% selected" as a measured figure, so this answers null.
  it("answers null for a pair whose total TVL is zero", () => {
    const pools = [ref({ id: "a", tvlUsd: 0 }), ref({ id: "b", tvlUsd: 0 })];

    const shares = tierShare(pools);

    expect(shares.get("a")).toBeNull();
    expect(shares.get("b")).toBeNull();
  });

  it("groups a pair regardless of which side each token is on", () => {
    const pools = [
      ref({ id: "a", tvlUsd: 750_000 }),
      ref({
        id: "b",
        tvlUsd: 250_000,
        token0: { address: ARB_USDC, symbol: "USDC", name: "USD Coin", logoUrl: null },
        token1: { address: ARB_WETH, symbol: "ETH", name: "Wrapped Ether", logoUrl: null },
      }),
    ];

    const shares = tierShare(pools);

    expect(shares.get("a")).toBe(75);
    expect(shares.get("b")).toBe(25);
  });

  it("keeps networks and protocols apart", () => {
    const pools = [
      ref({ id: "arb-v4", network: "arbitrum", protocol: "uniswap-v4", tvlUsd: 1_000_000 }),
      ref({ id: "arb-v3", network: "arbitrum", protocol: "uniswap-v3", tvlUsd: 4_000_000 }),
      ref({ id: "rbh-v4", network: "robinhood", protocol: "uniswap-v4", tvlUsd: 9_000_000 }),
    ];

    const shares = tierShare(pools);

    // Each pool is alone in its (network, protocol, pair) group, so each one holds all of it.
    expect(shares.get("arb-v4")).toBe(100);
    expect(shares.get("arb-v3")).toBe(100);
    expect(shares.get("rbh-v4")).toBe(100);
  });
});

describe("searchMandatePools, mock mode", () => {
  it("maps the V1 catalog as uniswap-v3 pools", async () => {
    const arbUsdcPool = uniswapPools.find((pool) => pool.id === "arb-eth-usdc-5");
    expect(arbUsdcPool).toBeDefined();

    const found = await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: arbUsdcPool?.token0Address ?? "",
        protocols: ["uniswap-v3"],
      }),
    );

    const hit = found.find((pool) => pool.id === "arb-eth-usdc-5");
    expect(hit).toBeDefined();
    expect(hit?.protocol).toBe("uniswap-v3");
    expect(hit?.hasHook).toBe(false);
    expect(getDexPoolsAction).not.toHaveBeenCalled();
  });

  /**
   * [C1] A hub-only mandate on Uniswap v3 alone has pools in mock mode.
   *
   * The V1 catalog is in this universe and is mapped as `uniswap-v3`, which looked like hub coverage
   * and was not: its mock rows carry SYNTHETIC token addresses, and `searchMock` matches a pool by
   * the REAL address of a mandate token, so no V1 mock row can match one. Arbitrum plus Uniswap v3
   * plus mock mode therefore listed nothing, the Pools step refused Next, and the manager was stuck
   * unless they went back and added Uniswap v4. Mock mode is what design reviews and previews run on.
   */
  it("serves hub Uniswap v3 pools for a mandate holding only the deposit token", async () => {
    const found = await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_USDC,
        protocols: ["uniswap-v3"],
      }),
    );

    expect(found.length).toBeGreaterThan(0);
    for (const pool of found) {
      expect(pool.protocol).toBe("uniswap-v3");
      expect(pool.network).toBe("arbitrum");
      const sides = [pool.token0.address, pool.token1.address];
      expect(sides).toContain(ARB_USDC);
    }
    expect(getDexPoolsAction).not.toHaveBeenCalled();
  });

  it("serves the v4 fixtures, hooks included", async () => {
    const found = await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_WETH,
        protocols: ["uniswap-v4"],
      }),
    );

    expect(found.length).toBeGreaterThan(0);
    for (const pool of found) {
      expect(pool.protocol).toBe("uniswap-v4");
    }
    const hookedFixtures = fundUniswapV4Pools.filter(
      (pool) =>
        pool.hasHook &&
        pool.network === "arbitrum" &&
        (pool.token0.address === ARB_WETH || pool.token1.address === ARB_WETH),
    );
    expect(hookedFixtures.length).toBeGreaterThan(0);
    for (const hooked of hookedFixtures) {
      expect(found.map((pool) => pool.id)).toContain(hooked.id);
    }
  });

  // @rule R-S5a-16: the protocol filter is a filter, not a hint. A mandate without `uniswap-v3`
  // must never be offered a v3 pool.
  it("returns nothing for a protocol list the universe cannot satisfy", async () => {
    const found = await settle(
      searchMandatePools({ network: "arbitrum", tokenAddress: ARB_WETH, protocols: [] }),
    );
    expect(found).toEqual([]);
  });

  it("filters by protocol", async () => {
    const both = await settle(
      searchMandatePools({
        network: "robinhood",
        tokenAddress: fundRobinhoodV3Pools[0]?.token0.address ?? "",
        protocols: ["uniswap-v3", "uniswap-v4"],
      }),
    );
    const v3Only = await settle(
      searchMandatePools({
        network: "robinhood",
        tokenAddress: fundRobinhoodV3Pools[0]?.token0.address ?? "",
        protocols: ["uniswap-v3"],
      }),
    );

    expect(new Set(both.map((pool) => pool.protocol))).toEqual(
      new Set(["uniswap-v3", "uniswap-v4"]),
    );
    expect(new Set(v3Only.map((pool) => pool.protocol))).toEqual(new Set(["uniswap-v3"]));
    expect(v3Only.length).toBeLessThan(both.length);
  });

  // @rule R-S5a-17: one token returns every pool holding it; two tokens return only the pair.
  it("narrows to the pair when a second token is given", async () => {
    const protocols: DexProtocolId[] = ["uniswap-v4"];
    const oneToken = await settle(
      searchMandatePools({ network: "arbitrum", tokenAddress: ARB_WETH, protocols }),
    );
    const pair = await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_WETH,
        secondTokenAddress: ARB_USDC,
        protocols,
      }),
    );

    expect(pair.length).toBeGreaterThan(0);
    expect(pair.length).toBeLessThan(oneToken.length);
    for (const pool of pair) {
      const sides = [pool.token0.address, pool.token1.address];
      expect(sides).toContain(ARB_WETH);
      expect(sides).toContain(ARB_USDC);
    }
  });

  it("matches token addresses case-insensitively", async () => {
    const lower = await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_WETH,
        protocols: ["uniswap-v4"],
      }),
    );
    const upper = await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_WETH.toUpperCase().replace("0X", "0x"),
        protocols: ["uniswap-v4"],
      }),
    );

    expect(upper.map((pool) => pool.id)).toEqual(lower.map((pool) => pool.id));
    expect(upper.length).toBeGreaterThan(0);
  });

  // @rule R-S5a-18: a search is scoped to one network. A mandate pool belongs to the network it was
  // chosen on, and a cross-network result would silently widen the mandate.
  it("scopes results to the requested network", async () => {
    const found = await settle(
      searchMandatePools({
        network: "robinhood",
        tokenAddress: fundRobinhoodV3Pools[0]?.token1.address ?? "",
        protocols: ["uniswap-v3", "uniswap-v4"],
      }),
    );

    expect(found.length).toBeGreaterThan(0);
    for (const pool of found) {
      expect(pool.network).toBe("robinhood");
    }
  });

  // @rule R-S5a-19: TVL descending, so the deepest pool of a pair leads the list.
  it("sorts by TVL, descending", async () => {
    const found = await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_USDC,
        protocols: ["uniswap-v3", "uniswap-v4"],
      }),
    );

    expect(found.length).toBeGreaterThan(1);
    const tvls = found.map((pool) => pool.tvlUsd);
    expect([...tvls].sort((a, b) => b - a)).toEqual(tvls);
  });

  // @rule R-S5a-20: the share is filled on the way out, computed over the pools actually returned.
  it("fills tierSharePct over the returned pools", async () => {
    const found = await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_WETH,
        secondTokenAddress: ARB_USDC,
        protocols: ["uniswap-v4"],
      }),
    );

    expect(found.length).toBeGreaterThanOrEqual(2);
    const total = found.reduce((sum, pool) => sum + pool.tvlUsd, 0);
    for (const pool of found) {
      expect(pool.tierSharePct).toBe(Math.round((pool.tvlUsd / total) * 100));
    }
  });

  it("does not mutate the fixtures while filling the share", async () => {
    await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_WETH,
        protocols: ["uniswap-v4"],
      }),
    );

    for (const pool of fundUniswapV4Pools) {
      expect(pool.tierSharePct).toBeNull();
    }
  });

  // @rule R-S5a-21: the mock goes through the repo's latency helper, so the Pools step has a loading
  // state to render in mock mode too.
  it("waits on the mock latency timer before resolving", async () => {
    const settled = vi.fn();
    const promise = searchMandatePools({
      network: "arbitrum",
      tokenAddress: ARB_WETH,
      protocols: ["uniswap-v4"],
    }).then(settled);

    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(149);
    expect(settled).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await promise;
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("keeps the latency inside 150 to 400 ms", async () => {
    const timer = vi.spyOn(globalThis, "setTimeout");

    await settle(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_WETH,
        protocols: ["uniswap-v4"],
      }),
    );

    const delay = timer.mock.calls[0]?.[1] ?? Number.NaN;
    expect(delay).toBeGreaterThanOrEqual(150);
    expect(delay).toBeLessThanOrEqual(400);
  });

  // @rule R-S5a-22: the mock fails occasionally, and the failure is a thrown error the step turns
  // into its error state. Never swallowed, never an empty list dressed up as success.
  it("throws the mock failure when the draw falls inside the failure rate", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.001);

    await expect(
      settle(
        searchMandatePools({
          network: "arbitrum",
          tokenAddress: ARB_WETH,
          protocols: ["uniswap-v4"],
        }),
      ),
    ).rejects.toThrow("mock: pools unavailable");
  });

  it("does not throw when the draw falls outside the failure rate", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.021);

    await expect(
      settle(
        searchMandatePools({
          network: "arbitrum",
          tokenAddress: ARB_WETH,
          protocols: ["uniswap-v4"],
        }),
      ),
    ).resolves.toBeInstanceOf(Array);
  });
});

describe("findMandatePoolByAddress, mock mode", () => {
  it("resolves a fixture pool by its own address", async () => {
    const target = fundUniswapV4Pools[0];
    expect(target).toBeDefined();

    const { pool, foundOn } = await settle(
      findMandatePoolByAddress(target?.network ?? "arbitrum", target?.address ?? "", BOTH_DEX),
    );

    expect(pool?.id).toBe(target?.id);
    expect(pool?.tierSharePct).toBeNull();
    expect(foundOn).toBeNull();
  });

  it("resolves case-insensitively", async () => {
    const target = fundUniswapV4Pools[0];
    const { pool } = await settle(
      findMandatePoolByAddress(
        target?.network ?? "arbitrum",
        (target?.address ?? "").toUpperCase().replace("0X", "0x"),
        BOTH_DEX,
      ),
    );
    expect(pool?.id).toBe(target?.id);
  });

  // @rule R30 (M5): mode parity with the real `foundOnNetwork`. Mock mode holds the whole universe
  // locally, so it can answer WHERE an address lives in the same breath. Without this the Pools
  // step had to re-ask network by network, and a silent null read as "no such pool".
  it("says which network an address really lives on", async () => {
    const target = fundUniswapV4Pools.find((pool) => pool.network === "arbitrum");

    const { pool, foundOn } = await settle(
      findMandatePoolByAddress("robinhood", target?.address ?? "", BOTH_DEX),
    );

    expect(pool).toBeNull();
    expect(foundOn).toBe("arbitrum");
  });

  it("answers nothing, nowhere, for an unknown address", async () => {
    const located = await settle(
      findMandatePoolByAddress("arbitrum", "0x0000000000000000000000000000000000000dead", BOTH_DEX),
    );
    expect(located).toEqual({ pool: null, foundOn: null });
  });

  /**
   * [B2c] A pasted address cannot offer a pool of a protocol the mandate never named.
   *
   * `addPool` refuses it, so the row could only ever be an Add that fails; worse, an address found
   * this way entered `draft.pools` on the Broad-mandate arithmetic's left side while never being in
   * the universe on its right. The answer is "nowhere" rather than a wrong-network advisory: the
   * pool is not on another network, it is simply not part of this mandate.
   */
  it("does not resolve an address whose protocol the mandate did not choose", async () => {
    const target = fundUniswapV4Pools.find((pool) => pool.network === "arbitrum");
    expect(target).toBeDefined();

    const located = await settle(
      findMandatePoolByAddress(target?.network ?? "arbitrum", target?.address ?? "", [
        "uniswap-v3",
      ]),
    );

    expect(located).toEqual({ pool: null, foundOn: null });
  });
});

describe("searchMandatePools, real mode", () => {
  beforeEach(() => {
    services.mockMode = false;
  });

  it("maps what the dex-pools action returns", async () => {
    vi.mocked(getDexPoolsAction).mockResolvedValue([uniswapPool({ feeTier: 500 })]);

    const found = await searchMandatePools({
      network: "arbitrum",
      tokenAddress: ARB_WETH,
      protocols: ["uniswap-v3"],
    });

    expect(getDexPoolsAction).toHaveBeenCalledWith("arbitrum", ARB_WETH, undefined);
    expect(found).toHaveLength(1);
    expect(found[0]?.protocol).toBe("uniswap-v3");
    expect(found[0]?.feeTier).toBe(500);
    expect(found[0]?.tierSharePct).toBe(100);
  });

  // @rule R32
  it("drops a pool whose fee tier is not a real Uniswap v3 tier", async () => {
    // `/dex-pools` is pair-keyed and `dex` is a free string on the API, so a 0.25% pool of another
    // DEX can come back beside the real tiers. A mandate is fixed at launch: listing it as
    // "Uniswap v3" would let a manager fix a pool the adapter cannot hold.
    vi.mocked(getDexPoolsAction).mockResolvedValue([
      uniswapPool({ id: "0xaaaa", address: "0xaaaa", feeBps: 25 }),
      uniswapPool({ id: "0xbbbb", address: "0xbbbb", feeBps: 30 }),
    ]);

    const found = await searchMandatePools({
      network: "arbitrum",
      tokenAddress: ARB_WETH,
      protocols: ["uniswap-v3"],
    });

    expect(found.map((pool) => pool.feeBps)).toEqual([30]);
  });

  // @rule R32
  it("judges the tier on the raw value, never on the rounded bps", async () => {
    // `feeBps` is a rounded figure (`mapDexPool` rounds `feeTier / 100`), so tier 50 (0.005%) and
    // tier 120 round to 1 bps and tier 2990 rounds to 30, and each would read as a real Uniswap v3
    // tier. Only the raw tier tells them apart from 100 and 3000, and this module cannot count on
    // the action having dropped them: the pair read does not filter in every repository this file
    // ships in.
    vi.mocked(getDexPoolsAction).mockResolvedValue([
      uniswapPool({ id: "0xaaaa", address: "0xaaaa", feeBps: 1, feeTier: 50 }),
      uniswapPool({ id: "0xbbbb", address: "0xbbbb", feeBps: 1, feeTier: 120 }),
      uniswapPool({ id: "0xcccc", address: "0xcccc", feeBps: 30, feeTier: 2990 }),
      uniswapPool({ id: "0xdddd", address: "0xdddd", feeBps: 30, feeTier: 3000 }),
    ]);

    const found = await searchMandatePools({
      network: "arbitrum",
      tokenAddress: ARB_WETH,
      protocols: ["uniswap-v3"],
    });

    expect(found.map((pool) => pool.feeTier)).toEqual([3000]);
  });

  it("passes the second token through to the action", async () => {
    vi.mocked(getDexPoolsAction).mockResolvedValue([]);

    await searchMandatePools({
      network: "arbitrum",
      tokenAddress: ARB_WETH,
      secondTokenAddress: ARB_USDC,
      protocols: ["uniswap-v3"],
    });

    expect(getDexPoolsAction).toHaveBeenCalledWith("arbitrum", ARB_WETH, ARB_USDC);
  });

  // @rule R-S5a-23: there is no Uniswap v4 pool API yet. A v4-only mandate gets an empty list and
  // NOT the v3 catalog relabelled, which would put an unbuildable pool in a mandate.
  it("contributes nothing for uniswap-v4 and makes no call", async () => {
    const found = await searchMandatePools({
      network: "arbitrum",
      tokenAddress: ARB_WETH,
      protocols: ["uniswap-v4"],
    });

    expect(found).toEqual([]);
    expect(getDexPoolsAction).not.toHaveBeenCalled();
  });

  it("serves the v3 half when both protocols are asked for", async () => {
    vi.mocked(getDexPoolsAction).mockResolvedValue([uniswapPool()]);

    const found = await searchMandatePools({
      network: "arbitrum",
      tokenAddress: ARB_WETH,
      protocols: ["uniswap-v3", "uniswap-v4"],
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.protocol).toBe("uniswap-v3");
  });

  it("sorts the action's pools by TVL and fills the share", async () => {
    vi.mocked(getDexPoolsAction).mockResolvedValue([
      uniswapPool({
        id: "small",
        address: "0x3333333333333333333333333333333333333333",
        tvlUsd: 1,
      }),
      uniswapPool({ id: "big", address: "0x4444444444444444444444444444444444444444", tvlUsd: 3 }),
    ]);

    const found = await searchMandatePools({
      network: "arbitrum",
      tokenAddress: ARB_WETH,
      protocols: ["uniswap-v3"],
    });

    expect(found.map((pool) => pool.id)).toEqual(["big", "small"]);
    expect(found[0]?.tierSharePct).toBe(75);
    expect(found[1]?.tierSharePct).toBe(25);
  });

  // @rule R-S5a-24: an error from the action reaches the caller. The step owns the error state.
  it("lets the action's error propagate", async () => {
    vi.mocked(getDexPoolsAction).mockRejectedValue(new Error("dex-pools 500"));

    await expect(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: ARB_WETH,
        protocols: ["uniswap-v3"],
      }),
    ).rejects.toThrow("dex-pools 500");
  });

  it("makes no mock latency call in real mode", async () => {
    vi.mocked(getDexPoolsAction).mockResolvedValue([]);
    const timer = vi.spyOn(globalThis, "setTimeout");

    await searchMandatePools({
      network: "arbitrum",
      tokenAddress: ARB_WETH,
      protocols: ["uniswap-v3"],
    });

    expect(timer).not.toHaveBeenCalled();
  });
});

describe("findMandatePoolByAddress, real mode", () => {
  beforeEach(() => {
    services.mockMode = false;
  });

  it("maps the first pool the address action returns", async () => {
    vi.mocked(getDexPoolByAddressAction).mockResolvedValue({ pools: [uniswapPool()] });

    const { pool, foundOn } = await findMandatePoolByAddress("arbitrum", ARB_WETH, ["uniswap-v3"]);

    expect(getDexPoolByAddressAction).toHaveBeenCalledWith("arbitrum", ARB_WETH);
    expect(pool?.protocol).toBe("uniswap-v3");
    expect(pool?.tierSharePct).toBeNull();
    expect(foundOn).toBeNull();
  });

  // @rule R32
  it("does not offer a pasted pool whose fee tier is not a real Uniswap v3 tier", async () => {
    vi.mocked(getDexPoolByAddressAction).mockResolvedValue({
      pools: [uniswapPool({ feeBps: 25 })],
    });

    await expect(findMandatePoolByAddress("arbitrum", ARB_WETH, ["uniswap-v3"])).resolves.toEqual({
      pool: null,
      foundOn: null,
    });
  });

  // @rule R32
  it("does not offer a pasted pool whose raw tier only ROUNDS to a real one", async () => {
    vi.mocked(getDexPoolByAddressAction).mockResolvedValue({
      pools: [uniswapPool({ feeBps: 30, feeTier: 2990 })],
    });

    await expect(findMandatePoolByAddress("arbitrum", ARB_WETH, ["uniswap-v3"])).resolves.toEqual({
      pool: null,
      foundOn: null,
    });
  });

  it("answers nothing, nowhere, when the address resolves to nothing", async () => {
    vi.mocked(getDexPoolByAddressAction).mockResolvedValue({ pools: [] });

    await expect(findMandatePoolByAddress("arbitrum", ARB_WETH, ["uniswap-v3"])).resolves.toEqual({
      pool: null,
      foundOn: null,
    });
  });

  // @rule R30 (M5): the endpoint already says where a pasted address lives (POO-1430 [R9], the
  // two-key `{ data, foundOnNetwork }` envelope). Discarding it cost one server action per catalog
  // network, including networks the fund contracts do not operate on, where an unknown slug can
  // answer 400 and turn "not on your networks" into the error state.
  it("passes the endpoint's wrong-network answer through, in one call", async () => {
    vi.mocked(getDexPoolByAddressAction).mockResolvedValue({
      pools: [],
      foundOnNetwork: "base",
    });

    const located = await findMandatePoolByAddress("arbitrum", ARB_WETH, ["uniswap-v3"]);

    expect(located).toEqual({ pool: null, foundOn: "base" });
    expect(getDexPoolByAddressAction).toHaveBeenCalledTimes(1);
  });

  // The API's network slug is a free string. A slug outside the mandate's own union has no row in
  // the catalog and no translated name, so it is dropped rather than printed raw at a manager.
  it("drops a network slug the mandate does not model", async () => {
    vi.mocked(getDexPoolByAddressAction).mockResolvedValue({
      pools: [],
      foundOnNetwork: "solana",
    });

    await expect(findMandatePoolByAddress("arbitrum", ARB_WETH, ["uniswap-v3"])).resolves.toEqual({
      pool: null,
      foundOn: null,
    });
  });

  // Defensive: "it is on the network you asked about, and also empty" is not a wrong-network fact.
  it("ignores a wrong-network answer that names the network it was asked about", async () => {
    vi.mocked(getDexPoolByAddressAction).mockResolvedValue({
      pools: [],
      foundOnNetwork: "arbitrum",
    });

    await expect(findMandatePoolByAddress("arbitrum", ARB_WETH, ["uniswap-v3"])).resolves.toEqual({
      pool: null,
      foundOn: null,
    });
  });

  it("lets the address action's error propagate", async () => {
    vi.mocked(getDexPoolByAddressAction).mockRejectedValue(new Error("dex-pools 503"));

    await expect(findMandatePoolByAddress("arbitrum", ARB_WETH, ["uniswap-v3"])).rejects.toThrow(
      "dex-pools 503",
    );
  });

  /**
   * [B2c] `/dex-pools` is a Uniswap v3 endpoint, so a mandate that did not choose v3 has no protocol
   * this read could satisfy: it would answer a v3 pool the mandate cannot hold. The same guard
   * `searchReal` already carries, and it saves one server action per selected network per paste.
   */
  it("does not ask the endpoint at all when the mandate named no Uniswap v3", async () => {
    const located = await findMandatePoolByAddress("arbitrum", ARB_WETH, ["uniswap-v4"]);

    expect(located).toEqual({ pool: null, foundOn: null });
    expect(getDexPoolByAddressAction).not.toHaveBeenCalled();
  });
});
