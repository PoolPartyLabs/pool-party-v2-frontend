/**
 * @id PP-MGR-HOK-013
 * @name usePanelReserves tests (real mode)
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks)
 *
 * Rules under test (POO-2185 rules v1):
 *   [R7] a selector over the catalog hook's reserves, joined to the draft tokens of the network, an
 *        unusable reserve listed (disabled, with its reason); loading and error come from the
 *        catalog hook
 *   [R6] real mode has no fallback to fixtures
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { panelReserveFixtures } from "@/mocks/data/buildPanelFixtures";
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

describe("usePanelReserves (real mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokens.mockImplementation(async (chainId: number) => ({
      ok: true,
      data: { protocolVersion: "v2", chainId: String(chainId), tokens: [] },
    }));
    mocks.reserves.mockResolvedValue({
      ok: true,
      data: { protocolVersion: "v2", chainId: "42161", reserves: panelReserveFixtures() },
    });
  });

  it("is loading with no rows, then lists the reserves of the mandate's tokens", async () => {
    const { result } = renderHook(() => usePanelReserves(42161, BOTH));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(false);
    expect(result.current.reserves).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reserves.map((row) => row.token.symbol)).toEqual(["USDC", "WETH"]);
    expect(mocks.reserves).toHaveBeenCalledTimes(1);
  });

  it("lists a usable row and a disabled one with its reason", async () => {
    const { result } = renderHook(() => usePanelReserves(42161, BOTH));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reserves.map((row) => [row.usable, row.reason])).toEqual([
      [true, null],
      [false, "supplyCapReached"],
    ]);
    expect(result.current.reserves[0]?.supplyApy).toBe("4.12");
    expect(result.current.reserves[0]?.assetKey).toBe(`arbitrum:${USDC}`);
  });

  it("leaves out a reserve whose token the mandate does not hold", async () => {
    const { result } = renderHook(() => usePanelReserves(42161, USDC_ONLY));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reserves.map((row) => row.token.symbol)).toEqual(["USDC"]);
  });

  it("follows the draft's tokens when they change", async () => {
    const { result, rerender } = renderHook(({ draft }) => usePanelReserves(42161, draft), {
      initialProps: { draft: USDC_ONLY },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reserves).toHaveLength(1);
    rerender({ draft: BOTH });
    expect(result.current.reserves).toHaveLength(2);
  });

  it("has no rows on a spoke, where Aave is not deployed", async () => {
    const spoke = { tokens: [...BOTH.tokens, token(USDC, "USDC", "robinhood", true)] };
    const { result } = renderHook(() => usePanelReserves(4663, spoke));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reserves).toEqual([]);
    expect(result.current.error).toBe(false);
  });

  it("keeps the same rows between renders while nothing changed", async () => {
    const { result, rerender } = renderHook(() => usePanelReserves(42161, BOTH));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.reserves;
    rerender();
    expect(result.current.reserves).toBe(first);
  });

  describe("loading and error come from the catalog hook", () => {
    it("surfaces a failed catalog read with no rows, and recovers on retry", async () => {
      mocks.reserves.mockResolvedValue({
        ok: false,
        error: { status: 503, code: "V2_UNAVAILABLE" },
      });
      const { result } = renderHook(() => usePanelReserves(42161, BOTH));
      await waitFor(() => expect(result.current.error).toBe(true));
      expect(result.current.loading).toBe(false);
      expect(result.current.reserves).toEqual([]);

      mocks.reserves.mockResolvedValue({
        ok: true,
        data: { protocolVersion: "v2", chainId: "42161", reserves: panelReserveFixtures() },
      });
      act(() => result.current.retry());
      await waitFor(() => expect(result.current.error).toBe(false));
      await waitFor(() => expect(result.current.reserves).toHaveLength(2));
    });
  });

  describe("no fixture fallback in real mode [R6]", () => {
    it("lists nothing when the catalog serves no reserve, never the fixtures", async () => {
      mocks.reserves.mockResolvedValue({
        ok: true,
        data: { protocolVersion: "v2", chainId: "42161", reserves: [] },
      });
      const { result } = renderHook(() => usePanelReserves(42161, BOTH));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.reserves).toEqual([]);
    });

    it("lists nothing when the catalog read failed", async () => {
      mocks.tokens.mockResolvedValue({
        ok: false,
        error: { status: 500, code: "SYSTEM_INTERNAL" },
      });
      const { result } = renderHook(() => usePanelReserves(42161, BOTH));
      await waitFor(() => expect(result.current.error).toBe(true));
      expect(result.current.reserves).toEqual([]);
    });
  });
});
