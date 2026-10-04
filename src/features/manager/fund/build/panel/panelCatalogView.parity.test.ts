/**
 * @id PP-MGR-LIB-031
 * @name panelCatalogView parity tests
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks)
 *
 * The panel view re-checks what the Mandate step already decides, in a pure module of its own, so
 * these tests pin that the two never drift:
 *   [R3] a pool the real pool search accepts (`eligiblePool`) is `eligible` with active liquidity
 *        here, and every pool it refuses is not
 *   [R4] a draft row built by `mapV2Pool` and the live view of the same catalog pool carry the SAME
 *        bare PoolId, so `Use` writes what the live read accepts
 *   [R7] a reserve is usable here exactly when `toV2MandateSelection` accepts it
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogPool, CatalogReserve, CatalogToken } from "@/lib/api/v2/schemas";
import {
  findPanelPoolFixture,
  panelPoolFixtures,
  panelReserveFixtures,
} from "@/mocks/data/buildPanelFixtures";
import { createEmptyDraft, depositTokenRefFor, withProtocols } from "../../mandateDraft";
import { mapV2Pool, searchMandatePools } from "../../mandatePoolSource";
import { buildRealCatalog, toV2MandateSelection } from "../../v2Mandate";
import {
  panelPoolsFor,
  reserveUsability,
  selectPanelReserves,
  toPanelPoolView,
} from "./panelCatalogView";

const mocks = vi.hoisted(() => ({ list: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogPoolsAction: mocks.list,
  getCatalogPoolAction: mocks.lookup,
}));

function basePool(): CatalogPool {
  const pool = findPanelPoolFixture(42161, "arb-v4-weth-usdc-5");
  if (!pool) throw new Error("fixture missing");
  return pool;
}

/** The variants `eligiblePool` tells apart, each starting from a clean fixture. */
const VARIANTS: Array<[string, (pool: CatalogPool) => void]> = [
  ["a clean pool", () => {}],
  [
    "the catalog marks it ineligible",
    (pool) => {
      pool.eligible = false;
    },
  ],
  [
    "it is flagged hooked",
    (pool) => {
      pool.hooked = true;
    },
  ],
  [
    "its hooks address is not zero",
    (pool) => {
      pool.poolKey.hooks = `0x${"1".repeat(40)}`;
    },
  ],
  [
    "a currency is the native zero address",
    (pool) => {
      pool.poolKey.currency0 = `0x${"0".repeat(40)}`;
      const first = pool.tokens[0];
      if (first) first.address = pool.poolKey.currency0;
    },
  ],
  [
    "a token has no hub price",
    (pool) => {
      const token = pool.tokens[0];
      if (token) token.hubPriced = false;
    },
  ],
  [
    "it has no active liquidity",
    (pool) => {
      pool.liquidity = "0";
    },
  ],
  [
    // Passes the uint schema. Both checks compare the string with "0", so both read it as non-zero:
    // pinned here so that changing one of them shows up as a failure of the other.
    "its liquidity is written 00",
    (pool) => {
      pool.liquidity = "00";
    },
  ],
];

describe("eligibility parity with the Mandate step's pool search [R3]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(VARIANTS)("agrees on a pool where %s", async (_name, mutate) => {
    const pool = basePool();
    mutate(pool);
    mocks.list.mockResolvedValue({ ok: true, data: { pools: [pool] } });
    const found = await searchMandatePools({
      network: "arbitrum",
      tokenAddress: pool.poolKey.currency0,
      protocols: ["uniswap-v4"],
    });
    const view = toPanelPoolView(pool);
    expect(view.eligible && view.hasActiveLiquidity).toBe(found.length === 1);
  });
});

