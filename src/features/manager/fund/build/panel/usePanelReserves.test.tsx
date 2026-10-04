/**
 * @id PP-MGR-HOK-013
 * @name usePanelReserves tests (real mode)
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks)
 *
 * Rules under test (POO-2185 rules v1):
 *   [R7] a selector over the reserves of the catalog the shell already holds, joined to the draft
 *        tokens of the network (and to the draft's own Aave reserve selection when it names one), an
 *        unusable reserve listed (disabled, with its reason); loading, error and retry are the
 *        catalog's
 *   [R6] real mode has no fallback to fixtures
 *
 * It fetches nothing: the catalog is an argument, so a Supply panel opening never starts a second
 * catalog load or shows the skeleton again.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { panelReserveFixtures } from "@/mocks/data/buildPanelFixtures";
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateTokenRef } from "../../mandateDraft";
import { usePanelReserves } from "./usePanelReserves";

const mocks = vi.hoisted(() => ({ tokens: vi.fn(), reserves: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogTokensAction: mocks.tokens,
  getCatalogReservesAction: mocks.reserves,
}));

const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";

function token(
  address: string,
  symbol: string,
  network: MandateTokenRef["network"] = "arbitrum",
  locked = false,
): MandateTokenRef {
  return { address, symbol, name: `${symbol} name`, network, logoUrl: `logo:${symbol}`, locked };
}

const USDC_TOKEN = token(USDC, "USDC", "arbitrum", true);
const WETH_TOKEN = token(WETH, "WETH");
const BOTH = { tokens: [USDC_TOKEN, WETH_TOKEN] };
const USDC_ONLY = { tokens: [USDC_TOKEN] };

type CatalogArg = Pick<MandateCatalog, "reserves" | "loading" | "error" | "retry">;

/** The shell's catalog once it has loaded the two fixture reserves. */
const loaded = (): CatalogArg => ({
  reserves: panelReserveFixtures(),
  loading: false,
  error: false,
  retry: vi.fn(),
});

describe("usePanelReserves (real mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the reserves of the mandate's tokens, a usable row and a disabled one with its reason", () => {
    const catalog = loaded();
    const { result } = renderHook(() => usePanelReserves(42161, BOTH, catalog));
    expect(
      result.current.reserves.map((row) => [row.token.symbol, row.usable, row.reason]),
    ).toEqual([
      ["USDC", true, null],
      ["WETH", false, "supplyCapReached"],
    ]);
    expect(result.current.reserves[0]?.supplyApy).toBe("4.12");
    expect(result.current.reserves[0]?.assetKey).toBe(`arbitrum:${USDC}`);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it("fetches nothing: no catalog read, so opening a Supply panel never loads or flashes a skeleton", () => {
    renderHook(() => usePanelReserves(42161, BOTH, loaded()));
    expect(mocks.tokens).not.toHaveBeenCalled();
    expect(mocks.reserves).not.toHaveBeenCalled();
  });

  it("leaves out a reserve whose token the mandate does not hold", () => {
    const { result } = renderHook(() => usePanelReserves(42161, USDC_ONLY, loaded()));
    expect(result.current.reserves.map((row) => row.token.symbol)).toEqual(["USDC"]);
  });

  describe("the mandate's own Aave reserve selection", () => {
    it("lists only the reserves the draft selected when it names them", () => {
      const draft = { ...BOTH, aaveV3Reserves: [USDC] };
      const { result } = renderHook(() => usePanelReserves(42161, draft, loaded()));
      expect(result.current.reserves.map((row) => row.token.symbol)).toEqual(["USDC"]);
    });

    it("lists every reserve of the mandate's tokens when the draft names none", () => {
      const { result } = renderHook(() => usePanelReserves(42161, BOTH, loaded()));
      expect(result.current.reserves).toHaveLength(2);
    });

    it("lists nothing when the draft selected no reserve", () => {
      const draft = { ...BOTH, aaveV3Reserves: [] };
      const { result } = renderHook(() => usePanelReserves(42161, draft, loaded()));
      expect(result.current.reserves).toEqual([]);
    });
  });

  it("follows the draft's tokens and the catalog when they change", () => {
    const empty: CatalogArg = { reserves: [], loading: true, error: false, retry: vi.fn() };
    const { result, rerender } = renderHook(
      ({ draft, catalog }) => usePanelReserves(42161, draft, catalog),
      { initialProps: { draft: USDC_ONLY, catalog: empty } },
    );
    expect(result.current.reserves).toEqual([]);
    expect(result.current.loading).toBe(true);

    rerender({ draft: USDC_ONLY, catalog: loaded() });
    expect(result.current.loading).toBe(false);
    expect(result.current.reserves).toHaveLength(1);

    rerender({ draft: BOTH, catalog: loaded() });
    expect(result.current.reserves).toHaveLength(2);
  });

  it("has no rows on a spoke, where Aave is not deployed", () => {
    const spoke = { tokens: [...BOTH.tokens, token(USDC, "USDC", "robinhood", true)] };
    const { result } = renderHook(() => usePanelReserves(4663, spoke, loaded()));
    expect(result.current.reserves).toEqual([]);
    expect(result.current.error).toBe(false);
  });

  it("keeps the same rows between renders while nothing changed", () => {
    const catalog = loaded();
    const { result, rerender } = renderHook(() => usePanelReserves(42161, BOTH, catalog));
    const first = result.current.reserves;
    rerender();
    expect(result.current.reserves).toBe(first);
  });

  it("does not mutate the catalog or the draft it is given", () => {
    const catalog = loaded();
    const before = structuredClone(catalog.reserves);
    const tokensBefore = structuredClone(BOTH.tokens);
    renderHook(() => usePanelReserves(42161, BOTH, catalog));
    expect(catalog.reserves).toEqual(before);
    expect(BOTH.tokens).toEqual(tokensBefore);
  });

  describe("loading, error and retry are the catalog's", () => {
    it("is loading with no rows while the catalog loads", () => {
      const catalog: CatalogArg = { reserves: undefined, loading: true, error: false };
      const { result } = renderHook(() => usePanelReserves(42161, BOTH, catalog));
      expect(result.current.loading).toBe(true);
      expect(result.current.reserves).toEqual([]);
    });

    it("surfaces a failed catalog with no rows, and calls the catalog's own retry", () => {
      const retry = vi.fn();
      const catalog: CatalogArg = { reserves: [], loading: false, error: true, retry };
      const { result } = renderHook(() => usePanelReserves(42161, BOTH, catalog));
      expect(result.current.error).toBe(true);
      expect(result.current.loading).toBe(false);
      expect(result.current.reserves).toEqual([]);
      result.current.retry();
      expect(retry).toHaveBeenCalledTimes(1);
    });

    it("has a retry that does nothing when the catalog offers none", () => {
      const { result } = renderHook(() => usePanelReserves(42161, BOTH, { reserves: [] }));
      expect(() => result.current.retry()).not.toThrow();
    });
  });

  describe("no fixture fallback in real mode [R6]", () => {
    it("lists nothing when the catalog has not served its reserves, never the fixtures", () => {
      const { result } = renderHook(() => usePanelReserves(42161, BOTH, { reserves: undefined }));
      expect(result.current.reserves).toEqual([]);
    });

    it("lists nothing when the catalog serves no reserve", () => {
      const { result } = renderHook(() => usePanelReserves(42161, BOTH, { reserves: [] }));
      expect(result.current.reserves).toEqual([]);
    });
  });
});
