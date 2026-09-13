/**
 * @id PP-TX (POO-301 / POO-824 / POO-1783)
 * @name sendTransaction tests
 * @implements-rules-version v4 (POO-1783 rules v1)
 *
 * Submits via eth_sendTransaction; polls the receipt; reverts and timeouts throw. POO-824: every
 * broadcast asserts the wallet's actual chain against the flow's target chain first — a mismatch
 * gets ONE corrective switch, then a typed WRONG_CHAIN failure; never a silent wrong-chain send.
 * POO-1783 [R1]: a wallet that does not HAVE the chain is offered it (`wallet_addEthereumChain`)
 * and the switch retried once; [R2] every other failure keeps the surface it already had.
 */

import { describe, expect, it, vi } from "vitest";
import { ROBINHOOD_CHAIN_ID } from "@/lib/chains/config";
import type { BuiltTx } from "./builtTxSchema";
import {
  BUILD_TARGET_MISMATCH_CODE,
  CHAIN_UNAVAILABLE_CODE,
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
/** Polygon: the chain the live POO-1077 report was stuck on. */
const POLYGON_HEX = "0x89";

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

  // POO-1080, from a live console: the broadcast omitted `chainId`, so a Privy EMBEDDED wallet
  // routed a Base transaction to `polygon-mainnet.rpc.privy.systems` and failed for "insufficient
  // funds" against a POL balance, seconds after reporting the chain switch as successful. An
  // injected wallet ignores the field, which is why this shipped and worked for a year.
  it("[R1] states the target chain on the request, not just on the wallet", async () => {
    const send = vi.fn((_params?: unknown) => "0xhash");
    await sendBuiltTransaction(
      provider(onTargetChain({ eth_sendTransaction: send })),
      built,
      "0xWALLET",
      BASE,
    );
    const params = send.mock.calls[0]?.[0] as unknown as Array<{ chainId?: string }>;
    // EIP-3326 hex, the same form `wallet_switchEthereumChain` takes.
    expect(params[0]?.chainId).toBe(BASE_HEX);
  });

  // POO-1826, from the Robinhood move range `0x38b45a3e…c83f37b` (status 0, gasUsed 3,847,705 of a
  // 4,150,329 limit, EMPTY revert data): a manager write is 13 call frames deep and EIP-150's 63/64
  // rule strands ~7% of whatever limit it starts with, so a wallet that broadcasts at its own bare
  // `eth_estimateGas` runs out of gas in the deepest frame. The API now advertises a padded limit
  // (estimate x 1.25) and this choke point is where it has to reach the wallet.
  // @rule R2
  it("[POO-1826] forwards the build's advertised gas limit as a hex quantity", async () => {
    const send = vi.fn((_params?: unknown) => "0xhash");
    await sendBuiltTransaction(
      provider(onTargetChain({ eth_sendTransaction: send })),
      { tx: { ...built.tx, gas: "4150329" } },
      "0xWALLET",
      BASE,
    );
    const params = send.mock.calls[0]?.[0] as unknown as Array<{ gas?: string }>;
    expect(params[0]?.gas).toBe("0x3f5439"); // 4_150_329, the limit the failing move range needed
  });

  // @rule R2
  it("[POO-1826] sends NO gas key at all when the build advertises none (the wallet estimates)", async () => {
    const send = vi.fn((_params?: unknown) => "0xhash");
    await sendBuiltTransaction(
      provider(onTargetChain({ eth_sendTransaction: send })),
      built,
      "0xWALLET",
      BASE,
    );
    const params = send.mock.calls[0]?.[0] as unknown as Array<Record<string, unknown>>;
    // Byte-identical to the pre-POO-1826 request: an explicit `undefined` would still serialise as a
    // `gas` key for some wallets, so the key must be absent, not empty.
    expect(params[0]).not.toHaveProperty("gas");
  });

  // @rule R2
  it("[POO-1826] drops an unusable advertised limit rather than broadcasting a doomed 0x0", async () => {
    const send = vi.fn((_params?: unknown) => "0xhash");
    for (const gas of ["0", "not-a-number"]) {
      send.mockClear();
      await sendBuiltTransaction(
        provider(onTargetChain({ eth_sendTransaction: send })),
        { tx: { ...built.tx, gas } },
        "0xWALLET",
        BASE,
      );
      const params = send.mock.calls[0]?.[0] as unknown as Array<Record<string, unknown>>;
      expect(params[0]).not.toHaveProperty("gas");
    }
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

  // POO-1077, reported live on a Privy EMBEDDED wallet: "Wallet stayed on chain 137 after
  // switching; this transaction targets chain 8453". `wallet_switchEthereumChain` RESOLVING means
  // the wallet accepted the request, not that it finished applying it. An injected wallet updates
  // before it resolves, which is why one immediate re-read shipped and worked; an embedded wallet
  // keeps reporting the old chain for a moment and was failed for it.
  it("[R1] waits for a wallet that applies the switch asynchronously, then sends", async () => {
    let current = POLYGON_HEX;
    let reads = 0;
    const send = vi.fn(() => "0xhash");
    // Accepts immediately, lands two reads later. Exactly the embedded-wallet shape.
    const switchChain = vi.fn();
    const p = provider({
      eth_chainId: () => {
        reads += 1;
        if (reads > 2) current = BASE_HEX;
        return current;
      },
      wallet_switchEthereumChain: switchChain,
      eth_sendTransaction: send,
    });

    await expect(sendBuiltTransaction(p, built, "0xW", BASE)).resolves.toBe("0xhash");
    expect(switchChain).toHaveBeenCalledExactlyOnceWith([{ chainId: BASE_HEX }]);
    // Still ONE switch: waiting must not turn into re-prompting the user (POO-824 [R1]).
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

/**
 * POO-1783: a wallet that has never had the target chain answers the corrective switch with
 * EIP-3326's 4902 and the flow died there, so the Robinhood alpha (chain 4663) was unreachable from
 * MetaMask, Rabby and Ledger Live. Privy embedded wallets carry every configured chain, which is why
 * the alpha smoke never saw it.
 */
describe("sendBuiltTransaction — wallet_addEthereumChain fallback (POO-1783)", () => {
  /** EIP-3326's "Unrecognized chain ID" rejection, the shape MetaMask actually throws. */
  function unrecognizedChain() {
    return Object.assign(new Error("Unrecognized chain ID. Try adding the chain first."), {
      code: 4902,
    });
  }

  /**
   * A wallet that does not know `targetHex` until the chain is ADDED, then switches normally.
   * Mirrors MetaMask: the add prompt lands the wallet on the new chain, and the retried switch is
   * the confirmation.
   */
  function walletMissingChain(targetHex: string, switchError: unknown = unrecognizedChain()) {
    let current = ARBITRUM_HEX;
    let known = false;
    const addChain = vi.fn(() => {
      known = true;
    });
    const switchChain = vi.fn(() => {
      if (!known) throw switchError;
      current = targetHex;
    });
    const send = vi.fn(() => "0xhash");
    const wallet = provider({
      eth_chainId: () => current,
      wallet_switchEthereumChain: switchChain,
      wallet_addEthereumChain: addChain,
      eth_sendTransaction: send,
    });
    return { wallet, addChain, switchChain, send };
  }

  /**
   * @rule R1 — the reported failure: chain 4663 on an external wallet. One add prompt, one retried
   * switch, then the transaction goes out. The add payload is the chain's own metadata, so the
   * wallet writes the same name, RPC and explorer the rest of the product uses.
   */
  it("[R1] adds Robinhood Chain on 4902, retries the switch once, then sends", async () => {
    const { wallet, addChain, switchChain, send } = walletMissingChain("0x1237");

    await expect(sendBuiltTransaction(wallet, built, "0xW", ROBINHOOD_CHAIN_ID)).resolves.toBe(
      "0xhash",
    );

    expect(addChain).toHaveBeenCalledExactlyOnceWith([
      {
        chainId: "0x1237",
        chainName: "Robinhood Chain",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
        blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
      },
    ]);
    // Retried ONCE: the first switch is the one that earned the 4902, the second is the retry.
    expect(switchChain).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledOnce();
  });

  /**
   * @rule R1 — the same on a launch chain. The fallback is keyed on `supportedChainMetas`, not on
   * Robinhood, so a wallet freshly installed against Base recovers identically.
   */
  it("[R1] adds a launch chain on 4902, retries the switch once, then sends", async () => {
    const { wallet, addChain, switchChain, send } = walletMissingChain(BASE_HEX);

    await expect(sendBuiltTransaction(wallet, built, "0xW", BASE)).resolves.toBe("0xhash");

    expect(addChain).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ chainId: BASE_HEX, chainName: "Base" }),
    ]);
    expect(switchChain).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledOnce();
  });

  /**
   * @rule R1 — "or the equivalent unrecognized-chain error": not every wallet sets the numeric code,
   * and a provider that only says so in words is the same condition with the same remedy.
   */
  it("[R1] adds the chain for an unrecognized-chain error that carries no 4902 code", async () => {
    const { wallet, addChain, send } = walletMissingChain(
      "0x1237",
      new Error("Unrecognized chain ID 4663"),
    );

    await expect(sendBuiltTransaction(wallet, built, "0xW", ROBINHOOD_CHAIN_ID)).resolves.toBe(
      "0xhash",
    );
    expect(addChain).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  /**
   * @rule R2 — a DECLINED switch is a chain the wallet plainly has. Adding it would be a second
   * prompt for a network already in the list, immediately after the user said no.
   */
  it("[R2] never adds when the user simply declines the switch, and keeps WRONG_CHAIN", async () => {
    const addChain = vi.fn();
    const p = provider({
      eth_chainId: () => ARBITRUM_HEX,
      wallet_switchEthereumChain: () => {
        throw Object.assign(new Error("User rejected the request"), { code: 4001 });
      },
      wallet_addEthereumChain: addChain,
      eth_sendTransaction: vi.fn(),
    });

    const error = await sendBuiltTransaction(p, built, "0xW", ROBINHOOD_CHAIN_ID).catch((e) => e);
    expect(addChain).not.toHaveBeenCalled();
    expect(error).toMatchObject({ cause: { code: WRONG_CHAIN_CODE } });
  });

  /**
   * @rule R2 — a WalletConnect session whose approved namespace excludes the chain is "cannot
   * reach", but it is not "unrecognized": the add would be dropped exactly the way the switch was,
   * costing the user a second full timeout to reach the same answer.
   */
  it("[R2] never adds for a WalletConnect namespace rejection, and keeps CHAIN_UNAVAILABLE", async () => {
    const addChain = vi.fn();
    const p = provider({
      eth_chainId: () => ARBITRUM_HEX,
      wallet_switchEthereumChain: () => {
        throw new Error("Non conforming namespaces. approve() namespaces chains don't satisfy");
      },
      wallet_addEthereumChain: addChain,
      eth_sendTransaction: vi.fn(),
    });

    const error = await sendBuiltTransaction(p, built, "0xW", ROBINHOOD_CHAIN_ID).catch((e) => e);
    expect(addChain).not.toHaveBeenCalled();
    expect(error).toMatchObject({
      cause: { code: CHAIN_UNAVAILABLE_CODE, targetChainId: ROBINHOOD_CHAIN_ID },
    });
  });

  /**
   * @rule R1/R2 — scoped to supported chains. Asking a wallet to add a network this app holds no
   * definition of would mean inventing an RPC endpoint for the user to trust.
   */
  it("[R2] never adds a chain this app does not support, and keeps CHAIN_UNAVAILABLE", async () => {
    const addChain = vi.fn();
    const send = vi.fn();
    const p = provider({
      eth_chainId: () => ARBITRUM_HEX,
      wallet_switchEthereumChain: () => {
        throw unrecognizedChain();
      },
      wallet_addEthereumChain: addChain,
      eth_sendTransaction: send,
    });

    const error = await sendBuiltTransaction(p, built, "0xW", 1).catch((e) => e);
    expect(addChain).not.toHaveBeenCalled();
    expect(error).toMatchObject({ cause: { code: CHAIN_UNAVAILABLE_CODE, targetChainId: 1 } });
    expect(send).not.toHaveBeenCalled();
  });

  /**
   * @rule R2 — a declined ADD leaves the wallet exactly where the 4902 found it, so the surface
   * stays the one that first answer earned: the wallet cannot reach this chain.
   */
  it("[R2] keeps CHAIN_UNAVAILABLE and never sends when the user declines the add", async () => {
    const send = vi.fn();
    const p = provider({
      eth_chainId: () => ARBITRUM_HEX,
      wallet_switchEthereumChain: () => {
        throw unrecognizedChain();
      },
      wallet_addEthereumChain: () => {
        throw Object.assign(new Error("User rejected the request"), { code: 4001 });
      },
      eth_sendTransaction: send,
    });

    const error = await sendBuiltTransaction(p, built, "0xW", ROBINHOOD_CHAIN_ID).catch((e) => e);
    expect(error).toBeInstanceOf(TransactionError);
    expect(error).toMatchObject({
      cause: { code: CHAIN_UNAVAILABLE_CODE, targetChainId: ROBINHOOD_CHAIN_ID },
    });
    expect(send).not.toHaveBeenCalled();
  });

  /**
   * @rule R2 — once the add lands, the chain IS there, so a refused retry is an ordinary wrong-chain
   * state with an ordinary remedy. Reporting CHAIN_UNAVAILABLE here would send the user hunting for
   * a network their wallet just gained.
   */
  it("[R2] reports WRONG_CHAIN when the chain was added but the retried switch is declined", async () => {
    const send = vi.fn();
    let added = false;
    const p = provider({
      eth_chainId: () => ARBITRUM_HEX,
      wallet_switchEthereumChain: () => {
        if (!added) throw unrecognizedChain();
        throw Object.assign(new Error("User rejected the request"), { code: 4001 });
      },
      wallet_addEthereumChain: () => {
        added = true;
      },
      eth_sendTransaction: send,
    });

    const error = await sendBuiltTransaction(p, built, "0xW", ROBINHOOD_CHAIN_ID).catch((e) => e);
    expect(error).toMatchObject({ cause: { code: WRONG_CHAIN_CODE } });
    expect(send).not.toHaveBeenCalled();
  });

  /**
   * @rule R1 — the add is not a switch. A wallet that accepts the add but stays put still has to be
   * proven onto the chain before anything is broadcast (POO-824 [R1], POO-1077).
   */
  it("[R1] still refuses to send when the chain was added but the wallet never lands on it", async () => {
    const send = vi.fn();
    let added = false;
    const addChain = vi.fn(() => {
      added = true;
    });
    const p = provider({
      eth_chainId: () => ARBITRUM_HEX,
      // Accepts the retried switch after the add, but the chain read never moves.
      wallet_switchEthereumChain: () => {
        if (!added) throw unrecognizedChain();
      },
      wallet_addEthereumChain: addChain,
      eth_sendTransaction: send,
    });

    const error = await sendBuiltTransaction(p, built, "0xW", ROBINHOOD_CHAIN_ID).catch((e) => e);
    expect(addChain).toHaveBeenCalledOnce();
    expect(error).toMatchObject({ cause: { code: WRONG_CHAIN_CODE } });
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

  /**
   * POO-1093 [R1]. The poll had no try/catch, so ONE flaky `eth_getTransactionReceipt` failed the
   * whole leg. That matters far beyond a retryable read: on the provisioning rail the failed leg
   * arms an unconditional "Try again", and because the rail never consulted the journal, the retry
   * re-broadcast a transaction that was already on chain. A dropped read is not evidence about
   * where the money is, so it must not be treated as one.
   *
   * `awaitBridgeSettlement` and `reconcileFundingJournal` already take this position for their own
   * reads; this brings the receipt poll in line with them.
   */
  it("[R1] survives a transient read failure and keeps polling to its deadline", async () => {
    let calls = 0;
    const p = provider({
      eth_getTransactionReceipt: () => {
        calls += 1;
        if (calls <= 2) throw new Error("network error");
        return { status: "0x1", blockNumber: "0x5" };
      },
    });

    await expect(waitForReceipt(p, "0xhash", { pollMs: 1 })).resolves.toMatchObject({
      blockNumber: 5,
    });
    expect(calls).toBe(3);
  });

  it("[R1] still times out when every read fails, rather than hanging", async () => {
    const p = provider({
      eth_getTransactionReceipt: () => {
        throw new Error("network error");
      },
    });
    // The last failure's reason rides along: "timed out" alone would send someone hunting a slow
    // chain when the truth is that their RPC never answered.
    await expect(waitForReceipt(p, "0xhash", { timeoutMs: 5, pollMs: 1 })).rejects.toThrow(
      /timed out[\s\S]*network error/,
    );
  });

  it("[R1] a REVERT is still terminal, never retried", async () => {
    // The tolerance is for reads that say nothing. A receipt that says the transaction failed is a
    // real answer and must fail the step immediately.
    let calls = 0;
    const p = provider({
      eth_getTransactionReceipt: () => {
        calls += 1;
        return { status: "0x0" };
      },
    });
    await expect(waitForReceipt(p, "0xhash", { pollMs: 1 })).rejects.toThrow(/reverted/);
    expect(calls).toBe(1);
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
