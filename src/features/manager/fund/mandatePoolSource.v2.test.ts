/**
 * @id PP-MGR-LIB-020 (POO-2133)
 * @name v2PoolSourceTests
 * @implements-rules-version v1
 * Real catalog replaces legacy v3 pool reads without inventing metrics.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findMandatePoolByAddress, searchMandatePools } from "./mandatePoolSource";

const mocks = vi.hoisted(() => ({ list: vi.fn(), lookup: vi.fn(), legacy: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogPoolsAction: mocks.list,
  getCatalogPoolAction: mocks.lookup,
}));
vi.mock("@/features/manager/actions", () => ({
  getDexPoolsAction: mocks.legacy,
  getDexPoolByAddressAction: mocks.legacy,
}));
const poolId = `0x${"ab".repeat(32)}`;
const currency0 = `0x${"11".repeat(20)}`;
const currency1 = `0x${"22".repeat(20)}`;
const pool = {
  protocolVersion: "v2",
  chainId: "42161",
  poolId,
  poolKey: {
    protocolVersion: "v2",
    currency0,
    currency1,
    fee: 500,
    tickSpacing: 10,
    hooks: `0x${"00".repeat(20)}`,
  },
  tokens: [
    { address: currency0, symbol: "USDC", name: "USD Coin", logoUrl: "logo0", hubPriced: true },
    {
      address: currency1,
      symbol: "WETH",
      name: "Wrapped Ether",
      logoUrl: "logo1",
      hubPriced: true,
    },
  ],
  eligible: true,
  hooked: false,
  liquidity: "100",
  tvlUsd: null,
  feesApr: null,
};
describe("v2 pool source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  // @rule R5
  it("searches v4 catalog with pair filters and preserves null metrics, keys and logos", async () => {
    mocks.list.mockResolvedValue({ ok: true, data: { pools: [pool] } });
    const found = await searchMandatePools({
      network: "arbitrum",
      tokenAddress: currency0,
      secondTokenAddress: currency1,
      protocols: ["uniswap-v4"],
    });
    expect(mocks.list).toHaveBeenCalledWith(42161, {
      tokenAddress: currency0,
      secondTokenAddress: currency1,
    });
    expect(found[0]).toMatchObject({
      poolId,
      poolKey: pool.poolKey,
      tvlUsd: null,
      aprPct: null,
      tierSharePct: null,
      feeBps: 5,
      token0: { logoUrl: "logo0" },
    });
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  // @rule R3
  it("never lists v3 position pools in real mode", async () => {
    await expect(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: currency0,
        protocols: ["uniswap-v3"],
      }),
    ).resolves.toEqual([]);
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  // @rule R5
  it("refuses hooked, native, unpriced and ineligible catalog rows", async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      data: {
        pools: [
          { ...pool, hooked: true },
          { ...pool, eligible: false },
          { ...pool, poolKey: { ...pool.poolKey, currency0: `0x${"00".repeat(20)}` } },
        ],
      },
    });
    await expect(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: currency0,
        protocols: ["uniswap-v4"],
      }),
    ).resolves.toEqual([]);
  });
  // @rule R5
  it("looks up PoolId on the chosen chain and reports the other supported chain after a 404", async () => {
    mocks.lookup
      .mockResolvedValueOnce({ ok: false, error: { status: 404, code: "V2_NOT_FOUND" } })
      .mockResolvedValueOnce({ ok: true, data: { ...pool, chainId: "4663" } });
    await expect(findMandatePoolByAddress("arbitrum", poolId, ["uniswap-v4"])).resolves.toEqual({
      pool: null,
      foundOn: "robinhood",
    });
    expect(mocks.lookup).toHaveBeenNthCalledWith(1, 42161, poolId);
    expect(mocks.lookup).toHaveBeenNthCalledWith(2, 4663, poolId);
  });
  // @rule R2
  it("propagates a dormant API as an error, not an empty result", async () => {
    mocks.list.mockResolvedValue({ ok: false, error: { status: 503, code: "V2_UNAVAILABLE" } });
    await expect(
      searchMandatePools({
        network: "arbitrum",
        tokenAddress: currency0,
        protocols: ["uniswap-v4"],
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
