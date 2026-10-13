/**
 * @id PP-MGR-LIB-078-TEST
 * @name chartContext tests
 * @description Build and Manage selection to the exact DEX Screener pool or asset chart.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8674-15508
 * @linear https://linear.app/yeildbay/issue/POO-2338
 * @implements-rules-version v1 (POO-2338)
 * @analytics-events none, pure context tests.
 *
 * Pool addresses are synthetic fixtures. The tests never fetch DEX Screener.
 */
import { describe, expect, it } from "vitest";
import { getWrappedNative } from "@/lib/chains/config";
import type { DexPool } from "@/lib/manager/dexPoolsSchema";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning/types";
import { mockFund } from "@/mocks/data/v2Funds";
import { mapDexPool } from "../../mapDexPool";
import type { PanelDraftTarget } from "../build/panel/usePanelDraft";
import { makeTestDraft, TEST_ASSET_KEYS, TEST_POOL_IDS } from "../build/plan/planTestKit";
import { type ManagePosition, normalizeManageModel } from "../manage/manageModel";
import type { MandateDraft, MandatePoolRef } from "../mandateDraft";
import { mapUniswapPoolToMandatePool } from "../mandatePoolSource";
import { SOLANA_LOCAL_CONFIGS } from "../solana-preview/solanaBuilderRuntime";
import { USDC_MINT, WSOL_MINT } from "../solana-preview/solanaSchemas";
import { buildChartSelection, type ChartSelection, manageChartSelection } from "./chartContext";
import { buildChartUrl } from "./chartModel";

const V4_POOL_ID = `0x${"d4".repeat(32)}`;
const V3_POOL = `0x${"c3".repeat(20)}`;
const QUERY =
  "embed=1&theme=dark&trades=0&chartLeftToolbar=1&chartTheme=dark&chartStyle=1&chartType=usd&interval=60";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}
function urlOf(selection: ChartSelection): string {
  const { availability } = selection;
  if (availability.status !== "available") throw new Error(`Unavailable: ${availability.reason}`);
  return buildChartUrl(availability.market);
}

const unavailable = (reason: string) => ({ status: "unavailable", reason });
function target(
  kind: PanelDraftTarget["kind"] = "uniswapV4Pool",
  network: PanelDraftTarget["network"] = "arbitrum",
): PanelDraftTarget {
  return {
    blockId: "selected-block",
    kind,
    network,
    applied: { config: { poolId: "applied-other-pool" }, sharePct: 25 },
  };
}
/** A real-mode v4 row, as `mapV2Pool` writes it: id `<chainId>:<poolId>`, address = PoolId. */
function realV4Draft(): MandateDraft {
  const draft = makeTestDraft();
  const mock = required(draft.pools.find((pool) => pool.network === "arbitrum"));
  const real: MandatePoolRef = {
    ...mock,
    id: `42161:${V4_POOL_ID}`,
    poolId: V4_POOL_ID,
    address: V4_POOL_ID,
  };
  return { ...draft, pools: [real, ...draft.pools.filter((pool) => pool !== mock)] };
}
/** A real v3 row, as the dex mapper writes it: id = address = the pool contract. */
function realV3Draft(): MandateDraft {
  const draft = makeTestDraft();
  const mock = required(draft.pools.find((pool) => pool.network === "arbitrum"));
  const real: MandatePoolRef = {
    ...mock,
    id: V3_POOL,
    poolId: undefined,
    address: V3_POOL,
    protocol: "uniswap-v3",
  };
  return { ...draft, pools: [real, ...draft.pools.filter((pool) => pool !== mock)] };
}
function position(): ManagePosition {
  const base = normalizeManageModel(mockFund).positions.find((item) => item.kind === "liquidity");
  if (!base) throw new Error("Expected liquidity fixture");
  const tokens = makeTestDraft().tokens.filter((token) => token.network === "arbitrum");
  return {
    ...base,
    id: "position-a",
    core: "core-a",
    poolId: V4_POOL_ID,
    chainId: 42161,
    network: "arbitrum",
    tokens: tokens.map((token) => ({
      chainId: 42161,
      address: token.address,
      symbol: token.symbol,
      decimals: 18,
      amount: { status: "unavailable", reason: "irrelevant" },
    })),
  };
}
function supplyPosition(address: string | null): ManagePosition {
  const current = position();
  const usdc = required(current.tokens.find((token) => token.symbol === "USDC"));
  return {
    ...current,
    kind: "supply",
    poolId: null,
    source: { ...current.source, adapterKind: "aave-v3" },
    tokens: [{ ...usdc, address }],
  };
}

