/**
 * @id PP-STR-MOD-001 (POO-303)
 * @name Invest build-tx action tests
 * @implements-rules-version v1
 *
 * Posts the signed permit + signature with the session wallet + Bearer. POO-475: returns typed data
 * instead of throwing across the RSC boundary — { ok: true, tx } on success, { ok: false, code,
 * message } on failure (SESSION_MISSING when not signed in, backend code verbatim for an ApiError,
 * SCHEMA_MISMATCH for a parse error, SYSTEM_INTERNAL otherwise).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiParseError } from "@/lib/api/errors";
import type { SerializedPermitSingle } from "@/lib/tx/permit2";

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

import { buildAddLiquidityTxAction } from "./investActions";

const permit: SerializedPermitSingle = {
  details: { token: "0xusdc", amount: "1000000", expiration: "9999", nonce: "3" },
  spender: "0xpool",
  sigDeadline: "8888",
};

const input = {
  positionId: "0xpos",
  network: "polygon",
  permit,
  signature: "0xsig",
};

describe("buildAddLiquidityTxAction", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.wallet = null;
  });

  it("returns ok:false SESSION_MISSING without a network call when not signed in", async () => {
    // @rule R1
    const result = await buildAddLiquidityTxAction(input);
    expect(result).toEqual({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("returns ok:true with the built tx on success", async () => {
    // @rule R4
    mocks.wallet = "0xWALLET";
    const built = { tx: { to: "0xc", data: "0xd", value: "0" } };
    mocks.apiFetch.mockResolvedValue(built);

    const result = await buildAddLiquidityTxAction({
      ...input,
      poolPartyPositionAddress: "0xpool",
    });

    expect(result).toEqual({ ok: true, tx: built });
  });

  it("sends the same request body as before (positionId, permit, slippageTolerance)", async () => {
    // @rule R4
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue({ tx: { to: "0xc", data: "0xd", value: "0" } });

    await buildAddLiquidityTxAction({ ...input, poolPartyPositionAddress: "0xpool" });

    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("portfolio/build/add-liquidity-tx");
    expect(options.body).toMatchObject({
      network: "polygon",
      wallet: "0xWALLET",
      positionId: "0xpos",
      permit,
      signature: "0xsig",
      // POO-463 R3: the defensive server-side fallback is 1% when the caller omits a tolerance.
      slippageTolerance: 1,
      poolPartyPositionAddress: "0xpool",
    });
    expect(options.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("omits poolPartyPositionAddress when not provided", async () => {
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue({ tx: { to: "0xc", data: "0xd" } });
    await buildAddLiquidityTxAction({ ...input, network: "base" });
    const [, options] = mocks.apiFetch.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).not.toHaveProperty("poolPartyPositionAddress");
  });

  it("maps an ApiError to ok:false preserving its code and message", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(
      new ApiError(400, "SLIPPAGE_EXCEEDED", "price slippage check failed"),
    );
    const result = await buildAddLiquidityTxAction(input);
    expect(result).toEqual({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "price slippage check failed",
    });
  });

  it("maps an ApiParseError to SCHEMA_MISMATCH", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new ApiParseError("bad shape", []));
    const result = await buildAddLiquidityTxAction(input);
    expect(result).toMatchObject({ ok: false, code: "SCHEMA_MISMATCH", message: "bad shape" });
  });

  it("maps an unknown throw to SYSTEM_INTERNAL", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new Error("boom"));
    const result = await buildAddLiquidityTxAction(input);
    expect(result).toMatchObject({ ok: false, code: "SYSTEM_INTERNAL", message: "Error: boom" });
  });
});