describe("row and live view share one PoolId [R4]", () => {
  it.each(
    panelPoolFixtures().map(({ mockId, pool }) => [mockId, pool] as const),
  )("a draft row of %s names the pool the live read answers for", (_id, pool) => {
    const chainId = pool.chainId === "42161" ? 42161 : 4663;
    const [row] = panelPoolsFor({ pools: [mapV2Pool(pool)] }, chainId);
    const view = toPanelPoolView(pool);
    expect(row?.poolId).toBe(view.poolId);
    expect(row?.poolId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(row?.rowId).toBe(`${pool.chainId}:${view.poolId}`);
    expect(row?.pairLabel).toBe(view.pairLabel);
    expect(row?.feePct).toBe(view.feePct);
    expect(row?.tickSpacing).toBe(view.tickSpacing);
    expect(row?.token0.address).toBe(view.token0.address);
    expect(row?.token1.address).toBe(view.token1.address);
  });
});

describe("reserve usability parity with the Mandate step's validation [R7]", () => {
  const usdc = depositTokenRefFor("arbitrum");
  if (!usdc) throw new Error("missing deposit token");
  const catalogToken: CatalogToken = {
    protocolVersion: "v2",
    chainId: "42161",
    address: usdc.address,
    symbol: usdc.symbol,
    name: usdc.name,
    decimals: 6,
    logoUrl: null,
    hubPriced: true,
    priceUsd: "1",
    priceUpdatedAt: null,
    priceSource: usdc.address,
    priceProvenance: "fixed-1:1",
    priceUnavailableReason: null,
  };

  /** Whether `toV2MandateSelection` accepts a draft that supplies this reserve. */
  function mandateAccepts(reserve: CatalogReserve): boolean {
    const draft = {
      ...createEmptyDraft("2026-10-03", "real"),
      dataMode: "real" as const,
      catalogVersion: "v2-catalog-v1" as const,
    };
    const supplied = {
      ...withProtocols(draft, ["aave-v3"]),
      aaveV3Reserves: [reserve.token.address],
    };
    try {
      toV2MandateSelection(supplied, buildRealCatalog([catalogToken], [reserve]));
      return true;
    } catch {
      return false;
    }
  }

  const base = (): CatalogReserve => {
    const first = panelReserveFixtures()[0];
    if (!first) throw new Error("fixture missing");
    return { ...first, token: catalogToken };
  };

  it.each([
    ["all flags healthy", {}],
    ["inactive", { active: false }],
    ["frozen", { frozen: true }],
    ["paused", { paused: true }],
    ["supply cap reached", { supplyCapReached: true }],
    ["not available", { available: false }],
    ["frozen and not available", { frozen: true, available: false }],
  ] as Array<
    [string, Partial<CatalogReserve>]
  >)("agrees on a reserve that is %s", (_name, patch) => {
    const reserve = { ...base(), ...patch };
    expect(reserveUsability(reserve).usable).toBe(mandateAccepts(reserve));
  });
});

describe("reserve selection parity with the Mandate step's validation [R7]", () => {
  const usdc = depositTokenRefFor("arbitrum");
  if (!usdc) throw new Error("missing deposit token");
  const [usdcReserve, cappedReserve] = panelReserveFixtures();
  if (!usdcReserve || !cappedReserve) throw new Error("fixture missing");
  const catalogToken: CatalogToken = { ...usdcReserve.token, address: usdc.address };
  const reserves: CatalogReserve[] = [{ ...usdcReserve, token: catalogToken }, cappedReserve];

  /** A real draft on the hub that supplies to Aave, optionally naming its reserves. */
  function draftNaming(aaveV3Reserves?: string[]) {
    const draft = {
      ...createEmptyDraft("2026-10-03", "real"),
      dataMode: "real" as const,
      catalogVersion: "v2-catalog-v1" as const,
    };
    const supplying = withProtocols(draft, ["aave-v3"]);
    return aaveV3Reserves === undefined ? supplying : { ...supplying, aaveV3Reserves };
  }

  it("lists exactly the reserves the mandate selection carries, when the draft names them", () => {
    const catalog = buildRealCatalog([catalogToken], reserves);
    const draft = draftNaming([usdc.address]);
    const selection = toV2MandateSelection(draft, catalog);
    const rows = selectPanelReserves(reserves, draft.tokens, 42161, draft.aaveV3Reserves);
    expect(rows.map((row) => row.token.address)).toEqual(
      selection.aaveV3Reserves.map((address) => address.toLowerCase()),
    );
  });

  it("lists exactly the reserves the mandate selection carries, when the draft names none", () => {
    const catalog = buildRealCatalog([catalogToken], reserves);
    const draft = draftNaming();
    const selection = toV2MandateSelection(draft, catalog);
    const rows = selectPanelReserves(reserves, draft.tokens, 42161, draft.aaveV3Reserves);
    expect(rows.map((row) => row.token.address)).toEqual(
      selection.aaveV3Reserves.map((address) => address.toLowerCase()),
    );
  });
});
