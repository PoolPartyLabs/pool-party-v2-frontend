/**
 * @id PP-STR (POO-216, POO-453, POO-476)
 * @name Portfolio server actions tests
 * @implements-rules-version v2
 *
 * [R3] getPositionsAction returns a discriminated result and never throws for an upstream failure:
 * a transient failure is retryable, anything else is not (POO-453).
 *
 * Real-mode coverage for the exited (closed=exited) feed (POO-476): PortfolioView.test.tsx mocks
 * `./actions` wholesale, so it never runs the real-mode IIFE branch of getClosedStrategiesAction.
 * This exercises that branch directly: in REAL mode (isMockMode=false) the action reads the
 * signed-in wallet's exited positions via fetchPositions(wallet, auth, "exited"), never the mock
 * fixture, then joins each to its holdings-catalog strategy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiParseError } from "@/lib/api/errors";
import type { Position } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  wallet: "0xWALLET" as string | null,
  authHeader: { Authorization: "Bearer t" } as Record<string, string>,
  fetchPositions: vi.fn(),
  listExited: vi.fn(),
  listStrategiesForHoldings: vi.fn(),
  fetchInvestorPortfolioTimeseries: vi.fn(),
}));

// Real mode: the exited action reads the live feed, not the mock fixture. getPositionsAction is
// isMockMode-independent (it always reads via fetchPositions), so this covers both describes.
vi.mock("@/lib/services", () => ({
  isMockMode: false,
  positionService: { listExited: mocks.listExited },
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: async () => mocks.wallet,
  getAuthHeader: async () => mocks.authHeader,
}));
vi.mock("@/lib/portfolio/fetchPositions", () => ({
  fetchPositions: (...args: unknown[]) => mocks.fetchPositions(...args),
}));
vi.mock("@/lib/strategies/strategyCatalog", () => ({
  listStrategiesForHoldings: (...args: unknown[]) => mocks.listStrategiesForHoldings(...args),
}));
vi.mock("@/lib/timeseries/fetchWalletTimeseries", () => ({
  fetchInvestorPortfolioTimeseries: (...args: unknown[]) =>
    mocks.fetchInvestorPortfolioTimeseries(...args),
}));

import {
  getClosedStrategiesAction,
  getInvestorPortfolioSeriesAction,
  getPositionsAction,
} from "./actions";

const samplePositions = [{ id: "p1" }] as unknown as Position[];

const exitedPosition: Position = {
  id: "0xpos1",
  strategyId: "s1",
  invested: 100,
  currentValue: 0,
  totalYield: 12,
  available: 0,
  reinvestment: "auto-compound",
  status: "closed",
};

const strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 100,
  tvl: 1_250_000,
  investors: 312,
  estReturn: 7.4,
  rateType: "APY" as const,
  status: "active" as const,
};

describe("getPositionsAction", () => {
  beforeEach(() => {
    mocks.fetchPositions.mockReset();
    mocks.wallet = null;
  });

  it("[R3] returns an empty ok result without a read when not signed in", async () => {
    expect(await getPositionsAction()).toEqual({ ok: true, positions: [] });
    expect(mocks.fetchPositions).not.toHaveBeenCalled();
  });

  it("[R3] returns ok with the mapped positions on success", async () => {
    mocks.wallet = "0xWALLET";
    mocks.fetchPositions.mockResolvedValue(samplePositions);
    expect(await getPositionsAction()).toEqual({ ok: true, positions: samplePositions });
    expect(mocks.fetchPositions).toHaveBeenCalledWith("0xWALLET", mocks.authHeader);
  });

  it.each([
    408, 429, 502, 503, 504, 0,
  ])("[R3] classifies a %s failure as retryable", async (status) => {
    mocks.wallet = "0xWALLET";
    mocks.fetchPositions.mockRejectedValue(new ApiError(status, "X", "transient"));
    expect(await getPositionsAction()).toEqual({ ok: false, retryable: true });
  });

  it.each([
    400, 401, 403, 404, 500,
  ])("[R3] classifies a %s failure as non-retryable", async (status) => {
    mocks.wallet = "0xWALLET";
    mocks.fetchPositions.mockRejectedValue(new ApiError(status, "X", "hard"));
    expect(await getPositionsAction()).toEqual({ ok: false, retryable: false });
  });

  it("[R3] classifies a schema/parse error as non-retryable", async () => {
    mocks.wallet = "0xWALLET";
    mocks.fetchPositions.mockRejectedValue(new ApiParseError("drift", []));
    expect(await getPositionsAction()).toEqual({ ok: false, retryable: false });
  });
});

describe("getInvestorPortfolioSeriesAction", () => {
  beforeEach(() => {
    mocks.fetchInvestorPortfolioTimeseries.mockReset();
    mocks.wallet = "0xWALLET";
  });

  // @rule POO-367 R1: the per-investor series is read for the signed-in wallet (session-derived).
  it("[R1] reads the series for the session wallet and returns it", async () => {
    const series = [
      { date: "2026-06-19T00:00:00.000Z", value_usd: 100 },
      { date: "2026-06-20T00:00:00.000Z", value_usd: 110 },
    ];
    mocks.fetchInvestorPortfolioTimeseries.mockResolvedValue(series);

    expect(await getInvestorPortfolioSeriesAction()).toEqual(series);
    expect(mocks.fetchInvestorPortfolioTimeseries).toHaveBeenCalledWith("0xWALLET");
  });

  // @rule POO-367 R2/R3: not signed in → [] without a read → the caller falls back to honest-empty.
  it("[R2] returns [] without a read when not signed in", async () => {
    mocks.wallet = null;
    expect(await getInvestorPortfolioSeriesAction()).toEqual([]);
    expect(mocks.fetchInvestorPortfolioTimeseries).not.toHaveBeenCalled();
  });
});

describe("getClosedStrategiesAction (real mode)", () => {
  beforeEach(() => {
    mocks.wallet = "0xWALLET";
    mocks.fetchPositions.mockReset();
    mocks.listExited.mockReset();
    mocks.listStrategiesForHoldings.mockReset();
  });

  // @rule POO-476: in real mode the exited history reads the live feed with closed=exited,
  // forwarding the session wallet + auth header, and never falls back to the mock fixture.
  it('[POO-476] reads fetchPositions(wallet, auth, "exited") and joins the result', async () => {
    mocks.fetchPositions.mockResolvedValue([exitedPosition]);
    mocks.listStrategiesForHoldings.mockResolvedValue([strategy]);

    const result = await getClosedStrategiesAction();

    // Real-mode branch ran: the live exited feed, not the mock fixture.
    expect(mocks.listExited).not.toHaveBeenCalled();
    expect(mocks.fetchPositions).toHaveBeenCalledWith("0xWALLET", mocks.authHeader, "exited");
    // Returns the joined { position, strategy } entry.
    expect(result).toEqual([{ position: exitedPosition, strategy }]);
  });

  // @rule POO-526: the exited feed is also closed pools, absent from /pools — an exited position
  // resolves via its own synthesized fallbackStrategy instead of being dropped by the join.
  it("[POO-526] resolves an exited position via its fallbackStrategy when the catalog misses", async () => {
    const synth = { ...strategy, id: "s-gone", status: "closed" as const };
    const orphanExited: Position = {
      ...exitedPosition,
      strategyId: "s-gone",
      fallbackStrategy: synth,
    };
    mocks.fetchPositions.mockResolvedValue([orphanExited]);
    mocks.listStrategiesForHoldings.mockResolvedValue([]); // holdings catalog cannot resolve it

    const result = await getClosedStrategiesAction();

    expect(result).toEqual([{ position: orphanExited, strategy: synth }]);
  });

  // @rule POO-476: not signed in → no exited feed read, empty history (never the mock fixture).
  it("[POO-476] returns [] without reading the feed when not signed in", async () => {
    mocks.wallet = null;

    const result = await getClosedStrategiesAction();

    expect(result).toEqual([]);
    expect(mocks.fetchPositions).not.toHaveBeenCalled();
    expect(mocks.listExited).not.toHaveBeenCalled();
  });
});
