/**
 * @id PP-MGR-SCR-004 (POO-311)
 * @name useManagerCollect tests (real branch)
 * @implements-rules-version v2 (POO-802 rules v1)
 *
 * Drives the real managed collect via the POO-802 buildSteps handshake: the `build` step builds the
 * collect-fees tx (positionId + network) and pauses on the built figures, `confirm:collect` signs +
 * sends and resolves the hash; throws on typed build failure or when the wallet is not connected.
 * POO-824: switches the wallet to the position's chain BEFORE sending and threads the target chainId
 * into the executor, else the tx lands on the wallet's current chain.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { networkToChainId } from "@/lib/chains/config";
import { classifyTxError } from "@/lib/tx/diagnostics";

const mocks = vi.hoisted(() => ({
  wallets: [] as Array<{
    address: string;
    getEthereumProvider: () => Promise<unknown>;
    switchChain: ReturnType<typeof vi.fn>;
  }>,
  build: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
// POO-892 R5: the tx hooks read the active address for the address-matched wallet lookup;
// undefined keeps the wallets[0] fallback, preserving the existing fixtures.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: undefined }) }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("@/features/strategies/operations/collectFeesAction", () => ({
  buildCollectFeesTxAction: mocks.build,
}));
vi.mock("@/lib/tx/sendTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tx/sendTransaction")>();
  return { ...actual, executeBuiltTransaction: mocks.execute };
});

import { useManagerCollect } from "./useManagerCollect";

const input = { network: "arbitrum", positionId: "0xpos" };

const builtTx = {
  tx: { to: "0xc", data: "0xd", value: "0" },
  estimatedGasInUsd: 0.8,
  swapInfo: { priceImpactPercentage: 0.2, protocolFee: 0.3, minAmountInStable: 12.4 },
};

// POO-802 R0: the handshake split for the managed collect — build sets ctx.built (REAL figures
// pause on the Review), confirm only signs + sends. Mirrors useCollectFees.buildSteps.
describe("useManagerCollect.buildSteps (POO-802 R0)", () => {
  beforeEach(() => {
    mocks.wallets = [
      {
        address: "0xWALLET",
        getEthereumProvider: async () => ({ request: vi.fn() }),
        switchChain: vi.fn(),
      },
    ];
    mocks.build.mockReset().mockResolvedValue({ ok: true, tx: builtTx });
    mocks.execute.mockReset().mockResolvedValue("0xhash");
  });

  it("returns the [build, confirm:collect] handshake steps", () => {
    const { result } = renderHook(() => useManagerCollect());
    const steps = result.current.buildSteps(input);
    expect(steps.map((step) => step.key)).toEqual(["build", "confirm:collect"]);
  });

  // @rule R0 — the build step sets ctx.built from the REAL server build; nothing signs or sends.
  it("build step calls the server action and yields the built tx", async () => {
    const { result } = renderHook(() => useManagerCollect());
    const [build] = result.current.buildSteps({
      ...input,
      slippageTolerance: 5,
      collectAsTokenPair: true,
    });
    const out = await build?.run({});
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        positionId: "0xpos",
        network: "arbitrum",
        slippageTolerance: 5,
        collectAsTokenPair: true,
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
    const { result } = renderHook(() => useManagerCollect());
    const [build] = result.current.buildSteps(input);
    const error = await build?.run({}).catch((e) => e);
    expect(error).toMatchObject({
      message: "too little received",
      cause: { code: "SLIPPAGE_EXCEEDED" },
    });
    expect(classifyTxError(error)).toBe("slippage");
  });

  it("build step throws the SESSION_MISSING message when the build reports no session", async () => {
    mocks.build.mockResolvedValue({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    const { result } = renderHook(() => useManagerCollect());
    const [build] = result.current.buildSteps(input);
    await expect(build?.run({})).rejects.toThrow(/session not established/);
  });

  // @rule R0 — the confirm step only signs + sends the ALREADY-built tx (never re-builds).
  it("confirm step sends the built tx from ctx and resolves the hash", async () => {
    const { result } = renderHook(() => useManagerCollect());
    const [, confirm] = result.current.buildSteps(input);
    const out = await confirm?.run({ built: builtTx });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(out).toEqual({ txHash: "0xhash" });
  });

  it("confirm step throws when the tx was not built", async () => {
    const { result } = renderHook(() => useManagerCollect());
    const [, confirm] = result.current.buildSteps(input);
    await expect(confirm?.run({})).rejects.toThrow(/not built/);
  });

  it("confirm step throws when the wallet is not connected", async () => {
    mocks.wallets = [];
    const { result } = renderHook(() => useManagerCollect());
    const [, confirm] = result.current.buildSteps(input);
    await expect(confirm?.run({ built: builtTx })).rejects.toThrow(/Wallet not connected/);
  });

  it("[POO-824 R2] switches the wallet to the position's chain before sending", async () => {
    let switchedBeforeSend = false;
    mocks.execute.mockImplementationOnce(async () => {
      switchedBeforeSend = (mocks.wallets[0]?.switchChain.mock.calls.length ?? 0) > 0;
      return "0xhash";
    });

    const { result } = renderHook(() => useManagerCollect());
    const [, confirm] = result.current.buildSteps({ ...input, network: "base" });
    await confirm?.run({ built: builtTx });

    expect(mocks.wallets[0]?.switchChain).toHaveBeenCalledWith(networkToChainId("base"));
    // The switch must precede the send, else the tx lands on the wallet's current chain (the
    // Arbitrum default), not the position's network (POO-824, mirrors POO-350).
    expect(switchedBeforeSend).toBe(true);
    // The executor also receives the target chain for the broadcast-time assertion (POO-824 R1).
    expect(mocks.execute.mock.calls[0]?.[3]).toBe(networkToChainId("base"));
  });

  it("[POO-824 R2] throws on an unsupported network without sending", async () => {
    const { result } = renderHook(() => useManagerCollect());
    const [, confirm] = result.current.buildSteps({ ...input, network: "solana" });
    await expect(confirm?.run({ built: builtTx })).rejects.toThrow(/Unsupported network/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
