/**
 * @id PP-MGR-SCR-002 (POO-306 / POO-315)
 * @name Create-pool build-tx action tests
 * @implements-rules-version v1
 *
 * Computes the mint mins server-side (pool state + SDK) then posts the permit batch + signature with
 * the session wallet + Bearer. POO-475: returns typed data instead of throwing — { ok: true, tx } on
 * success, { ok: false, code, message } on failure (SESSION_MISSING when not signed in; the pre-flight
 * UNSUPPORTED_NETWORK / POOL_NOT_FOUND ApiErrors, an upstream ApiError, a parse error, or any other
 * throw all surface as data with their code).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiParseError } from "@/lib/api/errors";
import type { SerializedPermitBatch } from "@/lib/tx/permit2";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  wallet: null as string | null,
  authHeader: { Authorization: "Bearer t" } as Record<string, string>,
  poolState: {
    feeTier: 3000,
    currency0: { address: "0xt0", decimals: 18 },
    currency1: { address: "0xt1", decimals: 6 },
    sqrtPriceX96: "0",
    liquidity: "0",
    tickCurrent: 0,
  } as unknown,
  mins: { amount0Min: "990", amount1Min: "1980" },
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: async () => mocks.wallet,
  getAuthHeader: async () => mocks.authHeader,
}));
vi.mock("@/lib/manager/dexPoolState", () => ({ fetchDexPoolState: async () => mocks.poolState }));
vi.mock("@/lib/manager/mintAmounts", () => ({ mintAmountsWithSlippage: () => mocks.mins }));

import { buildCreatePoolTxAction } from "./createPoolAction";

const permitBatch: SerializedPermitBatch = {
  details: [
    { token: "0xt0", amount: "1000", expiration: 9999, nonce: 0 },
    { token: "0xt1", amount: "2000", expiration: 9999, nonce: 0 },
  ],
  spender: "0xmgr",
  sigDeadline: "8888",
};

const input = {
  network: "arbitrum",
  feeTier: 3000,
  currency0: "0xt0",
  currency1: "0xt1",
  tickLower: -887220,
  tickUpper: 887220,
  amount0: "1000",
  amount1: "2000",
  permitBatch,
  signature: "0xsig",
  featureSettings: { name: "My Pool", description: "thesis", poolManagerFee: 10 },
};

describe("buildCreatePoolTxAction", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.wallet = null;
  });

  it("returns ok:false SESSION_MISSING without a network call when not signed in", async () => {
    // @rule R1
    expect(await buildCreatePoolTxAction(input)).toEqual({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("returns ok:true and posts the create-pool request with the server-computed mins + wallet + Bearer", async () => {
    // @rule R4
    mocks.wallet = "0xWALLET";
    const built = { tx: { to: "0xc", data: "0xd", value: "0" } };
    mocks.apiFetch.mockResolvedValue(built);

    const result = await buildCreatePoolTxAction(input);

    expect(result).toEqual({ ok: true, tx: built });
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("portfolio/build/create-pool-tx");
    expect(options.body).toMatchObject({
      network: "arbitrum",
      wallet: "0xWALLET",
      feeTier: 3000,
      tickLower: -887220,
      tickUpper: 887220,
      permitBatch,
      signature: "0xsig",
      // POO-315: position-aware mins computed server-side (not a flat haircut).
      amount0Min: "990",
      amount1Min: "1980",
      // POO-525 R1: the defensive server-side fallback is the create-pool default (2%) when the
      // caller omits a tolerance (was 1% under POO-463 R3).
      slippageTolerance: 2,
      featureSettings: {
        name: "My Pool",
        description: "thesis",
        poolManagerFee: 10,
        hiddenFields: { showPriceRange: true, showTokenPair: true, showInOutRange: true },
      },
    });
    expect(options.headers).toEqual({ Authorization: "Bearer t" });
  });

  // POO-547: create-pool joins the uniform 0.1-100% range, so the server clamp ceiling is now the
  // shared SLIPPAGE_MAX (100), not the old 5% create-pool cap. A within-range value passes through;
  // only a tampered value above 100 is clamped (PP-SECURITY, PP-INTEGRATION-POINT POO-551 verifies
  // the backend accepts the full range).
  it("passes a within-range slippageTolerance (>5%) through to the build (POO-547)", async () => {
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue({ tx: { to: "0xc", data: "0xd", value: "0" } });

    await buildCreatePoolTxAction({ ...input, slippageTolerance: 50 });

    const [, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    // 50% is within the uniform range now (old behavior clamped it to the 5% cap).
    expect(options.body).toMatchObject({ slippageTolerance: 50 });
  });

  it("clamps a tampered over-100 slippageTolerance to the 100 ceiling server-side (PP-SECURITY)", async () => {
    // @rule POO-547 R1 — a client still cannot push the mint-min slippage above the shared 100 max.
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue({ tx: { to: "0xc", data: "0xd", value: "0" } });

    await buildCreatePoolTxAction({ ...input, slippageTolerance: 150 });

    const [, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.body).toMatchObject({ slippageTolerance: 100 });
  });

  // @rule POO-878 R5: the chosen wrapped-native funding source rides the build body so the API can
  // set tx.value accordingly (native msg.value vs Permit2 WETH/WPOL pull).
  it("forwards wrappedNativeFunding to the build body when provided", async () => {
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue({ tx: { to: "0xc", data: "0xd", value: "0" } });

    await buildCreatePoolTxAction({ ...input, wrappedNativeFunding: "erc20" });

    const [, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.body).toMatchObject({ wrappedNativeFunding: "erc20" });
  });

  // @rule POO-878 R5: back-compat — when the caller omits the choice the field is not sent, so the API
  // keeps its native-default behavior (no forced value change).
  it("omits wrappedNativeFunding from the body when not provided", async () => {
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue({ tx: { to: "0xc", data: "0xd", value: "0" } });

    await buildCreatePoolTxAction(input);

    const [, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.body).not.toHaveProperty("wrappedNativeFunding");
  });

  it("coerces a null description to an empty string (the API validates it as a string)", async () => {
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockResolvedValue({ tx: { to: "0xc", data: "0xd", value: "0" } });

    await buildCreatePoolTxAction({
      ...input,
      featureSettings: { name: "My Pool", description: null, poolManagerFee: 10 },
    });

    const [, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(
      (options.body as { featureSettings: { description: unknown } }).featureSettings.description,
    ).toBe("");
  });

  it("maps an upstream ApiError to ok:false preserving its code and message", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(
      new ApiError(400, "SLIPPAGE_EXCEEDED", "price slippage check"),
    );
    expect(await buildCreatePoolTxAction(input)).toEqual({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "price slippage check",
    });
  });

  it("maps the pre-flight POOL_NOT_FOUND ApiError to ok:false (not a throw)", async () => {
    // @rule R2 — a pre-flight ApiError (before the build POST) surfaces as data too.
    mocks.wallet = "0xWALLET";
    const original = mocks.poolState;
    mocks.poolState = null;
    try {
      expect(await buildCreatePoolTxAction(input)).toEqual({
        ok: false,
        code: "POOL_NOT_FOUND",
        message: "Could not read the pool state for the mint mins",
      });
      expect(mocks.apiFetch).not.toHaveBeenCalled();
    } finally {
      mocks.poolState = original;
    }
  });

  it("maps an ApiParseError to SCHEMA_MISMATCH", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new ApiParseError("bad shape", []));
    expect(await buildCreatePoolTxAction(input)).toMatchObject({
      ok: false,
      code: "SCHEMA_MISMATCH",
      message: "bad shape",
    });
  });

  it("maps an unknown throw to SYSTEM_INTERNAL", async () => {
    // @rule R2
    mocks.wallet = "0xWALLET";
    mocks.apiFetch.mockRejectedValue(new Error("boom"));
    expect(await buildCreatePoolTxAction(input)).toMatchObject({
      ok: false,
      code: "SYSTEM_INTERNAL",
      message: "Error: boom",
    });
  });
});
