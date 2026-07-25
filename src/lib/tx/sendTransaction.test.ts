/**
 * @id PP-TX (POO-301 / POO-824)
 * @name sendTransaction tests
 * @implements-rules-version v1
 *
 * Submits via eth_sendTransaction; polls the receipt; reverts and timeouts throw. POO-824: every
 * broadcast asserts the wallet's actual chain against the flow's target chain first — a mismatch
 * gets ONE corrective switch, then a typed WRONG_CHAIN failure; never a silent wrong-chain send.
 */
import { describe, expect, it, vi } from "vitest";
import type { BuiltTx } from "./builtTxSchema";
import {
  BUILD_TARGET_MISMATCH_CODE,
  type Eip1193Provider,
  executeBuiltTransaction,
  executeBuiltTransactionWithLogs,
  executeBuiltTransactionWithReceipt,
  findWalletForAddress,
  sendBuiltTransaction,
  TransactionError,
  WRONG_ACCOUNT_CODE,
  WRONG_CHAIN_CODE,
  waitForReceipt,
} from "./sendTransaction";

const built: BuiltTx = { tx: { to: "0xcontract", data: "0xcalldata", value: "0" } };

/** Base (8453) as the target chain of every test; Arbitrum (42161) plays the wrong chain. */
const BASE = 8453;
const BASE_HEX = "0x2105";
const ARBITRUM_HEX = "0xa4b1";

function provider(handlers: Record<string, (params?: unknown[]) => unknown>): Eip1193Provider {
  return { request: async ({ method, params }) => handlers[method]?.(params) };
}

/** Handlers for a wallet already sitting on the target chain (the happy path). */
function onTargetChain(handlers: Record<string, (params?: unknown[]) => unknown> = {}) {
  return { eth_chainId: () => BASE_HEX, ...handlers };
}

describe("sendBuiltTransaction", () => {
  it("submits the tx with a hex value and returns the hash", async () => {
    const send = vi.fn((_params?: unknown) => "0xhash");
    const hash = await sendBuiltTransaction(
      provider(onTargetChain({ eth_sendTransaction: send })),
      { tx: { to: "0xc", data: "0xd", value: "1000000" } },
      "0xWALLET",
      BASE,
    );
    expect(hash).toBe("0xhash");
    const params = send.mock.calls[0]?.[0] as unknown as Array<{
      to: string;
      from: string;
      value: string;
    }>;
    expect(params[0]).toMatchObject({ to: "0xc", from: "0xWALLET", value: "0xf4240" }); // 1_000_000
  });

  it("wraps a provider failure in a TransactionError", async () => {
    const p = provider(
      onTargetChain({
        eth_sendTransaction: () => {
          throw new Error("user rejected");
        },
      }),
    );
    await expect(sendBuiltTransaction(p, built, "0xW", BASE)).rejects.toBeInstanceOf(
      TransactionError,
    );
  });
});

