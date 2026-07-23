/**
 * @id PP-STR-MOD-003 (POO-301)
 * @name Collect-fees build-tx action tests
 * @implements-rules-version v1
 *
 * Derives the wallet from the session; posts to the build endpoint. POO-475: returns typed data
 * instead of throwing — { ok: true, tx } on success, { ok: false, code, message } on failure
 * (SESSION_MISSING when not signed in, backend code verbatim, SCHEMA_MISMATCH, or SYSTEM_INTERNAL).
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

import { buildCollectFeesTxAction } from "./collectFeesAction";

describe("buildCollectFeesTxAction", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.wallet = null;
  });

  it("returns ok:false SESSION_MISSING without a network call when not signed in", async () => {
    // @rule R1
    expect(await buildCollectFeesTxAction({ positionId: "0xp", network: "arbitrum" })).toEqual({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("returns ok:true with the built tx and posts the build request with wallet + Bearer", async () => {
    // @rule R4
    mocks.wallet = "0xWALLET";
    const built = { tx: { to: "0xc", data: "0xd", value: "0" } };
    mocks.apiFetch.mockResolvedValue(built);

    const result = await buildCollectFeesTxAction({ positionId: "0xpos", network: "base" });

    expect(result).toEqual({ ok: true, tx: built });
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("portfolio/build/collect-fees-tx");
    expect(options.method).toBe("POST");
    expect(options.body).toMatchObject({
      network: "base",
      wallet: "0xWALLET",
      positionId: "0xpos",
      // POO-463 R3: the defensive server-side fallback is 1% when the caller omits a tolerance.
      slippageTolerance: 1,
      shouldSwapFees: true,
    });
    expect(options.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("[POO-417 R2] sends shouldSwapFees=false when collecting as the token pair", async () => {
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue({ tx: { to: "0xc", data: "0xd", value: "0" } });

    await buildCollectFeesTxAction({
      positionId: "0xpos",
      network: "base",
      collectAsTokenPair: true,
    });

    const [, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.body).toMatchObject({ shouldSwapFees: false });
  });

  it("[POO-417 R2] defaults to shouldSwapFees=true (swap to USDC) when the pair flag is absent", async () => {
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue({ tx: { to: "0xc", data: "0xd", value: "0" } });

    await buildCollectFeesTxAction({ positionId: "0xpos", network: "base" });

    const [, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.body).toMatchObject({ shouldSwapFees: true });
  });

  it("maps an ApiError to ok:false preserving its code and message", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(
      new ApiError(400, "SLIPPAGE_EXCEEDED", "price slippage check"),
    );
    expect(await buildCollectFeesTxAction({ positionId: "0xp", network: "base" })).toEqual({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "price slippage check",
    });
  });

  it("maps an ApiParseError to SCHEMA_MISMATCH", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new ApiParseError("bad shape", []));
    expect(await buildCollectFeesTxAction({ positionId: "0xp", network: "base" })).toMatchObject({
      ok: false,
      code: "SCHEMA_MISMATCH",
      message: "bad shape",
    });
  });

  it("maps an unknown throw to SYSTEM_INTERNAL", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new Error("boom"));
    expect(await buildCollectFeesTxAction({ positionId: "0xp", network: "base" })).toMatchObject({
      ok: false,
      code: "SYSTEM_INTERNAL",
      message: "Error: boom",
    });
  });
});
