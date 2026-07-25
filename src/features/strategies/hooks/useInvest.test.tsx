/**
 * @id PP-STR-MOD-001 (POO-320)
 * @name useInvest tests (real branch)
 * @implements-rules-version v1
 *
 * Approves USDC to Permit2 only when the allowance is below the deposit, signs a Permit2 single,
 * builds add-liquidity (Universal-Router pool address on current networks / omitted on legacy),
 * sends, and resolves the hash. Throws on missing config / not-connected / null-build.
 */
import { renderHook } from "@testing-library/react";
import { parseUnits } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import { classifyTxError } from "@/lib/tx/diagnostics";

const mocks = vi.hoisted(() => ({
  activeAddress: undefined as string | undefined,
  wallets: [] as Array<{
    address: string;
    getEthereumProvider: () => Promise<unknown>;
    switchChain: (chainId: number) => Promise<void>;
  }>,
  signTypedData: vi.fn(async () => ({ signature: "0xsig" })),
  // POO-1043 [R3]: every `buildPermitSingle(token, spender, amount, nonce)` call, so the signed
  // amount can be asserted.
  buildPermitSingleCalls: [] as unknown[][],
  allowance: BigInt(0),
  approveTx: vi.fn(() => ({ tx: { to: "0xusdc", data: "0xapprove" } })),
  build: vi.fn(),
  // The approve step sends via executeBuiltTransaction (hash only); the confirm step (POO-810) sends
  // via executeBuiltTransactionWithLogs (keeps the receipt logs to decode the real deployed).
  execute: vi.fn(),
  executeWithLogs: vi.fn(),
  recordLedger: vi.fn(async () => true),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/manager/managerContracts", () => ({
  poolPartyManagerAddress: () => "0xMANAGER0000000000000000000000000000000",
}));
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: mocks.wallets }),
  useSignTypedData: () => ({ signTypedData: mocks.signTypedData }),
}));
// POO-892 R5: the hooks read the active address for the address-matched wallet lookup.
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.activeAddress }) }));
vi.mock("@/lib/tx/permit2", () => ({
  readPermit2TokenAllowance: async () => mocks.allowance,
  readPermit2Nonce: async () => 0,
  buildPermit2ApproveTx: mocks.approveTx,
  // POO-1043 [R3]: the AMOUNT rides through, so a test can assert what the Permit2 signature is
  // sized against.
  buildPermitSingle: (...args: unknown[]) => {
    mocks.buildPermitSingleCalls.push(args);
    return { token: args[0], spender: args[1], amount: args[2] };
  },
  permitTypedData: () => ({}),
  serializePermit: () => ({ details: {}, spender: "0xpool", sigDeadline: "0" }),
}));
vi.mock("../operations/investActions", () => ({ buildAddLiquidityTxAction: mocks.build }));
// POO-719: the fire-and-forget ledger callback is mocked to assert the wiring only.
vi.mock("@/lib/strategies/v2/recordLiquidityEvent", () => ({
  recordLiquidityEvent: mocks.recordLedger,
}));
vi.mock("@/lib/tx/sendTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tx/sendTransaction")>();
  return {
    ...actual,
    executeBuiltTransaction: mocks.execute,
    executeBuiltTransactionWithLogs: mocks.executeWithLogs,
  };
});

import { useInvest } from "./useInvest";

const strategy = (network = "polygon") =>
  ({ id: "s1", network, pool: "0xpool" }) as unknown as Strategy;

