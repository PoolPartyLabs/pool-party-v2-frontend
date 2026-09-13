/**
 * @id PP-CORE-LIB-089 (POO-1385)
 * @name ensureWalletOnChain
 * @implements-rules-version v2 (POO-1385 rules v2)
 *
 * Rules under test (POO-1385 rules v1):
 *   [R2] one shared ladder: wagmi connector first, Privy wallet SDK as fallback, never both on a
 *        success, and the cached provider handle invalidated on every attempt
 *   [R3] the switch is VERIFIED by re-reading the wallet's chain, not trusted because it resolved
 *   [R4] no unbounded wallet request: a switch or a read that never settles fails typed
 *   [R5] a chain the wallet does not have is `CHAIN_UNAVAILABLE`, not `WRONG_CHAIN`
 *
 * The two classification pins carried over from POO-1026 are asserted here too, because both read as
 * surprises and both are load-bearing: a DECLINED switch stays `WRONG_CHAIN` (the user's remedy is to
 * accept it), and a connector that simply cannot switch is NOT "chain unavailable" (it means try the
 * other lever).
 */
import { arbitrum, polygon } from "viem/chains";
import { describe, expect, it, vi } from "vitest";
import {
  type ChainSwitchLevers,
  ensureWalletOnChain,
  ensureWalletProviderOnChain,
  isChainUnavailableError,
} from "./ensureWalletChain";
import { CHAIN_UNAVAILABLE_CODE, TransactionError, WRONG_CHAIN_CODE } from "./sendTransaction";

/** A never-settling promise: what a WalletConnect session does with an out-of-namespace request. */
const NEVER = new Promise<never>(() => {});

/** EIP-3326's "Unrecognized chain ID" rejection, as a wallet actually throws it. */
function unrecognizedChain() {
  return Object.assign(new Error("Unrecognized chain ID. Try adding the chain first."), {
    code: 4902,
  });
}

/**
 * Levers over a mutable chain value, so a test states what the wallet DOES rather than restating the
 * implementation's call order. `landsAfter` models the embedded-wallet lag from POO-1077: the switch
 * resolves and the chain only reports the new value some reads later.
 */
function levers({
  chain = polygon.id,
  connector,
  wallet,
  landsAfter = 0,
}: {
  chain?: number;
  connector?: () => Promise<void>;
  wallet?: () => Promise<void>;
  landsAfter?: number;
} = {}) {
  const state = { chain, reads: 0, connectorCalls: 0, walletCalls: 0, invalidations: 0 };
  let pending: number | null = null;
  const spies: ChainSwitchLevers = {
    readChainId: async () => {
      state.reads++;
      if (pending != null && state.reads > landsAfter) {
        state.chain = pending;
        pending = null;
      }
      return state.chain;
    },
    switchViaConnector: async (target) => {
      state.connectorCalls++;
      if (connector) return connector();
      state.reads = 0;
      pending = target;
    },
    switchViaWallet: async (target) => {
      state.walletCalls++;
      if (wallet) return wallet();
      state.reads = 0;
      pending = target;
    },
    onSwitchAttempted: () => {
      state.invalidations++;
    },
  };
  return { state, spies };
}

/** Short budgets so the bounded paths are exercised without a real 30s wait. */
const FAST = { settleMs: 60, pollMs: 5, switchTimeoutMs: 40, readTimeoutMs: 40 };

describe("isChainUnavailableError (POO-1385 [R5])", () => {
  it.each([
    ["EIP-3326 4902", unrecognizedChain()],
    ["unrecognized chain prose", new Error("Unrecognized chain ID")],
    ["unsupported chain prose", new Error("Unsupported chain: 42161")],
    ["not approved in the session", new Error("Chain 42161 is not approved by the wallet")],
    ["WalletConnect namespace miss", new Error("Missing or invalid. approve() namespaces chains")],
  ])("treats %s as a chain the wallet does not have", (_label, error) => {
    expect(isChainUnavailableError(error)).toBe(true);
  });

  /**
   * The two negatives matter more than the positives. A connector that cannot switch means "use the
   * other lever", and classifying it as unavailable would SKIP the fallback that fixes it. A declined
   * prompt is a chain the wallet plainly has.
   */
  it.each([
    ["a connector without switch support", new Error("Switch chain not supported by connector")],
    ["a declined prompt", Object.assign(new Error("User rejected the request."), { code: 4001 })],
    ["an unrelated failure", new Error("Network request failed")],
  ])("does not treat %s as a chain the wallet does not have", (_label, error) => {
    expect(isChainUnavailableError(error)).toBe(false);
  });
});

