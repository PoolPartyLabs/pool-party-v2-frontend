/**
 * @id PP-STR-MOD-003 (POO-320)
 * @name useCollectFees tests (real branch)
 * @implements-rules-version v2 (POO-802 rules v1)
 *
 * Drives the real collect via the POO-802 buildSteps handshake: the `build` step builds the tx
 * (positionId + network, Universal-Router pool address on current networks / omitted on legacy) and
 * pauses on the built figures, `confirm:collect` switches chain then signs + sends and resolves the
 * hash; throws on typed build failure / no-network / not-connected.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { networkToChainId } from "@/lib/chains/config";
import type { Position, Strategy } from "@/lib/schemas";
import { classifyTxError } from "@/lib/tx/diagnostics";

const mocks = vi.hoisted(() => ({
  wallets: [] as Array<{
    address: string;
    switchChain: ReturnType<typeof vi.fn>;
    getEthereumProvider: () => Promise<unknown>;
  }>,
  build: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
// POO-892 R5: the tx hooks read the active address for the address-matched wallet lookup;
// undefined keeps the wallets[0] fallback, preserving the existing fixtures.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: undefined }) }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("../operations/collectFeesAction", () => ({ buildCollectFeesTxAction: mocks.build }));
vi.mock("@/lib/tx/sendTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tx/sendTransaction")>();
  // POO-810: the executor now sends via executeBuiltTransactionWithLogs (keeps the receipt logs).
  return { ...actual, executeBuiltTransactionWithLogs: mocks.execute };
});

import { useCollectFees } from "./useCollectFees";

const strategy = (network = "polygon") =>
  ({ id: "s1", network, pool: "0xpool" }) as unknown as Strategy;
const position = { id: "0xpos" } as Position;

const builtTx = {
  tx: { to: "0xc", data: "0xd", value: "0" },
  estimatedGasInUsd: 1.25,
  swapInfo: { priceImpactPercentage: 0.3, protocolFee: 0.4, minAmountInStable: 47.5 },
};

// POO-802 R0: the handshake split — build sets ctx.built (REAL figures pause on the Review),
// confirm only signs + sends. Mirrors useWithdraw.buildSteps / useInvest.
describe("useCollectFees.buildSteps (POO-802 R0)", () => {
  beforeEach(() => {
    mocks.wallets = [
      {
        address: "0xWALLET",
        switchChain: vi.fn().mockResolvedValue(undefined),
        getEthereumProvider: async () => ({ request: vi.fn() }),
      },
    ];
    // POO-475: the build action returns typed data ({ ok: true, tx } | { ok: false, code, message }).
    mocks.build.mockReset().mockResolvedValue({ ok: true, tx: builtTx });
    // POO-810: the confirm send now sends via executeBuiltTransactionWithLogs, returning
    // { hash, logs }; empty logs → decodeReceipt yields decoded = null (the modal R9-falls-back).
    mocks.execute.mockReset().mockResolvedValue({ hash: "0xhash", logs: [] });
  });

  it("returns the [build, confirm:collect] handshake steps", () => {
    const { result } = renderHook(() => useCollectFees());
    const steps = result.current.buildSteps(strategy(), position, 2, false);
    expect(steps.map((step) => step.key)).toEqual(["build", "confirm:collect"]);
  });

  // @rule R0 — the build step sets ctx.built from the REAL server build; nothing signs or sends.
  it("build step calls the server action and yields the built tx", async () => {
    const { result } = renderHook(() => useCollectFees());
    const [build] = result.current.buildSteps(strategy("polygon"), position, 2, true);
    const out = await build?.run({});
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        positionId: "0xpos",
        network: "polygon",
        slippageTolerance: 2,
        collectAsTokenPair: true,
        poolPartyPositionAddress: "0xpool",
      }),
    );
    expect(out).toEqual({ built: builtTx });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  // @rule R3 — the code lands on cause and classifyTxError classifies it end to end.
  it("build step rethrows a typed failure with the code on cause, classified end to end", async () => {
    mocks.build.mockResolvedValue({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "too little received",
    });
    const { result } = renderHook(() => useCollectFees());
    const [build] = result.current.buildSteps(strategy(), position, 2, false);
    const error = await build?.run({}).catch((e) => e);
    expect(error).toMatchObject({
      message: "too little received",
      cause: { code: "SLIPPAGE_EXCEEDED" },
    });
    expect(classifyTxError(error)).toBe("slippage");
  });

  it("build step omits the pool address on a legacy network", async () => {
    const { result } = renderHook(() => useCollectFees());
    const [build] = result.current.buildSteps(strategy("base"), position, 2, false);
    await build?.run({});
    expect(mocks.build.mock.calls[0]?.[0].poolPartyPositionAddress).toBeUndefined();
  });

  it("build step throws when the strategy has no network configured", async () => {
    const { result } = renderHook(() => useCollectFees());
    const [build] = result.current.buildSteps(
      { id: "s1" } as unknown as Strategy,
      position,
      2,
      false,
    );
    await expect(build?.run({})).rejects.toThrow(/no network configured/);
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it("build step throws the SESSION_MISSING message when the build reports no session", async () => {
    mocks.build.mockResolvedValue({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    const { result } = renderHook(() => useCollectFees());
    const [build] = result.current.buildSteps(strategy(), position, 2, false);
    await expect(build?.run({})).rejects.toThrow(/session not established/);
  });

  // @rule R0 — the confirm step only signs + sends the ALREADY-built tx (never re-builds).
  // @rule POO-810 R5 — it also decodes the receipt into ctx.decoded (null on empty logs, R9).
  it("confirm step switches chain, sends the built tx from ctx and resolves hash + decoded", async () => {
    // POO-350: the switch must precede the send, else the tx lands on the wallet's current chain
    // (the Arbitrum default), not the position's network.
    let switchedBeforeSend = false;
    mocks.execute.mockImplementationOnce(async () => {
      switchedBeforeSend = (mocks.wallets[0]?.switchChain.mock.calls.length ?? 0) > 0;
      // POO-810: the send returns { hash, logs }; empty logs → decodeReceipt yields decoded = null.
      return { hash: "0xhash", logs: [] };
    });

    const { result } = renderHook(() => useCollectFees());
    const [, confirm] = result.current.buildSteps(strategy("base"), position, 2, false);
    const out = await confirm?.run({ built: builtTx });
    expect(mocks.wallets[0]?.switchChain).toHaveBeenCalledWith(networkToChainId("base"));
    expect(switchedBeforeSend).toBe(true);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.build).not.toHaveBeenCalled();
    // POO-810 R5: empty receipt logs → decoded is null (the modal R9-falls-back to the claimable).
    expect(out).toEqual({ txHash: "0xhash", decoded: null });
  });

  it("confirm step throws when the tx was not built", async () => {
    const { result } = renderHook(() => useCollectFees());
    const [, confirm] = result.current.buildSteps(strategy(), position, 2, false);
    await expect(confirm?.run({})).rejects.toThrow(/not built/);
  });

  it("confirm step throws when the wallet is not connected", async () => {
    mocks.wallets = [];
    const { result } = renderHook(() => useCollectFees());
    const [, confirm] = result.current.buildSteps(strategy(), position, 2, false);
    await expect(confirm?.run({ built: builtTx })).rejects.toThrow(/Wallet not connected/);
  });
});
