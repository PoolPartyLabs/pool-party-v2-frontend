/**
 * @id PP-CORE-HOK-016 (POO-364, POO-453, POO-638)
 * @name usePostWriteRefresh tests
 * @implements-rules-version v1
 *
 * Immediate pass (positions-invalidate → local refetch, then revalidate-before-router.refresh), a
 * bounded real-mode poll, mock-mode single pass, unmount cancellation, and a referentially stable
 * callback. POO-453: each refetch busts the wallet's positions cache first, per tick.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  router: null as unknown as { refresh: () => void },
  revalidate: vi.fn(),
  revalidatePositions: vi.fn(),
  readBlocks: vi.fn(),
  isMockMode: false,
}));
mocks.router = { refresh: mocks.refresh };

vi.mock("@/i18n/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: mocks.revalidate,
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: mocks.revalidatePositions,
}));
vi.mock("@/lib/strategies/v2/strategiesV2Actions", () => ({
  readStrategyOnchainBlocksAction: mocks.readBlocks,
}));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.isMockMode;
  },
}));

import {
  POLL_DELAYS_MS,
  type PostWriteConvergence,
  usePostWriteRefresh,
} from "./usePostWriteRefresh";

/** Renders a button whose click invokes the hook's returned refresh callback. */
function Probe({
  refreshLocal,
  convergence,
}: {
  refreshLocal?: () => void;
  convergence?: PostWriteConvergence;
}) {
  const run = usePostWriteRefresh(refreshLocal);
  return (
    <button type="button" data-testid="run" onClick={() => run(convergence)}>
      run
    </button>
  );
}

/** Click the trigger and flush the immediate pass + its revalidate microtask. */
async function clickRun() {
  fireEvent.click(screen.getByTestId("run"));
  await vi.advanceTimersByTimeAsync(0);
}

