/**
 * @id PP-MGR-HOK-013
 * @name usePanelReserves tests (mock mode)
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks)
 *
 * Rule under test (POO-2185 rules v1):
 *   [R7] mock mode lists the MCK-005 reserve fixtures, joined to the draft tokens (and to the draft's
 *        own reserve selection) like the real catalog's, with no network and no loading state of its
 *        own (the mock catalog has none)
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateTokenRef } from "../../mandateDraft";
import { usePanelReserves } from "./usePanelReserves";

const mocks = vi.hoisted(() => ({ tokens: vi.fn(), reserves: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: true }));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogTokensAction: mocks.tokens,
  getCatalogReservesAction: mocks.reserves,
}));

const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";

function token(address: string, symbol: string, locked = false): MandateTokenRef {
  return {
    address,
    symbol,
    name: `${symbol} name`,
    network: "arbitrum",
    logoUrl: null,
    locked,
  };
}

/** The mock catalog (`buildMandateCatalog`): no reserves, no loading, no error, no retry. */
const MOCK_CATALOG: Pick<MandateCatalog, "reserves" | "loading" | "error" | "retry"> = {};

describe("usePanelReserves (mock mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the fixture reserves of the mandate's tokens with no network", () => {
    const draft = { tokens: [token(USDC, "USDC", true), token(WETH, "WETH")] };
    const { result } = renderHook(() => usePanelReserves(42161, draft, MOCK_CATALOG));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
    expect(
      result.current.reserves.map((row) => [row.token.symbol, row.usable, row.reason]),
    ).toEqual([
      ["USDC", true, null],
      ["WETH", false, "supplyCapReached"],
    ]);
    expect(mocks.tokens).not.toHaveBeenCalled();
    expect(mocks.reserves).not.toHaveBeenCalled();
  });

  it("lists only the USDC reserve for a mandate that holds only the deposit token", () => {
    const draft = { tokens: [token(USDC, "USDC", true)] };
    const { result } = renderHook(() => usePanelReserves(42161, draft, MOCK_CATALOG));
    expect(result.current.reserves.map((row) => row.token.symbol)).toEqual(["USDC"]);
  });

  it("follows the draft's own reserve selection in mock mode too", () => {
    const draft = {
      tokens: [token(USDC, "USDC", true), token(WETH, "WETH")],
      aaveV3Reserves: [WETH],
    };
    const { result } = renderHook(() => usePanelReserves(42161, draft, MOCK_CATALOG));
    expect(result.current.reserves.map((row) => row.token.symbol)).toEqual(["WETH"]);
  });

  it("has no rows on a spoke or for a mandate with no token on the hub", () => {
    const draft = { tokens: [token(USDC, "USDC", true)] };
    expect(
      renderHook(() => usePanelReserves(4663, draft, MOCK_CATALOG)).result.current.reserves,
    ).toEqual([]);
    expect(
      renderHook(() => usePanelReserves(42161, { tokens: [] }, MOCK_CATALOG)).result.current
        .reserves,
    ).toEqual([]);
  });

  it("offers a retry that does nothing, since mock mode never fails to load", () => {
    const draft = { tokens: [token(USDC, "USDC", true)] };
    const { result } = renderHook(() => usePanelReserves(42161, draft, MOCK_CATALOG));
    expect(() => result.current.retry()).not.toThrow();
    expect(result.current.error).toBe(false);
  });

  it("hands out rows the caller can mutate without touching the fixtures", () => {
    const draft = { tokens: [token(USDC, "USDC", true)] };
    const first = renderHook(() => usePanelReserves(42161, draft, MOCK_CATALOG)).result.current
      .reserves;
    if (first[0]) first[0].supplyApy = "99";
    expect(
      renderHook(() => usePanelReserves(42161, draft, MOCK_CATALOG)).result.current.reserves[0]
        ?.supplyApy,
    ).toBe("4.12");
  });
});