describe("ensureWalletOnChain (POO-1385 [R2]/[R3])", () => {
  // [R2] The cheapest correct outcome: already there, so nothing is prompted at all.
  it("prompts nothing when the wallet already reports the target chain", async () => {
    const { state, spies } = levers({ chain: arbitrum.id });
    await ensureWalletOnChain(arbitrum.id, spies, FAST);
    expect(state.connectorCalls).toBe(0);
    expect(state.walletCalls).toBe(0);
  });

  // [R2] The connector is the lever the provider follows, so it goes first and, on success, alone.
  it("switches via the connector and never also prompts the wallet SDK", async () => {
    const { state, spies } = levers();
    await ensureWalletOnChain(arbitrum.id, spies, FAST);
    expect(state.connectorCalls).toBe(1);
    expect(state.walletCalls).toBe(0);
    expect(state.chain).toBe(arbitrum.id);
  });

  // [R2] A wallet that does not drive the connector is the reason rung 2 exists.
  it("falls back to the wallet SDK when the connector cannot switch", async () => {
    const { state, spies } = levers({
      connector: async () => {
        throw new Error("Switch chain not supported by connector");
      },
    });
    await ensureWalletOnChain(arbitrum.id, spies, FAST);
    expect(state.connectorCalls).toBe(1);
    expect(state.walletCalls).toBe(1);
    expect(state.chain).toBe(arbitrum.id);
  });

  // [R2] POO-1081: an embedded wallet's provider is pinned at fetch time, so the caller has to be
  // told to drop its cached handle. Told BEFORE the switch, because after is already too late.
  it("signals the caller to invalidate its cached provider on every attempt", async () => {
    const { state, spies } = levers({
      connector: async () => {
        throw new Error("Switch chain not supported by connector");
      },
    });
    await ensureWalletOnChain(arbitrum.id, spies, FAST);
    expect(state.invalidations).toBe(2);
  });

  /**
   * [R3] The heart of this issue. `wallet.switchChain` resolving means the wallet ACCEPTED the
   * request; POO-1079 showed it can accept one and leave the connector-bound provider where it was.
   * Before this, that resolved cleanly and the next step opened a signature prompt on the old chain.
   */
  it("fails typed when a switch resolves but the chain never moves", async () => {
    const { state, spies } = levers({
      connector: async () => {},
      wallet: async () => {},
    });
    const error = await ensureWalletOnChain(arbitrum.id, spies, FAST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionError);
    expect(error).toMatchObject({ cause: { code: WRONG_CHAIN_CODE, targetChainId: arbitrum.id } });
    expect(state.chain).toBe(polygon.id);
  });

  // [R3] POO-1077: an embedded wallet applies the switch asynchronously. A single re-read failed a
  // wallet that was about to be perfectly fine, so the verification polls within its budget.
  it("accepts a switch the wallet applies a few reads later", async () => {
    const { state, spies } = levers({ landsAfter: 3 });
    await ensureWalletOnChain(arbitrum.id, spies, FAST);
    expect(state.chain).toBe(arbitrum.id);
  });
});

describe("ensureWalletOnChain, a chain the wallet does not have (POO-1385 [R4]/[R5])", () => {
  /**
   * [R5] The Ledger Live case. Only Arbitrum was approved into the WalletConnect session, so Polygon
   * cannot be switched to at all. The remedy is "enable that network in your wallet", which is a
   * different sentence from "switch to it", so it is a different kind.
   */
  it("reports CHAIN_UNAVAILABLE when the connector rejects with 4902", async () => {
    const { state, spies } = levers({
      connector: async () => {
        throw unrecognizedChain();
      },
    });
    const error = await ensureWalletOnChain(arbitrum.id, spies, FAST).catch((e: unknown) => e);
    expect(error).toMatchObject({
      cause: { code: CHAIN_UNAVAILABLE_CODE, targetChainId: arbitrum.id },
    });
    // [R5] and it does NOT go on to prompt the second lever: the wallet does not have the chain, so
    // rung 2 is another doomed request, and on an external wallet a second prompt is its own defect.
    expect(state.walletCalls).toBe(0);
  });

  it("reports CHAIN_UNAVAILABLE when the wallet SDK rejects with 4902", async () => {
    const { spies } = levers({
      connector: async () => {
        throw new Error("Switch chain not supported by connector");
      },
      wallet: async () => {
        throw unrecognizedChain();
      },
    });
    const error = await ensureWalletOnChain(arbitrum.id, spies, FAST).catch((e: unknown) => e);
    expect(error).toMatchObject({ cause: { code: CHAIN_UNAVAILABLE_CODE } });
  });

  /**
   * [R4] THE FREEZE. A WalletConnect request for a chain outside the approved namespace is not
   * rejected, it is never answered, and both levers awaited it forever. This is the assertion that
   * the app cannot hang on a wallet that has gone quiet.
   */
  it("fails within the budget when the switch request is never answered", async () => {
    const { spies } = levers({
      connector: () => NEVER,
      wallet: () => NEVER,
    });
    const error = await ensureWalletOnChain(arbitrum.id, spies, FAST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionError);
    expect(error).toMatchObject({ cause: { code: CHAIN_UNAVAILABLE_CODE } });
  });

  // [R4] The same guarantee for the READ side: a provider that never answers eth_chainId.
  it("fails within the budget when the chain read is never answered", async () => {
    const spies: ChainSwitchLevers = {
      readChainId: () => NEVER,
      switchViaConnector: async () => {},
      switchViaWallet: async () => {},
    };
    const error = await ensureWalletOnChain(arbitrum.id, spies, FAST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionError);
  });

  /**
   * POO-1026 pinned this and it stays pinned: someone who just declined the prompt has a wallet that
   * plainly HAS the chain, and their remedy is to accept it. Calling that "unavailable" would send
   * them into their wallet settings to add a network that is already there.
   */
  it("keeps a declined switch as WRONG_CHAIN, not CHAIN_UNAVAILABLE", async () => {
    const declined = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const { spies } = levers({
      connector: async () => {
        throw declined;
      },
      wallet: async () => {
        throw declined;
      },
    });
    const error = await ensureWalletOnChain(arbitrum.id, spies, FAST).catch((e: unknown) => e);
    expect(error).toMatchObject({ cause: { code: WRONG_CHAIN_CODE, targetChainId: arbitrum.id } });
  });
});

