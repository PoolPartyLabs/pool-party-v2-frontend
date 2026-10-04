/**
 * @id PP-MGR-LIB-025 (POO-2133)
 * @name v2MandateTests
 * @implements-rules-version v1
 * Real-mode capability and provisioning payload regressions.
 */
import { describe, expect, it } from "vitest";
import type { CatalogReserve, CatalogToken } from "@/lib/api/v2/schemas";
import {
  addPool,
  createEmptyDraft,
  depositTokenRefFor,
  isBlocked,
  slotsUsed,
  validateStep,
  withNetworks,
  withProtocols,
} from "./mandateDraft";
import { buildRealCatalog, toV2MandateSelection } from "./v2Mandate";

const usdc = depositTokenRefFor("arbitrum");
const usdg = depositTokenRefFor("robinhood");
if (!usdc || !usdg) throw new Error("missing base token fixtures");
const token = (ref: typeof usdc): CatalogToken => ({
  protocolVersion: "v2",
  chainId: ref.network === "arbitrum" ? "42161" : "4663",
  address: ref.address,
  symbol: ref.symbol,
  name: ref.name,
  decimals: 6,
  logoUrl: null,
  hubPriced: true,
  priceUsd: "1",
  priceUpdatedAt: null,
  priceSource: ref.address,
  priceProvenance: "fixed-1:1",
  priceUnavailableReason: null,
});
const reserve: CatalogReserve = {
  protocolVersion: "v2",
  chainId: "42161",
  adapterKind: "aave-v3",
  mode: "supply",
  token: token(usdc),
  poolKey: `0x${usdc.address.slice(2).padStart(64, "0")}`,
  poolAddress: usdc.address,
  dataProviderAddress: usdc.address,
  aTokenAddress: usdc.address,
  supplyApy: "3.22",
  supplyRateRay: "1",
  supplyCap: "0",
  currentSupply: { protocolVersion: "v2", raw: "1", decimal: "0.000001" },
  active: true,
  frozen: false,
  paused: false,
  supplyCapReached: false,
  available: true,
  mandateRequired: true,
};
const catalog = () => buildRealCatalog([token(usdc), token(usdg)], [reserve]);
const draft = () => ({
  ...createEmptyDraft("2026-10-03", "real"),
  dataMode: "real" as const,
  catalogVersion: "v2-catalog-v1" as const,
});

