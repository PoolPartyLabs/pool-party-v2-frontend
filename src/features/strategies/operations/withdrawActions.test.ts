/**
 * @id PP-STR-MOD-004 (POO-302)
 * @name Withdraw build-tx action tests
 * @implements-rules-version v1
 *
 * remove-liquidity (percentage) and withdraw (full) post the session wallet + Bearer. POO-475: both
 * return typed data instead of throwing — { ok: true, tx } on success, { ok: false, code, message }
 * on failure (SESSION_MISSING when not signed in, backend code verbatim, SCHEMA_MISMATCH, or
 * SYSTEM_INTERNAL).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiParseError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  wallet: null as string | null,
  authHeader: { Authorization: "Bearer t" } as Record<string, string>,
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: async () => mocks.wallet,
  getAuthHeader: async () => mocks.authHeader,
}));

import { buildRemoveLiquidityTxAction, buildWithdrawTxAction } from "./withdrawActions";

const built = { tx: { to: "0xc", data: "0xd", value: "0" } };
const SESSION_MISSING = {
  ok: false,
  code: "SESSION_MISSING",
  message: "Wallet session not established",
};

describe("withdraw build-tx actions", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.wallet = null;
  });

  it("return ok:false SESSION_MISSING without a network call when not signed in", async () => {
    // @rule R1
    expect(await buildWithdrawTxAction({ positionId: "0xp", network: "base" })).toEqual(
      SESSION_MISSING,
    );
    expect(
      await buildRemoveLiquidityTxAction({ positionId: "0xp", network: "base", percentage: 50 }),
    ).toEqual(SESSION_MISSING);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("buildWithdrawTxAction returns ok:true and posts the full-exit request", async () => {
    // @rule R4
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue(built);

    const result = await buildWithdrawTxAction({ positionId: "0xpos", network: "arbitrum" });

    expect(result).toEqual({ ok: true, tx: built });
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("portfolio/build/withdraw-tx");
    expect(options.body).toMatchObject({
      network: "arbitrum",
      wallet: "0xWALLET",
      positionId: "0xpos",
      // POO-463 R3: the defensive server-side fallback is 1% when the caller omits a tolerance.
      slippageTolerance: 1,
      shouldSwapFees: true,
    });
    expect(options.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("[POO-481 R4] buildWithdrawTxAction honors shouldSwapFees=false (receive as the pair)", async () => {
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue(built);

    await buildWithdrawTxAction({
      positionId: "0xpos",
      network: "arbitrum",
      shouldSwapFees: false,
    });

    const [, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.body).toMatchObject({ shouldSwapFees: false });
  });

  it("buildRemoveLiquidityTxAction returns ok:true and posts the percentage", async () => {
    // @rule R4
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue(built);

    const result = await buildRemoveLiquidityTxAction({
      positionId: "0xpos",
      network: "base",
      percentage: 40,
    });

    expect(result).toEqual({ ok: true, tx: built });
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("portfolio/build/remove-liquidity-tx");
    expect(options.body).toMatchObject({
      percentage: 40,
      wallet: "0xWALLET",
      shouldSwapFees: true,
    });
  });

  it("maps an ApiError to ok:false preserving its code and message", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new ApiError(400, "SLIPPAGE_EXCEEDED", "too little received"));
    expect(await buildWithdrawTxAction({ positionId: "0xp", network: "base" })).toEqual({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "too little received",
    });
  });

  it("maps an ApiParseError to SCHEMA_MISMATCH", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new ApiParseError("bad shape", []));
    expect(
      await buildRemoveLiquidityTxAction({ positionId: "0xp", network: "base", percentage: 50 }),
    ).toMatchObject({ ok: false, code: "SCHEMA_MISMATCH", message: "bad shape" });
  });

  it("maps an unknown throw to SYSTEM_INTERNAL", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new Error("boom"));
    expect(await buildWithdrawTxAction({ positionId: "0xp", network: "base" })).toMatchObject({
      ok: false,
      code: "SYSTEM_INTERNAL",
      message: "Error: boom",
    });
  });
});