/**
 * The wallet-bound half: the same ladder, wired to a Privy `ConnectedWallet` and a wagmi connector
 * switch, handing back the provider the caller then signs and broadcasts with.
 *
 * The provider IDENTITY is the whole point of these tests. POO-1081 found that an embedded wallet's
 * provider is initialised from the chain it was fetched on, so a handle taken before the switch keeps
 * answering with the OLD chain no matter which lever succeeded. A caller that gets back the stale
 * handle is exactly as broken as one that never switched.
 */
describe("ensureWalletProviderOnChain (POO-1385 [R2]/[R3])", () => {
  /** A provider whose `eth_chainId` answers with whatever chain it was minted for. */
  function providerOn(chainId: number) {
    return {
      chainId,
      request: async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
        throw new Error(`unexpected method ${method}`);
      },
    };
  }

  /** A wallet whose SDK switch moves it, and whose provider is minted at fetch time. */
  function walletOn(chain: number, { sdkMoves = true } = {}) {
    const state = { chain, fetches: 0 };
    return {
      state,
      wallet: {
        switchChain: async (target: number) => {
          if (sdkMoves) state.chain = target;
        },
        getEthereumProvider: async () => {
          state.fetches++;
          return providerOn(state.chain);
        },
      },
    };
  }

  it("returns a provider fetched AFTER the switch, never the stale pre-switch handle", async () => {
    const { state, wallet } = walletOn(polygon.id, { sdkMoves: false });
    // The connector is the lever that moves it, mirroring an embedded wallet (POO-1080).
    const provider = await ensureWalletProviderOnChain(
      wallet,
      arbitrum.id,
      async (target) => {
        state.chain = target;
      },
      FAST,
    );
    expect(await provider.request({ method: "eth_chainId" })).toBe(`0x${arbitrum.id.toString(16)}`);
    expect(state.fetches).toBeGreaterThan(1);
  });

  it("returns the wallet's provider untouched when it is already on the target chain", async () => {
    const { state, wallet } = walletOn(arbitrum.id);
    const connector = vi.fn();
    const provider = await ensureWalletProviderOnChain(wallet, arbitrum.id, connector, FAST);
    expect(await provider.request({ method: "eth_chainId" })).toBe(`0x${arbitrum.id.toString(16)}`);
    expect(connector).not.toHaveBeenCalled();
    expect(state.fetches).toBe(1);
  });

  // [R5] The Ledger Live case, end to end through the wallet-bound entry point.
  it("surfaces CHAIN_UNAVAILABLE when neither lever can reach the chain", async () => {
    const { wallet } = walletOn(arbitrum.id, { sdkMoves: false });
    wallet.switchChain = async () => {
      throw unrecognizedChain();
    };
    const error = await ensureWalletProviderOnChain(
      wallet,
      polygon.id,
      async () => {
        throw unrecognizedChain();
      },
      FAST,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionError);
    expect(error).toMatchObject({
      cause: { code: CHAIN_UNAVAILABLE_CODE, targetChainId: polygon.id },
    });
  });
});
