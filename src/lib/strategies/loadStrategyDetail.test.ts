/**
 * @id PP-STR (POO-778)
 * @name loadStrategyDetail tests
 * @implements-rules-version v1
 *
 * The strategy-detail page's server data load. POO-778 R2: the analytics AUM series
 * (`fetchPoolTimeseries`) is fired CONCURRENTLY with the strategy resolution
 * (`resolveDetailStrategy`), keyed on the route id — the series fetch starts before the strategy
 * resolves, since no data dependency exists (the route param IS the series key for chain-bound rows).
 * A miss (null strategy) still resolves to `{ strategy: null }` so the page can 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveDetailStrategy: vi.fn(),
  fetchPoolTimeseries: vi.fn(),
  order: [] as string[],
}));

vi.mock("./resolveDetailStrategy", () => ({ resolveDetailStrategy: mocks.resolveDetailStrategy }));
vi.mock("@/lib/timeseries/fetchPoolTimeseries", () => ({
  fetchPoolTimeseries: mocks.fetchPoolTimeseries,
}));

import { loadStrategyDetail } from "./loadStrategyDetail";

const strategy = { id: "0xpos", name: "Alpha" } as never;
const series = [{ timestamp: 1, valueUsd: 1000 }] as never;

describe("loadStrategyDetail", () => {
  beforeEach(() => {
    mocks.resolveDetailStrategy.mockReset();
    mocks.fetchPoolTimeseries.mockReset();
    mocks.order = [];
  });

  it("returns the resolved strategy and its series", async () => {
    mocks.resolveDetailStrategy.mockResolvedValue(strategy);
    mocks.fetchPoolTimeseries.mockResolvedValue(series);
    const result = await loadStrategyDetail("0xpos");
    expect(result.strategy).toBe(strategy);
    expect(result.series).toBe(series);
  });

  // @rule R2: the series fetch is keyed on the ROUTE id (not the resolved strategy.id) so it can start
  // before resolution completes — the route param is the series key for chain-bound rows.
  it("[POO-778 R2] fetches the series by the route id", async () => {
    mocks.resolveDetailStrategy.mockResolvedValue(strategy);
    mocks.fetchPoolTimeseries.mockResolvedValue(series);
    await loadStrategyDetail("0xroute");
    expect(mocks.fetchPoolTimeseries).toHaveBeenCalledWith("0xroute");
  });

  // @rule R2: the analytics series fetch is INITIATED before the strategy resolution completes — the
  // two reads run concurrently, not as a waterfall. We block resolution until the series call has
  // already been made; if the load were serial (series after strategy), this would deadlock/time out.
  it("[POO-778 R2] initiates the series fetch before the strategy resolution completes (concurrent)", async () => {
    let releaseStrategy!: () => void;
    const strategyGate = new Promise<void>((resolve) => {
      releaseStrategy = resolve;
    });
    mocks.resolveDetailStrategy.mockImplementation(async () => {
      mocks.order.push("resolve:start");
      await strategyGate; // do not resolve until the series call has fired
      mocks.order.push("resolve:end");
      return strategy;
    });
    mocks.fetchPoolTimeseries.mockImplementation(async () => {
      mocks.order.push("series:start");
      releaseStrategy(); // proves the series call ran while resolution was still pending
      return series;
    });

    const result = await loadStrategyDetail("0xpos");

    expect(result.strategy).toBe(strategy);
    // The series started while resolution was still in flight (before resolve:end).
    expect(mocks.order.indexOf("series:start")).toBeLessThan(mocks.order.indexOf("resolve:end"));
  });

  // @rule R3: an unknown id resolves to a null strategy (the page 404s). The series still comes back
  // (empty upstream), so a stale link never blocks on it — resolution and 404 stay cheap.
  it("[POO-778 R3] returns a null strategy for an unknown id so the page can 404", async () => {
    mocks.resolveDetailStrategy.mockResolvedValue(null);
    mocks.fetchPoolTimeseries.mockResolvedValue([]);
    const result = await loadStrategyDetail("0xunknown");
    expect(result.strategy).toBeNull();
  });
});
