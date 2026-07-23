/**
 * @id PP-MGR-MOD (POO-312)
 * @name Close-pool action tests
 * @implements-rules-version v2
 *
 * Posts the close-pool request with the session wallet + Bearer. POO-475: returns typed data instead
 * of throwing — { ok: true, tx } on success, { ok: false, code, message } on failure (SESSION_MISSING
 * when not signed in, backend code verbatim, SCHEMA_MISMATCH, or SYSTEM_INTERNAL). POO-509 (v2): the
 * close always posts the token pair (swapAllToStableCurrency:false, hard-set — no input flag).
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

import { buildClosePoolTxAction } from "./closePoolAction";

const input = { positionId: "0xpos", network: "arbitrum" };

describe("buildClosePoolTxAction", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.wallet = null;
  });

  it("returns ok:false SESSION_MISSING without a network call when not signed in", async () => {
    // @rule R1
    expect(await buildClosePoolTxAction(input)).toEqual({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("returns ok:true and posts the close-pool request as token-pair (swapAllToStableCurrency:false) with wallet + Bearer", async () => {
    // @rule R4 — POO-509: a close always builds the token pair; swapAllToStableCurrency is hard-false.
    mocks.wallet = "0xWALLET";
    const built = { tx: { to: "0xc", data: "0xd" } };
    mocks.apiFetch.mockResolvedValue(built);

    const result = await buildClosePoolTxAction(input);

    expect(result).toEqual({ ok: true, tx: built });
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("portfolio/build/close-pool-tx");
    expect(options.body).toMatchObject({
      network: "arbitrum",
      wallet: "0xWALLET",
      positionId: "0xpos",
      slippageTolerance: 1,
      swapAllToStableCurrency: false,
    });
    expect(options.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("maps an ApiError to ok:false preserving its code and message", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new ApiError(401, "NOT_AUTHORIZED", "only pool manager"));
    expect(await buildClosePoolTxAction(input)).toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
      message: "only pool manager",
    });
  });

  it("maps an ApiParseError to SCHEMA_MISMATCH", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new ApiParseError("bad shape", []));
    expect(await buildClosePoolTxAction(input)).toMatchObject({
      ok: false,
      code: "SCHEMA_MISMATCH",
      message: "bad shape",
    });
  });

  it("maps an unknown throw to SYSTEM_INTERNAL", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new Error("boom"));
    expect(await buildClosePoolTxAction(input)).toMatchObject({
      ok: false,
      code: "SYSTEM_INTERNAL",
      message: "Error: boom",
    });
  });
});
