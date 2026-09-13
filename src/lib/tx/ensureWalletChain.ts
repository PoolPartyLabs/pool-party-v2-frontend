/**
 * @id PP-CORE-LIB-089 (POO-1385)
 * @name ensureWalletOnChain
 * @implements-rules-version v2 (POO-1385 rules v2)
 * @analytics-events none, pure; the emitting surface is PP-STR-CMP-026
 *
 * The ONE ladder that moves a wallet onto the chain an operation runs on, and then PROVES it moved.
 *
 * ## Why this exists
 *
 * Seven operation hooks each did `await wallet.switchChain(chainId)` and trusted it. POO-1079
 * established that this is the Privy WALLET-OBJECT lever, while `getEthereumProvider()` hands back a
 * provider bound to the wagmi CONNECTOR, so the call could resolve cleanly and leave the provider
 * exactly where it was. The next step then opened a signature prompt against a wallet still on the
 * old chain: an EIP-712 Permit2 domain naming Arbitrum, signed by a wallet sitting on Polygon.
 *
 * `useProvisioningRail` had already solved this for the cross-chain funding legs. This is that
 * solution extracted rather than a new design, with the verification and the bounds it was missing.
 *
 * ## The ladder [R2]
 *
 * 1. **wagmi `switchChainAsync`** - the connector is what the provider follows, so it goes first.
 * 2. **the wallet SDK** - the right lever for a wallet that is not driving the connector, and only
 *    reached when rung 1 failed. Never both on a success: on an external wallet each one prompts,
 *    and asking twice for one switch is its own defect.
 * 3. **verify** [R3] - re-read the chain until it reports the target. A resolved switch is the
 *    wallet's acknowledgement, not its completion (POO-1077: an embedded wallet applies it
 *    asynchronously and keeps reporting the old chain for a moment).
 *
 * Every attempt first signals {@link ChainSwitchLevers.onSwitchAttempted}, because an embedded
 * wallet's provider is pinned at fetch time (POO-1081): whichever lever moves the chain, a cached
 * handle now belongs to the old one.
 *
 * ## What it refuses to do
 *
 * Wait forever [R4]. A chain outside a WalletConnect session's approved namespace is not rejected by
 * the wallet, it is dropped, so an unbounded await is a permanent freeze with no error to show. Every
 * rung is bounded, and silence is read as {@link CHAIN_UNAVAILABLE_CODE} [R5] rather than as a
 * generic failure, because "enable that network in your wallet" is the one thing that resolves it.
 */
"use client";

import { withTimeout } from "@/lib/utils/withTimeout";
import {
  awaitChainId,
  CHAIN_READ_TIMEOUT_MS,
  CHAIN_SWITCH_SETTLE_MS,
  CHAIN_SWITCH_TIMEOUT_MS,
  CHAIN_UNAVAILABLE_CODE,
  type Eip1193Provider,
  isChainUnavailableError,
  isUserRejection,
  readProviderChainId,
  TransactionError,
  WRONG_CHAIN_CODE,
} from "./sendTransaction";

export { CHAIN_UNAVAILABLE_CODE, isChainUnavailableError };

/**
 * The three things this needs from a wallet, named by what they DO rather than by which SDK provides
 * them, so the ladder is testable without Privy, wagmi or a browser.
 */
export interface ChainSwitchLevers {
  /** Read the wallet's ACTIVE chain id. Must reflect the provider the app will actually sign with. */
  readChainId: () => Promise<number>;
  /** Rung 1: move the wagmi connector (the lever the provider follows). */
  switchViaConnector: (chainId: number) => Promise<void>;
  /** Rung 2: move the wallet SDK's own object, for a wallet not driving the connector. */
  switchViaWallet: (chainId: number) => Promise<void>;
  /** Called before every attempt so the caller drops any cached provider handle (POO-1081). */
  onSwitchAttempted?: () => void;
}

/** Budgets, overridable so tests exercise the bounded paths without a real 30 second wait. */
export interface EnsureChainOptions {
  /** How long the wallet gets to LAND on the chain after accepting the switch. */
  settleMs?: number;
  /** How often to re-read while waiting for it to land. */
  pollMs?: number;
  /** How long the wallet gets to ANSWER a switch request. */
  switchTimeoutMs?: number;
  /** How long the wallet gets to answer a chain read. */
  readTimeoutMs?: number;
}

/** Run one lever, bounded, and report whether it says the chain is simply not there. */
async function attempt(
  lever: (chainId: number) => Promise<void>,
  targetChainId: number,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: unknown; unavailable: boolean }> {
  try {
    await withTimeout(
      lever(targetChainId),
      timeoutMs,
      "The wallet did not answer the network switch",
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error, unavailable: isChainUnavailableError(error) };
  }
}

/**
 * Put the wallet on `targetChainId` and prove it, or throw typed.
 *
 * Resolves only once the wallet REPORTS the target chain, so a caller may open a signature prompt
 * immediately afterwards. Throws a {@link TransactionError} carrying `targetChainId` and either
 * {@link CHAIN_UNAVAILABLE_CODE} (the wallet cannot offer that chain) or `WRONG_CHAIN` (it can, and
 * did not move), which is the distinction the error copy and the manual-switch button branch on.
 */