describe("Build chart context", () => {
  // @rule R2
  it("opens the bare PoolId of a real Uniswap v4 row, from the unapplied panel config", () => {
    const result = buildChartSelection(realV4Draft(), target(), { poolId: V4_POOL_ID });
    expect(result.availability).toMatchObject({
      status: "available",
      market: { kind: "pool", chain: "arbitrum", address: V4_POOL_ID, venue: "Uniswap v4" },
    });
    expect(urlOf(result)).toBe(`https://dexscreener.com/arbitrum/${V4_POOL_ID}?${QUERY}`);
    expect(result.identity).not.toContain("applied-other-pool");
  });

  // @rule R2
  it("opens the pool contract of a real Uniswap v3 row", () => {
    const result = buildChartSelection(realV3Draft(), target("uniswapV3Pool"), {
      poolId: V3_POOL,
    });
    expect(urlOf(result)).toBe(`https://dexscreener.com/arbitrum/${V3_POOL}?${QUERY}`);
  });

  // @rule R2
  it("opens the pool contract of a v3 row that the real dex mappers write", () => {
    const draft = makeTestDraft();
    const [weth, usdc] = ["WETH", "USDC"].map((symbol) =>
      required(
        draft.tokens.find((token) => token.network === "arbitrum" && token.symbol === symbol),
      ),
    );
    const dexPool: DexPool = {
      address: V3_POOL,
      feeTier: 500,
      tvlInUsd: "1000000",
      baseTokenPriceQuoteToken: "1737.58",
      currency0: { address: required(weth).address, symbol: "WETH" },
      currency1: { address: required(usdc).address, symbol: "USDC" },
    };
    const row = mapUniswapPoolToMandatePool(mapDexPool(dexPool, "arbitrum"), "uniswap-v3");
    const result = buildChartSelection(
      { ...draft, pools: [row, ...draft.pools] },
      target("uniswapV3Pool"),
      { poolId: row.id },
    );
    expect(result.availability).toMatchObject({
      status: "available",
      market: { kind: "pool", chain: "arbitrum", address: V3_POOL, venue: "Uniswap v3" },
    });
  });

  // @rule R2
  it("labels the pool with its two token symbols", () => {
    const result = buildChartSelection(realV4Draft(), target(), { poolId: V4_POOL_ID });
    expect(result.availability).toMatchObject({ market: { label: "WETH / USDC" } });
  });

  // @rule R5
  it("keeps a mock pool with no real address or PoolId unconfigured", () => {
    expect(
      buildChartSelection(makeTestDraft(), target(), { poolId: TEST_POOL_IDS.arbitrum })
        .availability,
    ).toEqual(unavailable("unconfigured"));
    const slugV3 = realV3Draft();
    required(slugV3.pools[0]).id = "arb-weth-usdc-5";
    expect(
      buildChartSelection(slugV3, target("uniswapV3Pool"), { poolId: "arb-weth-usdc-5" })
        .availability,
    ).toEqual(unavailable("unconfigured"));
  });

  // @rule R5
  it("distinguishes no selection, no config and unknown pool", () => {
    expect(buildChartSelection(makeTestDraft(), null, null)).toEqual({
      identity: null,
      availability: unavailable("no_selection"),
    });
    expect(buildChartSelection(makeTestDraft(), target(), null).availability).toEqual(
      unavailable("unconfigured"),
    );
    expect(
      buildChartSelection(makeTestDraft(), target(), { poolId: "unknown" }).availability,
    ).toEqual(unavailable("unconfigured"));
  });

  // @rule R5
  it("rejects a pool row of the wrong protocol or on Solana", () => {
    const wrongProtocol = realV4Draft();
    required(wrongProtocol.pools[0]).protocol = "uniswap-v3";
    expect(
      buildChartSelection(wrongProtocol, target(), { poolId: V4_POOL_ID }).availability,
    ).toEqual(unavailable("unsupported_pair"));
    const solana = realV4Draft();
    required(solana.pools[0]).network = "solana";
    expect(
      buildChartSelection(solana, target("uniswapV4Pool", "solana"), { poolId: V4_POOL_ID })
        .availability,
    ).toEqual(unavailable("unsupported_pair"));
  });

  // @rule R3
  it("opens the token chart of the Aave Supply and Aave Borrow asset", () => {
    for (const kind of ["aaveSupply", "aaveBorrow"] as const) {
      const result = buildChartSelection(makeTestDraft(), target(kind), {
        assetKey: TEST_ASSET_KEYS.usdcArbitrum,
      });
      const address = TEST_ASSET_KEYS.usdcArbitrum.split(":")[1];
      expect(result.availability, kind).toMatchObject({
        status: "available",
        market: { kind: "token", chain: "arbitrum", label: "USDC", venue: "Arbitrum" },
      });
      expect(urlOf(result), kind).toBe(`https://dexscreener.com/arbitrum/${address}?${QUERY}`);
    }
  });

  // @rule R3
  it("uses the wrapped native address for a native Aave asset", () => {
    const draft = makeTestDraft();
    draft.tokens.push({
      address: NATIVE_TOKEN_ADDRESS,
      symbol: "ETH",
      name: "Ether",
      network: "arbitrum",
      logoUrl: null,
      locked: false,
    });
    const result = buildChartSelection(draft, target("aaveSupply"), {
      assetKey: `arbitrum:${NATIVE_TOKEN_ADDRESS}`,
    });
    expect(urlOf(result)).toBe(
      `https://dexscreener.com/arbitrum/${getWrappedNative("arbitrum")?.toLowerCase()}?${QUERY}`,
    );
  });

  // @rule R5
  it("keeps an Aave block with no asset, or an asset not in the mandate, unconfigured", () => {
    expect(buildChartSelection(makeTestDraft(), target("aaveSupply"), null).availability).toEqual(
      unavailable("unconfigured"),
    );
    expect(
      buildChartSelection(makeTestDraft(), target("aaveSupply"), {
        assetKey: `arbitrum:0x${"e5".repeat(20)}`,
      }).availability,
    ).toEqual(unavailable("unconfigured"));
  });

  // @rule R3
  it("opens the USDC mint chart for the Kamino Supply block", () => {
    const config = required(SOLANA_LOCAL_CONFIGS.solanaKaminoSupply);
    const result = buildChartSelection(
      makeTestDraft(),
      target("solanaKaminoSupply", "solana"),
      config,
    );
    expect(urlOf(result)).toBe(`https://dexscreener.com/solana/${USDC_MINT}?${QUERY}`);
    expect(
      buildChartSelection(makeTestDraft(), target("solanaKaminoSupply", "solana"), null)
        .availability,
    ).toEqual(unavailable("unconfigured"));
    expect(
      buildChartSelection(makeTestDraft(), target("solanaKaminoSupply", "solana"), {
        ...config,
        catalogId: "other",
      }).availability,
    ).toEqual(unavailable("unsupported_pair"));
  });

  // @rule R5
  it("opens the SOL (WSOL) mint chart for a Kamino block that holds SOL (POO-2351 R5)", () => {
    const config = required(SOLANA_LOCAL_CONFIGS.solanaKaminoSupply);
    const sol = { ...config, pair: "SOL / USDC" as const, token: "SOL" as const };
    expect(
      urlOf(buildChartSelection(makeTestDraft(), target("solanaKaminoSupply", "solana"), sol)),
    ).toBe(`https://dexscreener.com/solana/${WSOL_MINT}?${QUERY}`);
    // An older block with no token reads its pair: "SOL / USDC" is SOL, "USDC / SOL" is USDC.
    const older = { catalogId: config.catalogId, pair: "SOL / USDC" as const };
    expect(
      urlOf(buildChartSelection(makeTestDraft(), target("solanaKaminoSupply", "solana"), older)),
    ).toBe(`https://dexscreener.com/solana/${WSOL_MINT}?${QUERY}`);
  });

  // @rule R5
  it("keeps solanaOrcaPool an unsupported pair, with no canonical pool address", () => {
    const config = required(SOLANA_LOCAL_CONFIGS.solanaOrcaPool);
    expect(
      buildChartSelection(makeTestDraft(), target("solanaOrcaPool", "solana"), config).availability,
    ).toEqual(unavailable("unsupported_pair"));
    expect(
      buildChartSelection(makeTestDraft(), target("solanaOrcaPool", "solana"), null).availability,
    ).toEqual(unavailable("unconfigured"));
  });

  // @rule R5
  it("keeps a solanaRaydiumPool with no config unconfigured (the pool chart is POO-2343 R8)", () => {
    expect(
      buildChartSelection(makeTestDraft(), target("solanaRaydiumPool", "solana"), null)
        .availability,
    ).toEqual(unavailable("unconfigured"));
  });

  // @rule R5
  it.each([
    "swap",
    "solanaHolding",
    "pendle",
    "gmxPerp",
    "spoke",
  ] as const)("keeps %s an unsupported block", (kind) => {
    expect(buildChartSelection(makeTestDraft(), target(kind), null).availability).toEqual(
      unavailable("unsupported_block"),
    );
  });

  // @rule R6
  it("keeps the identity across ticks, slippage and allocation, and changes it for draft, block or pool", () => {
    const draft = realV4Draft();
    const selected = target();
    const config = { poolId: V4_POOL_ID, tickLower: -10, tickUpper: 10, slippagePct: 1 };
    const identity = buildChartSelection(draft, selected, config).identity;
    expect(
      buildChartSelection(
        draft,
        { ...selected, applied: { ...selected.applied, sharePct: 80 } },
        { ...config, tickLower: -100, tickUpper: 100, slippagePct: 2, displayInverted: true },
      ).identity,
    ).toBe(identity);
    expect(
      buildChartSelection({ ...draft, id: "another-draft" }, selected, config).identity,
    ).not.toBe(identity);
    expect(
      buildChartSelection(draft, { ...selected, blockId: "another-block" }, config).identity,
    ).not.toBe(identity);
    expect(
      buildChartSelection(draft, selected, { ...config, poolId: TEST_POOL_IDS.arbitrum }).identity,
    ).not.toBe(identity);
  });
});

