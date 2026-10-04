/**
 * @id PP-CORE-LIB-114 (POO-2133)
 * @name v2CatalogContractTests
 * @implements-rules-version v1
 * Typed route filters and catalog shape validation without dev-host access.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCatalogPool,
  getCatalogPools,
  getCatalogReserves,
  getCatalogTokens,
  getFundLimits,
  getFunds,
} from "./catalog";
import {
  catalogPoolSchema,
  catalogReserveSchema,
  catalogTokenSchema,
  fundDetailSchema,
} from "./schemas";

const mocked = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./client", () => ({ v2Fetch: mocked.fetch }));
const address = `0x${"11".repeat(20)}`;
const other = `0x${"22".repeat(20)}`;
const poolId = `0x${"ab".repeat(32)}`;
const token = {
  protocolVersion: "v2",
  chainId: "42161",
  address,
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  logoUrl: null,
  hubPriced: true,
  priceUsd: "1",
  priceUpdatedAt: null,
  priceSource: address,
  priceProvenance: "fixed-1:1",
  priceUnavailableReason: null,
};
describe("v2 catalog contracts", () => {
  // @rule R7
  it("reads percentage intent and immutable spoke caps from detail, not an invented route", async () => {
    mocked.fetch.mockResolvedValue({
      mandate: { spokes: [{ spokeCap: "100000000" }] },
      profile: { spokeCapPercent: 50 },
    });
    await expect(getFundLimits(address)).resolves.toMatchObject({
      spokeCapPercent: 50,
      spokeCapEnforcedOnChain: false,
    });
    expect(mocked.fetch).toHaveBeenLastCalledWith(`/funds/${address}`, expect.anything());
    mocked.fetch.mockResolvedValue({ mandate: { spokes: [] }, profile: null });
    await expect(getFundLimits(address)).resolves.toMatchObject({ spokeCapPercent: null });
  });
  // @rule R2
  it("accepts the numeric fund-state enum from the authoritative example", () => {
    expect(fundDetailSchema.shape.fundState.safeParse(0).success).toBe(true);
    expect(fundDetailSchema.shape.fundState.safeParse("0").success).toBe(false);
  });
  beforeEach(() => mocked.fetch.mockReset());
  // @rule R2
  it("uses only catalog routes with validated selected chain and unordered pair filters", async () => {
    await getCatalogTokens(42161, { symbol: "WETH" });
    expect(mocked.fetch).toHaveBeenLastCalledWith(
      "/catalog/tokens?chainId=42161&symbol=WETH",
      expect.anything(),
    );
    await getCatalogPools(4663, { tokenAddress: address, secondTokenAddress: other });
    expect(mocked.fetch).toHaveBeenLastCalledWith(
      `/catalog/uniswap-v4/pools?chainId=4663&tokenAddress=${address}&secondTokenAddress=${other}`,
      expect.anything(),
    );
    await getCatalogPool(42161, poolId);
    expect(mocked.fetch).toHaveBeenLastCalledWith(
      `/catalog/uniswap-v4/pools/${poolId}?chainId=42161`,
      expect.anything(),
    );
    await getCatalogReserves();
    expect(mocked.fetch).toHaveBeenLastCalledWith("/catalog/aave-v3/reserves", expect.anything());
    await getFunds();
    expect(mocked.fetch).toHaveBeenLastCalledWith("/funds", expect.anything());
  });
  // @rule R5
  it("rejects address-shaped PoolIds and a second token without its first", () => {
    expect(() => getCatalogPool(42161, address)).toThrow();
    expect(() => getCatalogPools(42161, { secondTokenAddress: other })).toThrow();
    expect(mocked.fetch).not.toHaveBeenCalled();
  });
  // @rule R2
  it("validates every catalog response and preserves unavailable pricing and metrics", () => {
    expect(catalogTokenSchema.parse({ ...token, priceUsd: null }).priceUsd).toBeNull();
    expect(catalogTokenSchema.safeParse({ ...token, decimals: "6" }).success).toBe(false);
    const pool = {
      protocolVersion: "v2",
      chainId: "42161",
      adapterKind: "uniswap-v4",
      poolId,
      poolKey: {
        protocolVersion: "v2",
        currency0: address,
        currency1: other,
        fee: 500,
        tickSpacing: 10,
        hooks: `0x${"00".repeat(20)}`,
      },
      tokens: [token, { ...token, address: other }],
      pairSymbols: ["USDC", "WETH"],
      hooked: false,
      currentTick: 1,
      sqrtPriceX96: "1",
      currentPrice: { protocolVersion: "v2", token1PerToken0: "1", token0PerToken1: "1" },
      liquidity: "1",
      eligible: true,
      registration: "at-fund-creation",
      tvlUsd: null,
      feesApr: null,
      tvlUnavailableReason: "not indexed",
      feesAprUnavailableReason: "not indexed",
    };
    expect(catalogPoolSchema.parse(pool).tvlUsd).toBeNull();
    expect(catalogPoolSchema.safeParse({ ...pool, poolId: address }).success).toBe(false);
    expect(catalogReserveSchema.safeParse({ protocolVersion: "v2", chainId: "4663" }).success).toBe(
      false,
    );
  });
});