describe("useInvest (real mode)", () => {
  beforeEach(() => {
    mocks.activeAddress = undefined;
    mocks.wallets = [
      {
        address: "0xWALLET",
        getEthereumProvider: async () => ({ request: vi.fn() }),
        switchChain: async () => {},
      },
    ];
    mocks.allowance = BigInt(0);
    mocks.approveTx.mockClear();
    mocks.signTypedData.mockClear();
    mocks.buildPermitSingleCalls = [];
    // POO-475: the build action returns typed data ({ ok: true, tx } | { ok: false, code, message }).
    mocks.build.mockReset().mockResolvedValue({ ok: true, tx: { to: "0xc", data: "0xd" } });
    mocks.execute.mockReset().mockResolvedValue("0xhash"); // approve send (hash only)
    // POO-810: the confirm send returns { hash, logs }; empty logs → decoded is null (full fill).
    mocks.executeWithLogs.mockReset().mockResolvedValue({ hash: "0xhash", logs: [] });
    mocks.recordLedger.mockClear();
  });

  it("approves USDC then builds + sends when the allowance is below the deposit", async () => {
    const { result } = renderHook(() => useInvest());
    const out = await result.current.execute(strategy("polygon"), 100);

    expect(mocks.approveTx).toHaveBeenCalledOnce();
    // The approval sends via executeBuiltTransaction; the add-liquidity tx via ...WithLogs (POO-810).
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.executeWithLogs).toHaveBeenCalledTimes(1);
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: "s1", poolPartyPositionAddress: "0xpool" }),
    );
    expect(out).toEqual({ hash: "0xhash" });
  });

  // @rule POO-719 rules-v2 [R3v2/R5v2]: a confirmed add fires the cost-basis ledger callback with
  // the mined txHash — fire-and-forget, so its failure never fails the flow.
  it("[POO-719] fires the liquidity-event ledger callback after the receipt confirms", async () => {
    const { result } = renderHook(() => useInvest());
    await result.current.execute(strategy("polygon"), 100);

    expect(mocks.recordLedger).toHaveBeenCalledTimes(1);
    expect(mocks.recordLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyRef: "s1",
        txHash: "0xhash",
        network: "polygon",
      }),
    );
  });

  it("[POO-719] a rejected ledger callback never fails the invest flow", async () => {
    mocks.recordLedger.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useInvest());
    const out = await result.current.execute(strategy("polygon"), 100);
    expect(out).toEqual({ hash: "0xhash" });
  });

  // @rule POO-892 R5 - the hook must sign with the wallet matching the ACTIVE address, not wallets[0].
  it("[POO-892 R5] uses the wallet matching the active address, not wallets[0]", async () => {
    const stale = {
      address: "0xOLD",
      getEthereumProvider: async () => ({ request: vi.fn() }),
      switchChain: vi.fn(async () => {}),
    };
    const active = {
      address: "0xWALLET",
      getEthereumProvider: async () => ({ request: vi.fn() }),
      switchChain: vi.fn(async () => {}),
    };
    mocks.wallets = [stale, active];
    mocks.activeAddress = "0xwallet"; // case-insensitive match
    const { result } = renderHook(() => useInvest());
    await result.current.execute(strategy("polygon"), 100);

    // The approve send runs as the ACTIVE wallet's address (executeBuiltTransaction owner arg).
    expect(mocks.execute.mock.calls[0]?.[2]).toBe("0xWALLET");
    expect(active.switchChain).toHaveBeenCalled();
    expect(stale.switchChain).not.toHaveBeenCalled();
  });

  it("skips the approval when the allowance already covers the deposit", async () => {
    mocks.allowance = parseUnits("1000000", 6);
    const { result } = renderHook(() => useInvest());
    await result.current.execute(strategy(), 100);

    expect(mocks.approveTx).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled(); // no approval send
    expect(mocks.executeWithLogs).toHaveBeenCalledTimes(1); // just the add-liquidity tx
  });

  it("omits poolPartyPositionAddress on a legacy network", async () => {
    mocks.allowance = parseUnits("1000000", 6);
    const { result } = renderHook(() => useInvest());
    await result.current.execute(strategy("arbitrum"), 100);
    expect(mocks.build.mock.calls[0]?.[0].poolPartyPositionAddress).toBeUndefined();
  });

  it("throws when the strategy is missing on-chain config", async () => {
    const { result } = renderHook(() => useInvest());
    await expect(result.current.execute({ id: "s1" } as unknown as Strategy, 100)).rejects.toThrow(
      /missing on-chain configuration/,
    );
  });

  it("throws the SESSION_MISSING message when the build reports no session", async () => {
    mocks.allowance = parseUnits("1000000", 6);
    mocks.build.mockResolvedValue({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    const { result } = renderHook(() => useInvest());
    await expect(result.current.execute(strategy(), 100)).rejects.toThrow(
      /session not established/,
    );
  });

  it("throws a TransactionError carrying the failure code on cause when the build returns ok:false", async () => {
    // @rule R3
    mocks.allowance = parseUnits("1000000", 6);
    mocks.build.mockResolvedValue({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "price slippage check failed",
    });
    const { result } = renderHook(() => useInvest());
    await expect(result.current.execute(strategy(), 100)).rejects.toMatchObject({
      message: "price slippage check failed",
      cause: { code: "SLIPPAGE_EXCEEDED" },
    });
  });

  it("classifies a SLIPPAGE_EXCEEDED build failure as slippage end to end", async () => {
    // @rule R3
    mocks.allowance = parseUnits("1000000", 6);
    mocks.build.mockResolvedValue({
      ok: false,
      code: "SLIPPAGE_EXCEEDED",
      message: "the build failed",
    });
    const { result } = renderHook(() => useInvest());
    const error = await result.current.execute(strategy(), 100).catch((e) => e);
    expect(classifyTxError(error)).toBe("slippage");
  });

  it("throws when the wallet is not connected", async () => {
    mocks.wallets = [];
    const { result } = renderHook(() => useInvest());
    await expect(result.current.execute(strategy(), 100)).rejects.toThrow(/Wallet not connected/);
  });

  /**
   * @rule POO-1043 [R3] — Permit2 is sized against the balance ON THE TARGET CHAIN after provisioning
   * settles, never against a cross-chain total. This is the POO-303 constraint that caused the whole
   * single-chain design, and provisioning is precisely the feature that could regress it: after a
   * bridge the wallet holds funds on several chains, and signing a permit for the SUM would authorise
   * a spend the target chain cannot honour.
   */
  describe("[POO-1043 R3] Permit2 sizing", () => {
    it("signs for the entered amount, on the strategy's own chain", async () => {
      const wallet = {
        address: "0xWALLET",
        getEthereumProvider: async () => ({ request: vi.fn() }),
        switchChain: vi.fn(async () => {}),
      };
      mocks.wallets = [wallet];
      mocks.allowance = parseUnits("1000000", 6);
      const { result } = renderHook(() => useInvest());
      await result.current.execute(strategy("polygon"), 100);

      // The amount the user entered, in USDC base units. Not a wallet balance, and not a sum over
      // chains: the permit authorises exactly the invest.
      expect(mocks.signTypedData).toHaveBeenCalledTimes(1);
      expect(mocks.buildPermitSingleCalls.at(-1)?.[2]).toBe(parseUnits("100", 6));
      // And the wallet is on the strategy's chain before anything is signed there.
      expect(wallet.switchChain).toHaveBeenCalledWith(137);
    });
  });

  // Each step also guards its own required context, so the modal (which runs steps individually and
  // can retry) fails loudly instead of signing/sending against a half-built context. The one-shot
  // execute() always threads a complete context, so these branches are exercised step-by-step.
  describe("step guards", () => {
    it("permit step throws when the pre-flight context is incomplete", async () => {
      const { result } = renderHook(() => useInvest());
      const steps = result.current.buildSteps(strategy(), 100);
      // steps[1] = "permit"; with no chainId/owner/usdc/spender/amount from the approve step it bails.
      await expect(steps[1]?.run({})).rejects.toThrow(/pre-flight is incomplete/);
    });

    it("build step throws when the strategy has no network", async () => {
      const { result } = renderHook(() => useInvest());
      const steps = result.current.buildSteps({ id: "s1" } as unknown as Strategy, 100);
      // steps[2] = "build"; the network guard fires before the permit/signature guard.
      await expect(steps[2]?.run({})).rejects.toThrow(/has no network/);
    });

    it("build step throws when the permit signature is missing", async () => {
      const { result } = renderHook(() => useInvest());
      const steps = result.current.buildSteps(strategy(), 100);
      // Network present, but the permit step never ran, so there is no signed permit in context.
      await expect(steps[2]?.run({})).rejects.toThrow(/Permit signature missing/);
    });

    it("confirm step throws when the tx was not built", async () => {
      const { result } = renderHook(() => useInvest());
      const steps = result.current.buildSteps(strategy(), 100);
      // steps[3] = "confirm:invest"; missing provider/built/owner in context.
      await expect(steps[3]?.run({})).rejects.toThrow(/Transaction was not built/);
    });
  });
});