describe("sendBuiltTransaction — chain assertion (POO-824)", () => {
  it("[R1] sends without switching when the wallet is already on the target chain", async () => {
    const send = vi.fn(() => "0xhash");
    const switchChain = vi.fn();
    const p = provider({
      eth_chainId: () => BASE_HEX,
      wallet_switchEthereumChain: switchChain,
      eth_sendTransaction: send,
    });
    await sendBuiltTransaction(p, built, "0xW", BASE);
    expect(switchChain).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });

  it("[R1] corrects a wrong-chain wallet with ONE switch, re-verifies, then sends", async () => {
    let current = ARBITRUM_HEX;
    const send = vi.fn(() => "0xhash");
    const switchChain = vi.fn(() => {
      current = BASE_HEX;
    });
    const p = provider({
      eth_chainId: () => current,
      wallet_switchEthereumChain: switchChain,
      eth_sendTransaction: send,
    });
    await expect(sendBuiltTransaction(p, built, "0xW", BASE)).resolves.toBe("0xhash");
    // The switch targets the flow's chain as an EIP-3326 hex id.
    expect(switchChain).toHaveBeenCalledExactlyOnceWith([{ chainId: BASE_HEX }]);
    expect(send).toHaveBeenCalledOnce();
  });

  it("[R1/R3] throws a typed WRONG_CHAIN error and never sends when the switch is rejected", async () => {
    const send = vi.fn(() => "0xhash");
    const p = provider({
      eth_chainId: () => ARBITRUM_HEX,
      wallet_switchEthereumChain: () => {
        throw new Error("user rejected chain switch");
      },
      eth_sendTransaction: send,
    });
    const error = await sendBuiltTransaction(p, built, "0xW", BASE).catch((e) => e);
    expect(error).toBeInstanceOf(TransactionError);
    expect(error).toMatchObject({ cause: { code: WRONG_CHAIN_CODE } });
    expect(send).not.toHaveBeenCalled();
  });

  it("[R1/R3] throws WRONG_CHAIN and never sends when the switch silently no-ops (Privy external-wallet gap)", async () => {
    const send = vi.fn(() => "0xhash");
    const switchChain = vi.fn(); // resolves, but the chain never moves
    const p = provider({
      eth_chainId: () => ARBITRUM_HEX,
      wallet_switchEthereumChain: switchChain,
      eth_sendTransaction: send,
    });
    const error = await sendBuiltTransaction(p, built, "0xW", BASE).catch((e) => e);
    expect(switchChain).toHaveBeenCalledOnce();
    expect(error).toMatchObject({ cause: { code: WRONG_CHAIN_CODE } });
    expect(send).not.toHaveBeenCalled();
  });

  // POO-1026: typed BUILD_TARGET_MISMATCH, not WRONG_CHAIN — the wallet here is on the RIGHT chain,
  // so this is a server/client build bug and must not render "switch networks in your wallet".
  it("[R4] refuses a tx built for a different chain than the flow's target, before any wallet call", async () => {
    const send = vi.fn(() => "0xhash");
    const chainRead = vi.fn(() => BASE_HEX);
    const p = provider({ eth_chainId: chainRead, eth_sendTransaction: send });
    const wrongBuild: BuiltTx = { ...built, chainId: 42161 };
    const error = await sendBuiltTransaction(p, wrongBuild, "0xW", BASE).catch((e) => e);
    expect(error).toMatchObject({ cause: { code: BUILD_TARGET_MISMATCH_CODE } });
    expect(chainRead).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("[R4] sends normally when the built chainId matches the target", async () => {
    const send = vi.fn(() => "0xhash");
    const p = provider(onTargetChain({ eth_sendTransaction: send }));
    await expect(sendBuiltTransaction(p, { ...built, chainId: BASE }, "0xW", BASE)).resolves.toBe(
      "0xhash",
    );
    expect(send).toHaveBeenCalledOnce();
  });

  // POO-892 [R5]: the account assertion at the same choke point, mirroring the chain assert.
  it("[POO-892 R5] throws a typed WRONG_ACCOUNT error and never sends when the active account differs", async () => {
    const send = vi.fn(() => "0xhash");
    const p = provider(
      onTargetChain({
        eth_accounts: () => ["0xB0000000000000000000000000000000000000B"],
        eth_sendTransaction: send,
      }),
    );
    const error = await sendBuiltTransaction(
      p,
      built,
      "0xA0000000000000000000000000000000000000A",
      BASE,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(TransactionError);
    expect(error).toMatchObject({ cause: { code: WRONG_ACCOUNT_CODE } });
    expect(send).not.toHaveBeenCalled();
  });

  it("[POO-892 R5] does NOT fire when the provider account equals the owner (Privy embedded wallets)", async () => {
    const send = vi.fn(() => "0xhash");
    // Case-insensitive: a checksummed provider account is the same wallet as the lowercase owner.
    const p = provider(
      onTargetChain({
        eth_accounts: () => ["0xAbC0000000000000000000000000000000000001"],
        eth_sendTransaction: send,
      }),
    );
    await expect(
      sendBuiltTransaction(p, built, "0xabc0000000000000000000000000000000000001", BASE),
    ).resolves.toBe("0xhash");
    expect(send).toHaveBeenCalledOnce();
  });

  it("[POO-892 R5] asserts against the build's own from when the API pinned one", async () => {
    const send = vi.fn(() => "0xhash");
    const p = provider(
      onTargetChain({
        eth_accounts: () => ["0xB0000000000000000000000000000000000000B"],
        eth_sendTransaction: send,
      }),
    );
    // The effective from is built.tx.from (the session wallet the server built for), not ctx.owner.
    const pinned: BuiltTx = {
      tx: { ...built.tx, from: "0xA0000000000000000000000000000000000000A" },
    };
    const error = await sendBuiltTransaction(
      p,
      pinned,
      "0xB0000000000000000000000000000000000000B",
      BASE,
    ).catch((e) => e);
    expect(error).toMatchObject({ cause: { code: WRONG_ACCOUNT_CODE } });
    expect(send).not.toHaveBeenCalled();
  });

  it("[POO-892 R5] fails open (still sends) when eth_accounts is unsupported or empty", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => "0xhash");
    // The shared provider() helper returns undefined for unhandled methods (an exotic provider).
    await expect(
      sendBuiltTransaction(
        provider(onTargetChain({ eth_sendTransaction: send })),
        built,
        "0xW",
        BASE,
      ),
    ).resolves.toBe("0xhash");
    // A locked wallet reporting no accounts: the wallet itself rejects the send, not the assert.
    const locked = provider(onTargetChain({ eth_accounts: () => [], eth_sendTransaction: send }));
    await expect(sendBuiltTransaction(locked, built, "0xW", BASE)).resolves.toBe("0xhash");
    expect(send).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("wraps an eth_chainId read failure in a TransactionError instead of sending blind", async () => {
    const send = vi.fn(() => "0xhash");
    const p = provider({
      eth_chainId: () => {
        throw new Error("boom");
      },
      eth_sendTransaction: send,
    });
    await expect(sendBuiltTransaction(p, built, "0xW", BASE)).rejects.toBeInstanceOf(
      TransactionError,
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("waitForReceipt", () => {
  it("resolves with a null block once the receipt status is success but omits blockNumber", async () => {
    let calls = 0;
    const p = provider({
      eth_getTransactionReceipt: () => (++calls < 2 ? null : { status: "0x1" }),
    });
    await expect(waitForReceipt(p, "0xhash", { pollMs: 1 })).resolves.toEqual({
      blockNumber: null,
      logs: [],
    });
    expect(calls).toBe(2);
  });

  it("parses the receipt's hex blockNumber into a number (POO-308 convergence input)", async () => {
    const p = provider({
      eth_getTransactionReceipt: () => ({ status: "0x1", blockNumber: "0x1a2b" }),
    });
    await expect(waitForReceipt(p, "0xhash", { pollMs: 1 })).resolves.toMatchObject({
      blockNumber: 0x1a2b,
    });
  });

  it("preserves the receipt logs for decoding (POO-810 R1)", async () => {
    const logs = [
      { address: "0xtoken", topics: ["0xa", "0xb", "0xc"], data: "0x01" },
      { address: "0xtoken2", topics: ["0xd"], data: "0x02" },
    ];
    const p = provider({
      eth_getTransactionReceipt: () => ({ status: "0x1", blockNumber: "0x64", logs }),
    });
    await expect(waitForReceipt(p, "0xhash", { pollMs: 1 })).resolves.toEqual({
      blockNumber: 100,
      logs,
    });
  });

  it("yields an empty logs array when the node omits logs (POO-810 R9 fallback)", async () => {
    const p = provider({ eth_getTransactionReceipt: () => ({ status: "0x1" }) });
    await expect(waitForReceipt(p, "0xhash", { pollMs: 1 })).resolves.toEqual({
      blockNumber: null,
      logs: [],
    });
  });

  it("throws when the transaction reverted", async () => {
    const p = provider({ eth_getTransactionReceipt: () => ({ status: "0x0" }) });
    await expect(waitForReceipt(p, "0xhash", { pollMs: 1 })).rejects.toThrow(/reverted/);
  });

  it("throws on confirmation timeout", async () => {
    const p = provider({ eth_getTransactionReceipt: () => null });
    await expect(waitForReceipt(p, "0xhash", { timeoutMs: 5, pollMs: 1 })).rejects.toThrow(
      /timed out/,
    );
  });
});

describe("executeBuiltTransaction", () => {
  it("submits then confirms, returning the hash", async () => {
    const p = provider(
      onTargetChain({
        eth_sendTransaction: () => "0xabc",
        eth_getTransactionReceipt: () => ({ status: "0x1" }),
      }),
    );
    expect(await executeBuiltTransaction(p, built, "0xW", BASE, { pollMs: 1 })).toBe("0xabc");
  });

  it("[POO-824 R1] refuses to confirm on a wallet stuck on the wrong chain", async () => {
    const send = vi.fn(() => "0xabc");
    const p = provider({
      eth_chainId: () => ARBITRUM_HEX,
      wallet_switchEthereumChain: vi.fn(),
      eth_sendTransaction: send,
    });
    const error = await executeBuiltTransaction(p, built, "0xW", BASE, { pollMs: 1 }).catch(
      (e) => e,
    );
    expect(error).toMatchObject({ cause: { code: WRONG_CHAIN_CODE } });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("executeBuiltTransactionWithReceipt", () => {
  it("submits, confirms, and returns the hash + the mined block", async () => {
    const p = provider(
      onTargetChain({
        eth_sendTransaction: () => "0xabc",
        eth_getTransactionReceipt: () => ({ status: "0x1", blockNumber: "0x64" }),
      }),
    );
    expect(await executeBuiltTransactionWithReceipt(p, built, "0xW", BASE, { pollMs: 1 })).toEqual({
      hash: "0xabc",
      blockNumber: 100,
    });
  });
});

describe("executeBuiltTransactionWithLogs", () => {
  it("submits, confirms, and returns the hash + the receipt logs (POO-810 R1)", async () => {
    const logs = [{ address: "0xtoken", topics: ["0xsig", "0xfrom", "0xto"], data: "0x01" }];
    const p = provider(
      onTargetChain({
        eth_sendTransaction: () => "0xabc",
        eth_getTransactionReceipt: () => ({ status: "0x1", blockNumber: "0x64", logs }),
      }),
    );
    expect(await executeBuiltTransactionWithLogs(p, built, "0xW", BASE, { pollMs: 1 })).toEqual({
      hash: "0xabc",
      logs,
    });
  });

  it("returns an empty logs array when the node omits logs (POO-810 R9)", async () => {
    const p = provider(
      onTargetChain({
        eth_sendTransaction: () => "0xabc",
        eth_getTransactionReceipt: () => ({ status: "0x1" }),
      }),
    );
    expect(await executeBuiltTransactionWithLogs(p, built, "0xW", BASE, { pollMs: 1 })).toEqual({
      hash: "0xabc",
      logs: [],
    });
  });
});

// POO-892 [R5]: the address-matched wallet lookup that replaces bare wallets[0] in the tx hooks.
describe("findWalletForAddress (POO-892 R5)", () => {
  const walletA = { address: "0xAaa0000000000000000000000000000000000001" };
  const walletB = { address: "0xBbb0000000000000000000000000000000000002" };

  it("picks the wallet matching the active address, not wallets[0]", () => {
    expect(
      findWalletForAddress([walletA, walletB], "0xbbb0000000000000000000000000000000000002"),
    ).toBe(walletB);
  });

  it("matches case-insensitively", () => {
    expect(
      findWalletForAddress([walletB, walletA], "0xAAA0000000000000000000000000000000000001"),
    ).toBe(walletA);
  });

  it("falls back to wallets[0] when nothing matches", () => {
    expect(
      findWalletForAddress([walletA, walletB], "0xCcc0000000000000000000000000000000000003"),
    ).toBe(walletA);
  });

  it("falls back to wallets[0] when the active address is unknown", () => {
    expect(findWalletForAddress([walletA, walletB], undefined)).toBe(walletA);
  });

  it("returns undefined when no wallet is connected", () => {
    expect(findWalletForAddress([], "0xAaa0000000000000000000000000000000000001")).toBeUndefined();
  });
});
