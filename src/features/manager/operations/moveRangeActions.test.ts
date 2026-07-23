/**
 * @id PP-MGR-MOD-001 (POO-310, POO-437)
 * @name Move-range actions tests
 * @implements-rules-version v2
 *
 * Current path (optimize/routing/build) posts the position + ticks with the Bearer; build derives
 * the wallet from the session and forwards the routing payload. Legacy path (POO-437) sizes the swap
 * from the signed-in wallet's position and builds with the simpler body. POO-475: the two BUILD
 * actions return typed data instead of throwing — { ok: true, tx } on success, { ok: false, code,
 * message } on failure (SESSION_MISSING when not signed in, backend code verbatim, SCHEMA_MISMATCH,
 * or SYSTEM_INTERNAL). The read-only optimize/routing/legacy-swap steps keep their own shapes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiParseError } from "@/lib/api/errors";
import type { MoveRangeRoutingResponse } from "@/lib/manager/moveRangeSchemas";
import type { Position } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  wallet: null as string | null,
  authHeader: { Authorization: "Bearer t" } as Record<string, string>,
  positions: [] as Position[],
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: async () => mocks.wallet,
  getAuthHeader: async () => mocks.authHeader,
}));
vi.mock("@/lib/portfolio/fetchPositions", () => ({
  fetchPositions: async () => mocks.positions,
}));

import {
  buildMoveRangeTxAction,
  buildMoveRangeTxLegacyAction,
  computeLegacyMoveRangeSwapAction,
  getMoveRangeRoutingAction,
  optimizeMoveRangeAction,
} from "./moveRangeActions";

const key = {
  network: "arbitrum",
  positionId: "0xpos" as `0x${string}`,
  tickLower: -60_000,
  tickUpper: -54_000,
  slippageTolerance: 0.5,
};

const leg = {
  tokenIn: "0xa",
  tokenOut: "0xb",
  amountIn: "1",
  amountOutMinimum: "0",
  commands: "0x",
  inputs: [],
  deadline: "9999",
};

const routing: MoveRangeRoutingResponse = {
  zeroForOneUniversalSwapParams: leg,
  oneForZeroUniversalSwapParams: leg,
  multihopSwapPathZeroForOne: "0x",
  multihopSwapPathOneForZero: "0x",
  swapZeroForOneAmount: "1000",
  swapOneForZeroAmount: "0",
  swapZeroForOneMinOut: "990",
  swapOneForZeroMinOut: "0",
  swapZeroForOneExpectedOut: "1000",
  swapOneForZeroExpectedOut: "0",
  sqrtPriceX96After: "123",
  expectedUtilization: { token0: 99, token1: 99 },
};

/** A managed position with the raw on-chain state the legacy swap sizing reads. */
function position(over: Partial<Position> = {}): Position {
  return {
    id: "0xpos",
    strategyId: "0xpos",
    invested: 1,
    currentValue: 1,
    totalYield: 0,
    available: 1,
    reinvestment: "manual-payout",
    status: "active",
    // 1 token0, no token1, price 100 (tick 46054 at 18/18 decimals).
    totalSupply0: "1000000000000000000",
    totalSupply1: "0",
    tickCurrent: 46_054,
    decimals0: 18,
    decimals1: 18,
    ...over,
  };
}