describe("Manage chart context", () => {
  // @rule R2
  it("opens the exact pool of a liquidity position from its poolId and chainId", () => {
    const result = manageChartSelection(position());
    expect(result.availability).toMatchObject({
      status: "available",
      market: { kind: "pool", chain: "arbitrum", address: V4_POOL_ID, venue: "Uniswap v4" },
    });
  });

  // @rule R2
  it("opens the pool contract of a Uniswap v3 liquidity position", () => {
    const current = position();
    const v3 = {
      ...current,
      poolId: V3_POOL,
      source: { ...current.source, adapterKind: "uniswap-v3" },
    };
    expect(manageChartSelection(v3).availability).toMatchObject({
      status: "available",
      market: { kind: "pool", chain: "arbitrum", address: V3_POOL, venue: "Uniswap v3" },
    });
    expect(urlOf(manageChartSelection(v3))).toBe(
      `https://dexscreener.com/arbitrum/${V3_POOL}?${QUERY}`,
    );
  });

  // @rule R3
  it("opens the token chart of a supply position", () => {
    const usdc = TEST_ASSET_KEYS.usdcArbitrum.split(":")[1] ?? "";
    expect(urlOf(manageChartSelection(supplyPosition(usdc)))).toBe(
      `https://dexscreener.com/arbitrum/${usdc}?${QUERY}`,
    );
  });

  // @rule R5
  it("keeps unsupported, incomplete and mismatched positions unavailable", () => {
    expect(manageChartSelection(null)).toEqual({
      identity: null,
      availability: unavailable("no_selection"),
    });
    expect(manageChartSelection({ ...position(), kind: "unsupported" }).availability).toEqual(
      unavailable("unsupported_block"),
    );
    expect(manageChartSelection({ ...position(), poolId: null }).availability).toEqual(
      unavailable("unconfigured"),
    );
    expect(manageChartSelection({ ...position(), poolId: "pool-a" }).availability).toEqual(
      unavailable("unconfigured"),
    );
    expect(manageChartSelection(supplyPosition(null)).availability).toEqual(
      unavailable("unconfigured"),
    );
    expect(manageChartSelection({ ...position(), network: "base" }).availability).toEqual(
      unavailable("unsupported_pair"),
    );
    const current = position();
    expect(
      manageChartSelection({
        ...current,
        tokens: [{ ...required(current.tokens[0]), chainId: 8453 }, required(current.tokens[1])],
      }).availability,
    ).toEqual(unavailable("unsupported_pair"));
  });

  // @rule R6
  it("keeps the identity through financial reads and isolates owner, position and pool", () => {
    const current = position();
    const identity = manageChartSelection(current).identity;
    expect(
      manageChartSelection({
        ...current,
        valueUsd: { status: "available", value: "98765", source: "read" },
      }).identity,
    ).toBe(identity);
    for (const patch of [{ core: "core-b" }, { id: "position-b" }, { poolId: "pool-b" }])
      expect(manageChartSelection({ ...current, ...patch }).identity).not.toBe(identity);
  });
});

describe("Build and Manage parity", () => {
  // @rule R6
  it("gives the same URL for the same v4 pool in Build and in Manage", () => {
    const build = buildChartSelection(realV4Draft(), target(), { poolId: V4_POOL_ID });
    const manage = manageChartSelection(position());
    expect(urlOf(build)).toBe(urlOf(manage));
  });

  // @rule R6
  it("gives the same URL for the same Aave asset in Build and in Manage", () => {
    const build = buildChartSelection(makeTestDraft(), target("aaveSupply"), {
      assetKey: TEST_ASSET_KEYS.usdcArbitrum,
    });
    const usdc = TEST_ASSET_KEYS.usdcArbitrum.split(":")[1] ?? "";
    const manage = manageChartSelection(supplyPosition(usdc.toUpperCase().replace("0X", "0x")));
    expect(urlOf(build)).toBe(urlOf(manage));
  });
});
