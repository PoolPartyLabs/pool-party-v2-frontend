/**
 * @id PP-MGR-HOK-012
 * @name usePanelPool tests (mock mode)
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks)
 *
 * Rule under test (POO-2185 rules v1):
 *   [R6] mock mode serves the MCK-005 fixtures with NO network: the server action is never called,
 *        the read takes a plausible round trip, fails rarely, and an id with no fixture is a
 *        not-found, never an invented pool
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPanelPoolFixture, PANEL_MOCK_LATENCY_MS } from "@/mocks/data/buildPanelFixtures";
import { fundPoolFixtures } from "@/mocks/data/fundPools";
import { usePanelPool } from "./usePanelPool";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: true }));
vi.mock("@/lib/api/v2/actions", () => ({ getCatalogPoolAction: mocks.read }));
vi.mock("@/features/manager/actions", () => ({ getPoolCurrentPriceAction: vi.fn() }));

const ARB_5_ID = findPanelPoolFixture(42161, "arb-v4-weth-usdc-5")?.poolId ?? "";

/** Advance fake timers inside act so the async state updates flush. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The delay `simulateDelay` draws when `Math.random()` answers 0.5: the middle of the band. */
const MIDDLE_LATENCY = (PANEL_MOCK_LATENCY_MS[0] + PANEL_MOCK_LATENCY_MS[1]) / 2;