describe("real Mandate", () => {
  // @rule R3
  it("offers only v4 positions and available hub Aave, with v3 positions coming soon", () => {
    const real = catalog();
    expect(real.protocols.find((entry) => entry.id === "uniswap-v3")?.available).toBe(false);
    expect(real.protocols.find((entry) => entry.id === "aave-v3")?.availableOn).toEqual([
      "arbitrum",
    ]);
    expect(
      buildRealCatalog([token(usdc)], [{ ...reserve, available: false }]).protocols.find(
        (entry) => entry.id === "aave-v3",
      )?.available,
    ).toBe(false);
  });

  // @rule R3
  it("keeps Across only with Robinhood and refuses v3 positions in real reducers", () => {
    const hub = withProtocols(draft(), ["aave-v3", "uniswap-v3"]);
    expect(hub.protocols).toEqual(["uniswap-v3-swap", "aave-v3"]);
    const spoke = withNetworks(hub, ["arbitrum", "robinhood"], catalog());
    expect(spoke.protocols).toContain("across");
    expect(withNetworks(spoke, ["arbitrum"], catalog()).protocols).not.toContain("across");
  });

  // @rule R4
  it("counts chain-address entries including both locked base tokens", () => {
    const twoChains = withNetworks(draft(), ["arbitrum", "robinhood"], catalog());
    expect(slotsUsed(twoChains)).toBe(2);
    expect(twoChains.tokens.map((entry) => entry.symbol)).toEqual(["USDC", "USDG"]);
  });

  // @rule R7
  it("serializes Aave-only hub selection without allocation-aid limits", () => {
    const current = withProtocols(draft(), ["aave-v3"]);
    current.caps.protocols["aave-v3"] = { noCap: false, pct: 20 };
    expect(toV2MandateSelection(current, catalog())).toEqual({
      chains: [{ chainId: 42161, tokens: [usdc.address], uniswapV4PoolIds: [] }],
      aaveV3Reserves: [usdc.address],
      spokeCapPercent: null,
    });
  });

  // @rule R6
  it("requires one pool on each selected v4 chain and one position overall", () => {
    expect(() => toV2MandateSelection(withProtocols(draft(), ["uniswap-v4"]), catalog())).toThrow();
    expect(() => toV2MandateSelection(draft(), catalog())).toThrow();
  });

  // @rule R8
  it("refuses stale/mock provenance, missing catalog tokens and unavailable Aave", () => {
    expect(() => toV2MandateSelection(createEmptyDraft("2026-10-03", "old"), catalog())).toThrow();
    const current = withProtocols(draft(), ["aave-v3"]);
    expect(() => toV2MandateSelection(current, buildRealCatalog([], [reserve]))).toThrow();
    expect(() =>
      toV2MandateSelection(
        current,
        buildRealCatalog([token(usdc)], [{ ...reserve, available: false }]),
      ),
    ).toThrow();
  });
  // @rule R6
  it("blocks unsupported tokens and unavailable Aave before advancing the steps", () => {
    const current = withProtocols(draft(), ["aave-v3"]);
    expect(
      validateStep(
        current,
        "protocols",
        buildRealCatalog([token(usdc)], [{ ...reserve, available: false }]),
      ),
    ).not.toBeNull();
    expect(validateStep({ ...current, tokens: [] }, "tokens", catalog())).not.toBeNull();
  });
  // @rule R4
  it("atomically adds a catalog pool and its missing currency and serializes only PoolIds", () => {
    const weth = {
      ...token(usdc),
      address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
    };
    const real = buildRealCatalog([token(usdc), weth], [reserve]);
    const poolId = `0x${"ab".repeat(32)}`;
    const pool = {
      id: `42161:${poolId}`,
      address: poolId,
      poolId,
      poolKey: {
        currency0: weth.address,
        currency1: usdc.address,
        fee: 500,
        tickSpacing: 10,
        hooks: `0x${"00".repeat(20)}`,
      },
      network: "arbitrum" as const,
      protocol: "uniswap-v4" as const,
      token0: { address: weth.address, symbol: weth.symbol, name: weth.name, logoUrl: null },
      token1: usdc,
      feeBps: 5,
      feeTier: 500,
      tvlUsd: null,
      aprPct: null,
      tierSharePct: null,
      hasHook: false,
    };
    const result = addPool(withProtocols(draft(), ["uniswap-v4"]), pool, real);
    expect(isBlocked(result)).toBe(false);
    const absent = buildRealCatalog([token(usdc)], [reserve]);
    expect(isBlocked(addPool(withProtocols(draft(), ["uniswap-v4"]), pool, absent))).toBe(true);
    if (isBlocked(result)) throw new Error("unexpected refusal");
    expect(result.tokens).toHaveLength(2);
    expect(toV2MandateSelection(result, real).chains[0]?.uniswapV4PoolIds).toEqual([poolId]);
    expect(() => toV2MandateSelection({ ...result, pools: [pool, pool] }, real)).toThrow();
    expect(() =>
      toV2MandateSelection(
        { ...result, pools: [{ ...pool, poolKey: { ...pool.poolKey, tickSpacing: 0 } }] },
        real,
      ),
    ).toThrow();
    expect(() =>
      toV2MandateSelection(
        { ...result, positionProtocolsByChain: JSON.parse('{"arbitrum":["uniswap-v3"]}') },
        real,
      ),
    ).toThrow();
  });
});