describe("move-range actions", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.wallet = null;
    mocks.positions = [];
  });

  it("optimize posts the position + ticks + optimizer targets with the Bearer", async () => {
    mocks.apiFetch.mockResolvedValue({ swapZeroForOneAmount: "1000", swapOneForZeroAmount: "0" });
    await optimizeMoveRangeAction(key);
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("swap-optimization/optimize-move-range");
    expect(options.body).toMatchObject({
      network: "arbitrum",
      positionId: "0xpos",
      tickLower: -60_000,
      tickUpper: -54_000,
      slippageTolerance: 0.5,
      targetUtilization: 99.99,
      maxIterations: 10,
    });
    expect(options.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("routing posts the optimized swap amounts", async () => {
    mocks.apiFetch.mockResolvedValue(routing);
    await getMoveRangeRoutingAction({
      ...key,
      swapZeroForOneAmount: "1000",
      swapOneForZeroAmount: "0",
    });
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("swap-router/move-range/complete");
    expect(options.body).toMatchObject({
      positionId: "0xpos",
      swapZeroForOneAmount: "1000",
      swapOneForZeroAmount: "0",
    });
  });

  it("build returns ok:false SESSION_MISSING without a network call when not signed in", async () => {
    // @rule R1
    expect(
      await buildMoveRangeTxAction({
        ...key,
        mintSlippageTolerance: 0.5,
        routing,
      }),
    ).toEqual({ ok: false, code: "SESSION_MISSING", message: "Wallet session not established" });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("build returns ok:true and posts the routing payload with the session wallet + Bearer", async () => {
    // @rule R4
    mocks.wallet = "0xWALLET";
    const built = { tx: { to: "0xc", data: "0xd", value: "0" } };
    mocks.apiFetch.mockResolvedValue(built);

    const result = await buildMoveRangeTxAction({ ...key, mintSlippageTolerance: 0.5, routing });

    expect(result).toEqual({ ok: true, tx: built });
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("portfolio/build/move-range-tx");
    expect(options.body).toMatchObject({
      network: "arbitrum",
      wallet: "0xWALLET",
      positionId: "0xpos",
      tickLower: -60_000,
      tickUpper: -54_000,
      slippageTolerance: 0.5,
      mintSlippageTolerance: 0.5,
      swapZeroForOneAmount: "1000",
      sqrtPriceX96After: "123",
      zeroForOneUniversalSwapParams: leg,
      expectedUtilization: { token0: 99, token1: 99 },
    });
    expect(options.headers).toEqual({ Authorization: "Bearer t" });
  });

  const legacyKey = { ...key, tickLower: 34_000, tickUpper: 39_120 }; // new range below current price

  it("[POO-437] legacy compute returns null (no fetch) when not signed in", async () => {
    expect(await computeLegacyMoveRangeSwapAction(legacyKey)).toBeNull();
  });

  it("[POO-437] legacy compute returns null when the position is not in the portfolio", async () => {
    mocks.wallet = "0xWALLET";
    mocks.positions = [];
    expect(await computeLegacyMoveRangeSwapAction(legacyKey)).toBeNull();
  });

  it("[POO-437] legacy compute returns null when the position lacks on-chain state", async () => {
    mocks.wallet = "0xWALLET";
    mocks.positions = [position({ totalSupply0: undefined, tickCurrent: undefined })];
    expect(await computeLegacyMoveRangeSwapAction(legacyKey)).toBeNull();
  });

  it("[POO-437] legacy compute sizes the swap from the signed-in wallet's position", async () => {
    mocks.wallet = "0xWALLET";
    mocks.positions = [position()];
    // New range entirely below the current price → sell all token0 into token1.
    expect(await computeLegacyMoveRangeSwapAction(legacyKey)).toEqual({
      swapZeroForOneAmount: "1000000000000000000",
      swapOneForZeroAmount: "0",
    });
  });

  it("[POO-437] legacy build returns ok:false SESSION_MISSING without a network call when not signed in", async () => {
    // @rule R1
    expect(
      await buildMoveRangeTxLegacyAction({
        ...key,
        swapZeroForOneAmount: "1000000000000000000",
        swapOneForZeroAmount: "0",
      }),
    ).toEqual({ ok: false, code: "SESSION_MISSING", message: "Wallet session not established" });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("[POO-437] legacy build returns ok:true and posts the simple body (no Universal-Router / optimizer fields)", async () => {
    // @rule R4
    mocks.wallet = "0xWALLET";
    const built = { tx: { to: "0xc", data: "0xd", value: "0" } };
    mocks.apiFetch.mockResolvedValue(built);

    const result = await buildMoveRangeTxLegacyAction({
      ...legacyKey,
      swapZeroForOneAmount: "1000000000000000000",
      swapOneForZeroAmount: "0",
    });

    expect(result).toEqual({ ok: true, tx: built });
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("portfolio/build/move-range-tx");
    expect(options.body).toEqual({
      network: "arbitrum",
      wallet: "0xWALLET",
      positionId: "0xpos",
      tickLower: 34_000,
      tickUpper: 39_120,
      slippageTolerance: 0.5,
      swapZeroForOneAmount: "1000000000000000000",
      swapOneForZeroAmount: "0",
    });
    // The current-path fields must NOT be sent for a legacy build.
    expect(options.body).not.toHaveProperty("zeroForOneUniversalSwapParams");
    expect(options.body).not.toHaveProperty("expectedUtilization");
    expect(options.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("[POO-475] build maps an ApiError to ok:false preserving its code and message", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new ApiError(400, "SLIPPAGE_EXCEEDED", "too little received"));
    expect(await buildMoveRangeTxAction({ ...key, mintSlippageTolerance: 0.5, routing })).toEqual({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "too little received",
    });
  });

  it("[POO-475] build maps an ApiParseError to SCHEMA_MISMATCH", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new ApiParseError("bad shape", []));
    expect(
      await buildMoveRangeTxAction({ ...key, mintSlippageTolerance: 0.5, routing }),
    ).toMatchObject({ ok: false, code: "SCHEMA_MISMATCH", message: "bad shape" });
  });

  it("[POO-475] legacy build maps an unknown throw to SYSTEM_INTERNAL", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new Error("boom"));
    expect(
      await buildMoveRangeTxLegacyAction({
        ...legacyKey,
        swapZeroForOneAmount: "1",
        swapOneForZeroAmount: "0",
      }),
    ).toMatchObject({ ok: false, code: "SYSTEM_INTERNAL", message: "Error: boom" });
  });
});