describe("usePostWriteRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.refresh.mockReset();
    mocks.revalidate.mockReset().mockResolvedValue(undefined);
    mocks.revalidatePositions.mockReset().mockResolvedValue(undefined);
    mocks.readBlocks.mockReset().mockResolvedValue({});
    mocks.isMockMode = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // @rule R1
  it("immediate pass: local refetch + revalidate + router.refresh once", async () => {
    const refreshLocal = vi.fn();
    render(<Probe refreshLocal={refreshLocal} />);
    await clickRun();
    expect(refreshLocal).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  // @rule R2 (POO-453)
  it("immediate pass: runs the local refetch synchronously and busts the positions cache", async () => {
    const refreshLocal = vi.fn();
    render(<Probe refreshLocal={refreshLocal} />);
    await clickRun();
    // onChanged / console refresh reacts at once (kept synchronous so the success UI is immediate).
    expect(refreshLocal).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePositions).toHaveBeenCalledTimes(1);
  });

  // @rule R2 (POO-453)
  it("each poll tick busts the positions cache BEFORE its refetch (reads post-index value)", async () => {
    const refreshLocal = vi.fn();
    render(<Probe refreshLocal={refreshLocal} />);
    await clickRun(); // immediate pass (sync refetch + fire-and-forget invalidate)
    refreshLocal.mockClear();
    mocks.revalidatePositions.mockClear();

    // Advance to the FIRST poll tick only.
    await vi.advanceTimersByTimeAsync((POLL_DELAYS_MS[0] ?? 0) + 1);
    expect(mocks.revalidatePositions).toHaveBeenCalledTimes(1);
    expect(refreshLocal).toHaveBeenCalledTimes(1);
    // Ordering: the tick invalidates the positions tag before its refetch reads it.
    const invalidateOrder = mocks.revalidatePositions.mock.invocationCallOrder[0] ?? 0;
    const refetchOrder = refreshLocal.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    expect(invalidateOrder).toBeLessThan(refetchOrder);
  });

  // @rule R4
  it("invalidates the catalog BEFORE router.refresh", async () => {
    let resolveRevalidate: (() => void) | undefined;
    mocks.revalidate.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRevalidate = resolve;
      }),
    );
    render(<Probe />);
    fireEvent.click(screen.getByTestId("run"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled(); // waits for revalidate to resolve
    resolveRevalidate?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  // @rule R3
  it("polls the LOCAL refetch only; revalidate + refresh run once, not per tick (POO-377)", async () => {
    const refreshLocal = vi.fn();
    render(<Probe refreshLocal={refreshLocal} />);
    await clickRun();
    expect(refreshLocal).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(Math.max(...POLL_DELAYS_MS) + 100);
    // The cheap local refetch (and its per-wallet positions invalidation) repeat over the window to
    // absorb indexer lag...
    expect(refreshLocal).toHaveBeenCalledTimes(1 + POLL_DELAYS_MS.length);
    expect(mocks.revalidatePositions).toHaveBeenCalledTimes(1 + POLL_DELAYS_MS.length);
    // ...but the expensive catalog revalidate + RSC refresh do NOT (else they storm the throttle).
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    // Bounded: advancing far beyond the schedule adds nothing more.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshLocal).toHaveBeenCalledTimes(1 + POLL_DELAYS_MS.length);
  });

  // @rule R3
  it("mock mode: single pass, schedules no timers", async () => {
    mocks.isMockMode = true;
    const refreshLocal = vi.fn();
    render(<Probe refreshLocal={refreshLocal} />);
    await clickRun();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshLocal).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
  });

  // @rule R3
  it("cancels pending follow-ups on unmount", async () => {
    const refreshLocal = vi.fn();
    const { unmount } = render(<Probe refreshLocal={refreshLocal} />);
    await clickRun();
    expect(refreshLocal).toHaveBeenCalledTimes(1);
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshLocal).toHaveBeenCalledTimes(1); // no scheduled runs fire after unmount
  });

  // @rule R5
  it("works without a local refresher", async () => {
    render(<Probe />);
    await clickRun();
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  // @rule R5
  it("returns a referentially stable callback across re-renders", () => {
    const seen = new Set<() => void>();
    function Capture({ rl }: { rl: () => void }) {
      seen.add(usePostWriteRefresh(rl));
      return null;
    }
    const { rerender } = render(<Capture rl={() => {}} />);
    rerender(<Capture rl={() => {}} />); // a new refreshLocal identity each render
    expect(seen.size).toBe(1);
  });

  // POO-638: deterministic post-write convergence via the v2 onchain block.
  describe("deterministic convergence (POO-638)", () => {
    const converge = (blockNumber: number, ...strategyIds: string[]): PostWriteConvergence => ({
      blockNumber,
      strategyIds,
    });

    // @rule R1: polls the v2 onchain block per touched strategy and STOPS once it reaches the mined
    // receipt block (onchain.blockNumber >= receipt.blockNumber) — no blind 13s stop.
    it("polls the v2 onchain block and stops as soon as it converges", async () => {
      // First observation still lags (99 < 100); the next has caught up (100 >= 100).
      mocks.readBlocks.mockResolvedValueOnce({ s1: 99 }).mockResolvedValue({ s1: 100 });
      const refreshLocal = vi.fn();
      render(<Probe refreshLocal={refreshLocal} convergence={converge(100, "s1")} />);
      await clickRun();

      // Immediate pass observed once (sync refetch); no v2 read yet.
      expect(mocks.readBlocks).not.toHaveBeenCalled();

      // Drive far past the schedule; convergence must stop the poll after exactly 2 observations.
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mocks.readBlocks).toHaveBeenCalledTimes(2);
      expect(mocks.readBlocks.mock.calls[0]?.[0]).toEqual(["s1"]);
      // The catalog revalidate + RSC refresh still run exactly once (never per tick, POO-377).
      expect(mocks.revalidate).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });

    // @rule R1: the HARD CAP terminates a poll whose strategy never catches up (indexer stuck).
    it("gives up at the hard cap when the onchain block never reaches the receipt block", async () => {
      mocks.readBlocks.mockResolvedValue({ s1: 1 }); // forever behind the target (999)
      render(<Probe refreshLocal={vi.fn()} convergence={converge(999, "s1")} />);
      await clickRun();

      await vi.advanceTimersByTimeAsync(120_000);
      const polled = mocks.readBlocks.mock.calls.length;
      expect(polled).toBeGreaterThan(1); // it really polled with backoff

      // Bounded: once the cap is hit the poll stops — advancing another 5 min adds no observations.
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mocks.readBlocks).toHaveBeenCalledTimes(polled);
    });

    // @rule R1: a multi-strategy write only re-polls the strategies that are still lagging.
    it("narrows the poll to the still-lagging strategies", async () => {
      // s1 converges on the first observation; s2 lags, then catches up.
      mocks.readBlocks.mockResolvedValueOnce({ s1: 100, s2: 98 }).mockResolvedValue({ s2: 100 });
      render(<Probe refreshLocal={vi.fn()} convergence={converge(100, "s1", "s2")} />);
      await clickRun();

      await vi.advanceTimersByTimeAsync(300_000);
      expect(mocks.readBlocks.mock.calls[0]?.[0]).toEqual(["s1", "s2"]);
      expect(mocks.readBlocks.mock.calls[1]?.[0]).toEqual(["s2"]); // s1 dropped after it converged
      expect(mocks.readBlocks).toHaveBeenCalledTimes(2);
    });

    // @rule R2: a caller that passes no convergence info keeps the blind bounded fallback (no v2 read).
    it("falls back to the blind poll when no convergence info is given", async () => {
      const refreshLocal = vi.fn();
      render(<Probe refreshLocal={refreshLocal} />);
      await clickRun();
      await vi.advanceTimersByTimeAsync(Math.max(...POLL_DELAYS_MS) + 100);

      expect(mocks.readBlocks).not.toHaveBeenCalled();
      expect(refreshLocal).toHaveBeenCalledTimes(1 + POLL_DELAYS_MS.length);
    });

    // @rule R2: passing convergence info with an empty strategy list also uses the blind fallback.
    it("falls back to the blind poll when the strategy list is empty", async () => {
      render(<Probe refreshLocal={vi.fn()} convergence={converge(100)} />);
      await clickRun();
      await vi.advanceTimersByTimeAsync(Math.max(...POLL_DELAYS_MS) + 100);
      expect(mocks.readBlocks).not.toHaveBeenCalled();
    });

    // @rule R3: mock mode never polls real v2 reads — single pass, no timers, no observation.
    it("mock mode does a single pass and never polls the v2 read", async () => {
      mocks.isMockMode = true;
      render(<Probe refreshLocal={vi.fn()} convergence={converge(100, "s1")} />);
      await clickRun();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mocks.readBlocks).not.toHaveBeenCalled();
      expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    });

    // @rule R1: unmounting cancels an in-flight convergence poll (no observation after unmount).
    it("cancels the convergence poll on unmount", async () => {
      mocks.readBlocks.mockResolvedValue({ s1: 1 });
      const { unmount } = render(
        <Probe refreshLocal={vi.fn()} convergence={converge(999, "s1")} />,
      );
      await clickRun();
      unmount();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mocks.readBlocks).not.toHaveBeenCalled();
    });
  });
});
