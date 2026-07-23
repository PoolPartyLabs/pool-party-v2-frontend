/**
 * @id PP-MGR-SCR-002 (POO-306 / POO-314)
 * @name useCreatePool tests (real branch)
 * @implements-rules-version v1
 *
 * Real mode: throws when the manager contract is unconfigured, approves a token only when its
 * allowance is below the seed amount, builds with feeTier = feeBps×100 + full-range ticks, signs +
 * sends, and throws when the build returns null.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyTxError } from "@/lib/tx/diagnostics";

const mocks = vi.hoisted(() => ({
  wallets: [] as Array<{
    address: string;
    getEthereumProvider: () => Promise<unknown>;
    switchChain: (chainId: number) => Promise<void>;
  }>,
  signTypedData: vi.fn(async () => ({ signature: "0xsig" })),
  managerAddress: "0xMANAGER" as string | null,
  allowance: BigInt(0),
  approveTx: vi.fn(() => ({ tx: { to: "0xusdc", data: "0xapprove" } })),
  build: vi.fn(),
  execute: vi.fn(),
  executeWithReceipt: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
// POO-892 R5: the tx hooks read the active address for the address-matched wallet lookup;
// undefined keeps the wallets[0] fallback, preserving the existing fixtures.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: undefined }) }));
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: mocks.wallets }),
  useSignTypedData: () => ({ signTypedData: mocks.signTypedData }),
}));
vi.mock("@/lib/manager/managerContracts", () => ({
  poolPartyManagerAddress: () => mocks.managerAddress,
}));
vi.mock("@/lib/tx/permit2", () => ({
  readPermit2TokenAllowance: async () => mocks.allowance,
  readPermit2Nonce: async () => 0,
  buildPermit2ApproveTx: mocks.approveTx,
  buildPermitBatch: (a: unknown, b: unknown, spender: unknown) => ({ a, b, spender }),
  permitBatchTypedData: () => ({}),
  serializePermitBatch: () => ({ details: [], spender: "0xMANAGER", sigDeadline: "0" }),
}));
vi.mock("../operations/createPoolAction", () => ({ buildCreatePoolTxAction: mocks.build }));
vi.mock("@/lib/tx/sendTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tx/sendTransaction")>();
  return {
    ...actual,
    executeBuiltTransaction: mocks.execute,
    executeBuiltTransactionWithReceipt: mocks.executeWithReceipt,
  };
});

import { useCreatePool } from "./useCreatePool";

const input = {
  network: "arbitrum",
  feeBps: 5,
  token0: "0xt0" as `0x${string}`,
  amount0: BigInt(1000),
  token1: "0xt1" as `0x${string}`,
  amount1: BigInt(2000),
  featureSettings: { name: "My Strategy", description: null, poolManagerFee: 20 },
};

describe("useCreatePool (real mode)", () => {
  beforeEach(() => {
    mocks.wallets = [
      {
        address: "0xWALLET",
        getEthereumProvider: async () => ({ request: vi.fn() }),
        switchChain: async () => {},
      },
    ];
    mocks.managerAddress = "0xMANAGER";
    mocks.allowance = BigInt(0);
    mocks.approveTx.mockClear();
    // POO-475: the build action returns typed data ({ ok: true, tx } | { ok: false, code, message }).
    mocks.build.mockReset().mockResolvedValue({ ok: true, tx: { to: "0xc", data: "0xd" } });
    mocks.execute.mockReset().mockResolvedValue("0xhash");
    // POO-308: the final send now resolves the mined block too (for POO-638 convergence).
    mocks.executeWithReceipt.mockReset().mockResolvedValue({ hash: "0xhash", blockNumber: 100 });
  });

  it("throws when the manager contract is not configured", async () => {
    mocks.managerAddress = null;
    const { result } = renderHook(() => useCreatePool());
    await expect(result.current.execute(input)).rejects.toThrow(/not configured/);
  });

  it("approves each token (allowance below amount), builds with feeTier×100 + full range, sends", async () => {
    const { result } = renderHook(() => useCreatePool());
    const out = await result.current.execute(input);

    // Allowance 0 < amounts → both tokens approved before building.
    expect(mocks.approveTx).toHaveBeenCalledTimes(2);
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "arbitrum",
        feeTier: 500, // 5 bps × 100
        tickLower: -887270,
        tickUpper: 887270,
        // POO-315: raw amounts + currencies (the action computes mins server-side).
        currency0: "0xt0",
        currency1: "0xt1",
        amount0: "1000",
        amount1: "2000",
        // POO-525 R1: when the caller omits a tolerance the build defaults to the create-pool 2%
        // (was a hardcoded 0.5).
        slippageTolerance: 2,
        featureSettings: expect.objectContaining({ name: "My Strategy", poolManagerFee: 20 }),
      }),
    );
    // POO-308: the send uses the receipt-returning variant so the block reaches the flow context.
    expect(mocks.executeWithReceipt).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ hash: "0xhash" });
  });

  // @rule POO-878 R5: the run input's wrapped-native funding choice threads through to the build action
  // (SeedState -> ReviewStep -> CreatePoolRunInput -> buildCreatePoolTxAction).
  it("threads wrappedNativeFunding from the run input into the build action", async () => {
    const { result } = renderHook(() => useCreatePool());
    await result.current.execute({ ...input, wrappedNativeFunding: "erc20" });
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({ wrappedNativeFunding: "erc20" }),
    );
  });

  it("skips approval when allowance already covers the amount", async () => {
    mocks.allowance = BigInt(1_000_000);
    const { result } = renderHook(() => useCreatePool());
    await result.current.execute(input);
    expect(mocks.approveTx).not.toHaveBeenCalled();
  });

  it("throws the SESSION_MISSING message when the build reports no session", async () => {
    mocks.build.mockResolvedValue({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    const { result } = renderHook(() => useCreatePool());
    await expect(result.current.execute(input)).rejects.toThrow(/session not established/);
  });

  it("throws a TransactionError carrying the failure code on cause, classified end to end", async () => {
    // @rule R3
    mocks.build.mockResolvedValue({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "too little received",
    });
    const { result } = renderHook(() => useCreatePool());
    const error = await result.current.execute(input).catch((e) => e);
    expect(error).toMatchObject({
      message: "too little received",
      cause: { code: "SLIPPAGE_EXCEEDED" },
    });
    expect(classifyTxError(error)).toBe("slippage");
  });
});