describe("usePanelPool (mock mode)", () => {
  let random: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.read.mockReset();
    random = vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    random.mockRestore();
    vi.useRealTimers();
  });

  it("serves the fixture for a mock-mode pool slug with no network", async () => {
    const { result } = renderHook(() => usePanelPool(42161, "arb-v4-weth-usdc-5"));
    expect(result.current.status).toBe("loading");
    expect(result.current.pool).toBeNull();
    await tick(MIDDLE_LATENCY);
    expect(result.current.status).toBe("ready");
    expect(result.current.pool).toMatchObject({
      poolId: ARB_5_ID,
      feePct: 0.05,
      tickSpacing: 10,
      token0: { symbol: "WETH", decimals: 18 },
      token1: { symbol: "USDC", decimals: 6 },
    });
    expect(result.current.pool?.price).toBeGreaterThan(3000);
    expect(result.current.pool?.price).toBeLessThan(3100);
    expect(result.current.refreshedAt).not.toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("serves the same fixture for its real PoolId", async () => {
    const { result } = renderHook(() => usePanelPool(42161, ARB_5_ID));
    await tick(MIDDLE_LATENCY);
    expect(result.current.status).toBe("ready");
    expect(result.current.pool?.poolId).toBe(ARB_5_ID);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("serves the 0.3% pool with spacing 60 and the Robinhood pool on its own chain", async () => {
    const thirty = renderHook(() => usePanelPool(42161, "arb-v4-weth-usdc-30"));
    const robinhood = renderHook(() => usePanelPool(4663, "rbh-v4-weth-usdg-5"));
    await tick(MIDDLE_LATENCY);
    expect(thirty.result.current.pool).toMatchObject({ feePct: 0.3, tickSpacing: 60 });
    expect(robinhood.result.current.pool).toMatchObject({
      network: "robinhood",
      pairLabel: "WETH / USDG",
    });
    expect(robinhood.result.current.pool?.orientation.quote.symbol).toBe("USDG");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("takes a round trip: loading inside the latency band, ready after it", async () => {
    const [low, high] = PANEL_MOCK_LATENCY_MS;
    // The first draw is the delay (the low edge of the band), the second the failure roll (a pass).
    random.mockReturnValueOnce(0).mockReturnValue(0.5);
    const quick = renderHook(() => usePanelPool(42161, "arb-v4-weth-usdc-5"));
    await tick(low - 1);
    expect(quick.result.current.status).toBe("loading");
    await tick(1);
    expect(quick.result.current.status).toBe("ready");

    random.mockReturnValue(0.999);
    const slow = renderHook(() => usePanelPool(42161, "arb-v4-weth-usdc-5"));
    await tick(high - 2);
    expect(slow.result.current.status).toBe("loading");
    await tick(2);
    expect(slow.result.current.status).toBe("ready");
  });

  it("polls 15 s after each read settles, still with no network", async () => {
    const { result } = renderHook(() => usePanelPool(42161, "arb-v4-weth-usdc-5"));
    await tick(MIDDLE_LATENCY);
    const first = result.current.refreshedAt ?? 0;
    // The next read starts 15 s after the first settled and takes its own round trip.
    await tick(15_000 + MIDDLE_LATENCY);
    expect(result.current.refreshedAt ?? 0).toBeGreaterThan(first);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("is applicable once an eligible pool has been read, so Use can enable in mock mode", async () => {
    const { result } = renderHook(() => usePanelPool(42161, "arb-v4-weth-usdc-5"));
    expect(result.current.applicable).toBe(false);
    await tick(MIDDLE_LATENCY);
    expect(result.current.applicable).toBe(true);
  });

  describe("every hookless Uniswap v4 pool the mock mandate can hold answers", () => {
    const hookless = fundPoolFixtures().uniswapV4.filter((row) => !row.hasHook);

    it("covers the whole mock universe: 12 pools, three of them hand-written", () => {
      expect(hookless).toHaveLength(12);
    });

    it.each(
      hookless.map((row) => [row.id, row] as const),
    )("%s is read with its own pair and fee, and is applicable unless a token is unpriced", async (id, row) => {
      const chainId = row.network === "arbitrum" ? 42161 : 4663;
      const { result } = renderHook(() => usePanelPool(chainId, id));
      await tick(MIDDLE_LATENCY);
      expect(result.current.status).toBe("ready");
      expect(result.current.pool?.token0.address).toBe(row.token0.address.toLowerCase());
      expect(result.current.pool?.token1.address).toBe(row.token1.address.toLowerCase());
      expect(result.current.pool?.feeTier).toBe(row.feeTier);
      expect(result.current.pool?.network).toBe(row.network);
      // Every mock pool but the one holding the unpriced equity token can be applied.
      expect(result.current.applicable).toBe(id !== "rbh-v4-usdg-nvda-30");
      expect(mocks.read).not.toHaveBeenCalled();
    });
  });

  it("fails rarely, with an error the panel can retry", async () => {
    random.mockReturnValue(0.001);
    const { result } = renderHook(() => usePanelPool(42161, "arb-v4-weth-usdc-5"));
    await tick(PANEL_MOCK_LATENCY_MS[1]);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toEqual({ status: 503, code: "MOCK_UNAVAILABLE" });
    expect(result.current.pool).toBeNull();

    random.mockReturnValue(0.5);
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    await tick(MIDDLE_LATENCY);
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();
  });

  it.each([
    ["a slug outside the mock universe", "arb-v4-doge-usdc-30"],
    ["a pool with a hook, which no mandate can hold", "arb-v4-wsteth-weth-1"],
  ])("answers not-found for %s, and never invents a pool", async (_label, id) => {
    const { result } = renderHook(() => usePanelPool(42161, id));
    await tick(MIDDLE_LATENCY);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toEqual({ status: 404, code: "V2_NOT_FOUND" });
    expect(result.current.pool).toBeNull();
    expect(result.current.applicable).toBe(false);
    act(() => result.current.retry());
    await tick(MIDDLE_LATENCY);
    expect(result.current.status).toBe("error");
  });

  it("answers not-found for a real pool on the wrong chain", async () => {
    const { result } = renderHook(() => usePanelPool(4663, ARB_5_ID));
    await tick(MIDDLE_LATENCY);
    expect(result.current.error).toEqual({ status: 404, code: "V2_NOT_FOUND" });
  });

  it("does nothing for a null pool id, in mock mode too", async () => {
    const { result } = renderHook(() => usePanelPool(42161, null));
    await tick(60_000);
    expect(result.current.status).toBe("idle");
    expect(result.current.applicable).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers not-found for a real PoolId the fixtures do not hold", async () => {
    const { result } = renderHook(() => usePanelPool(42161, `0x${"ab".repeat(32)}`));
    await tick(MIDDLE_LATENCY);
    expect(result.current.error).toEqual({ status: 404, code: "V2_NOT_FOUND" });
  });

  it("stops polling when it unmounts", async () => {
    const { unmount, result } = renderHook(() => usePanelPool(42161, "arb-v4-weth-usdc-5"));
    await tick(MIDDLE_LATENCY);
    const refreshedAt = result.current.refreshedAt;
    unmount();
    await tick(60_000);
    expect(result.current.refreshedAt).toBe(refreshedAt);
  });
});
