/**
 * @id PP-REW-LIB-009 (POO-853)
 * @name logReferralOperation tests
 * @implements-rules-version v1
 *
 * The server-only referred-tx operation log ([R6]). Rules exercised:
 * - Mock mode: no-op, no session read, no network.
 * - Real mode, no session wallet: no-op.
 * - Real mode, wallet is NOT a referee (no referredBy): no operation POST.
 * - Real mode, referred wallet: POST /referral/operation with the referrer code + session wallet
 *   (never client-supplied) + operation/amountUSD/txHash.
 * - Never throws: a POST failure (or a guard-read failure) is swallowed so the tx UX is unaffected.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getSessionWallet: vi.fn(),
  isMockMode: false,
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) };
});
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: () => mocks.getSessionWallet() }));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.isMockMode;
  },
}));

import { logReferralOperation } from "./logReferralOperation";

/** Assert an operation POST was (or was not) issued, and with what body. */
function operationPostCalls() {
  return mocks.apiFetch.mock.calls.filter(([path]) => path === "referral/operation");
}

const INPUT = { operation: "ADD_LIQUIDITY" as const, amountUsd: 250, txHash: "0xtx" };

describe("logReferralOperation", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.getSessionWallet.mockReset();
    mocks.isMockMode = false;
    mocks.getSessionWallet.mockResolvedValue("0xReferee");
  });

  // @rule R6/R7 (mock mode: no-op, no session read, no network)
  it("is a no-op in mock mode", async () => {
    mocks.isMockMode = true;
    await logReferralOperation(INPUT);
    expect(mocks.getSessionWallet).not.toHaveBeenCalled();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule R6 (no session wallet: no-op)
  it("is a no-op when there is no session wallet", async () => {
    mocks.getSessionWallet.mockResolvedValue(null);
    await logReferralOperation(INPUT);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule R6 (wallet is not a referee: read the record, but do NOT log an operation)
  it("does not log when the wallet has no referredBy (not a referred wallet)", async () => {
    mocks.apiFetch.mockResolvedValueOnce({ wallet: "0xReferee", referredBy: null });
    await logReferralOperation(INPUT);
    expect(operationPostCalls()).toHaveLength(0);
  });

  // @rule R6 (referred wallet: POST with the referrer code + session wallet + operation fields)
  it("logs the operation with the referrer code and session wallet for a referred wallet", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ wallet: "0xReferee", referredBy: { code: "MARIA2026" } }) // guard read
      .mockResolvedValueOnce({ ok: true }); // operation POST

    await logReferralOperation({
      operation: "COLLECT_FEES",
      amountUsd: 12.5,
      txHash: "0xabc",
      positionInfo: { strategyId: "strat-1" },
    });

    const post = operationPostCalls();
    expect(post).toHaveLength(1);
    expect(post[0]?.[1]).toMatchObject({
      method: "POST",
      body: {
        referralCode: "MARIA2026",
        refereeWallet: "0xReferee",
        operation: "COLLECT_FEES",
        amountUSD: 12.5,
        txHash: "0xabc",
        positionInfo: { strategyId: "strat-1" },
      },
    });
  });

  // @rule R6 (never throws: an operation POST failure is swallowed — the tx UX is unaffected)
  it("never throws when the operation POST fails", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ wallet: "0xReferee", referredBy: { code: "MARIA2026" } })
      .mockRejectedValueOnce(new ApiError(500, "SYSTEM_INTERNAL", "boom"));
    await expect(logReferralOperation(INPUT)).resolves.toBeUndefined();
  });

  // @rule R6 (never throws: a guard-read failure is swallowed and skips the log)
  it("never throws when the referral read fails", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(503, "SYSTEM", "blip"));
    await expect(logReferralOperation(INPUT)).resolves.toBeUndefined();
    expect(operationPostCalls()).toHaveLength(0);
  });
});