export async function ensureWalletOnChain(
  targetChainId: number,
  levers: ChainSwitchLevers,
  options: EnsureChainOptions = {},
): Promise<void> {
  const {
    settleMs = CHAIN_SWITCH_SETTLE_MS,
    pollMs,
    switchTimeoutMs = CHAIN_SWITCH_TIMEOUT_MS,
    readTimeoutMs = CHAIN_READ_TIMEOUT_MS,
  } = options;

  // A wallet that cannot answer which chain it is on cannot sign here either, so this carries the
  // same typed code the broadcast path uses for the identical condition. Without it, a dead
  // WalletConnect session classified as `unknown`, rendered the generic "didn't go through" copy,
  // mounted no Switch button and emitted no blocked-intent event: the one failure this issue exists
  // to make legible, left illegible on the pre-flight path.
  const read = async () => {
    try {
      return await withTimeout(
        levers.readChainId(),
        readTimeoutMs,
        "The wallet did not report its network",
      );
    } catch (error) {
      throw new TransactionError("Could not verify the wallet's network", {
        code: CHAIN_UNAVAILABLE_CODE,
        targetChainId,
        cause: error,
      });
    }
  };

  // Cheapest correct outcome: already there. No lever, no prompt, no wallet round trip.
  if ((await read()) === targetChainId) return;

  levers.onSwitchAttempted?.();
  let outcome = await attempt(levers.switchViaConnector, targetChainId, switchTimeoutMs);

  // Rung 2 only when rung 1 failed for a reason the other lever could plausibly fix. A wallet that
  // does not HAVE the chain will not have it for the wallet SDK either, and on an external wallet
  // that second attempt is a second prompt plus another full timeout the user waits through.
  //
  // A DECLINE is excluded for a different reason: re-prompting the instant someone says no is
  // prompt-fatigue training, and the answer would not change. It keeps WRONG_CHAIN below, because
  // that user has the chain and their remedy is to accept the switch.
  if (!outcome.ok && !outcome.unavailable && !isUserRejection(outcome.error)) {
    levers.onSwitchAttempted?.();
    outcome = await attempt(levers.switchViaWallet, targetChainId, switchTimeoutMs);
  }

  if (!outcome.ok) {
    const code = outcome.unavailable ? CHAIN_UNAVAILABLE_CODE : WRONG_CHAIN_CODE;
    throw new TransactionError(
      outcome.unavailable
        ? `Wallet cannot reach chain ${targetChainId}`
        : `Wallet did not switch to chain ${targetChainId}`,
      { code, targetChainId, cause: outcome.error },
    );
  }

  // [R3] The switch RESOLVED. That is the wallet accepting the request, which POO-1079 showed is not
  // the same as the provider having moved, so nothing downstream may assume it until this agrees.
  const landed = await awaitChainId(read, targetChainId, settleMs, pollMs);
  if (landed !== targetChainId) {
    throw new TransactionError(
      `Wallet stayed on chain ${landed} after switching to chain ${targetChainId}`,
      { code: WRONG_CHAIN_CODE, targetChainId },
    );
  }
}

/**
 * The slice of a Privy `ConnectedWallet` this needs. Structural rather than the SDK type, so the
 * ladder unit-tests without Privy and so a caller can pass any wallet handle with the same shape.
 */
export interface WalletHandle {
  /** The wallet SDK's own chain switch: rung 2 of the ladder. */
  switchChain: (chainId: number) => Promise<void>;
  /** The EIP-1193 provider the app signs and broadcasts through. */
  getEthereumProvider: () => Promise<Eip1193Provider>;
}

/**
 * Put `wallet` on `targetChainId` and hand back a provider that is REALLY on it.
 *
 * This is the call every operation hook makes in place of the old
 * `await wallet.switchChain(id); const provider = await wallet.getEthereumProvider();` pair, and the
 * ORDER is the fix: that pair fetched the provider after a switch it never verified, so on the
 * failure path it returned a working handle pointed at the wrong chain and the flow carried on into
 * a signature prompt. Here nothing is returned unless the chain has been proven.
 *
 * The provider is re-fetched after every switch attempt rather than reused, because an embedded
 * wallet's provider is initialised from the chain it was minted on (POO-1081): a handle taken before
 * the switch keeps answering with the old chain however well the switch went.
 */
export async function ensureWalletProviderOnChain(
  wallet: WalletHandle,
  targetChainId: number,
  switchViaConnector: (chainId: number) => Promise<void>,
  options?: EnsureChainOptions,
): Promise<Eip1193Provider> {
  let provider: Eip1193Provider | null = null;
  const current = async (): Promise<Eip1193Provider> => {
    if (!provider) provider = await wallet.getEthereumProvider();
    return provider;
  };

  await ensureWalletOnChain(
    targetChainId,
    {
      readChainId: async () => readProviderChainId(await current()),
      switchViaConnector,
      switchViaWallet: (chainId) => wallet.switchChain(chainId),
      // Whichever lever is about to move the chain, the cached handle belongs to the old one.
      onSwitchAttempted: () => {
        provider = null;
      },
    },
    options,
  );

  return current();
}
