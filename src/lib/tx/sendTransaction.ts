/**
 * @id PP-TX (POO-301 / POO-824 / POO-892)
 * @name sendTransaction
 * @implements-rules-version v1
 *
 * Submits a pool-party-api-built transaction through the connected wallet's EIP-1193 provider
 * and waits for the receipt. Wallet-type agnostic (single eth_sendTransaction), mirroring the
 * pool-party-interface send path. The API builds the calldata; the client only signs + sends.
 *
 * POO-824 [R1/R3]: this is the single choke point every broadcast passes through, so the target
 * chain is asserted HERE — eth_sendTransaction carries no chainId (EIP-1193), the wallet always
 * broadcasts on its current chain, and an earlier `wallet.switchChain` can no-op or be undone
 * mid-flow (POO-350). The assertion reads the wallet's actual chain, attempts ONE corrective
 * switch on mismatch, re-verifies, and otherwise fails typed (WRONG_CHAIN) — never a silent
 * wrong-chain send. Every flow (and every future wired one) inherits this via the required
 * `targetChainId` parameter.
 *
 * POO-892 [R5]: the same choke point asserts the wallet's ACTIVE account against the account the
 * tx was built for (typed WRONG_ACCOUNT) so a wallet switch mid-flow never produces a
 * mixed-identity send; `findWalletForAddress` is the companion lookup the tx hooks use instead
 * of bare `wallets[0]`.
 *
 * PP-INTEGRATION-POINT: real on-chain submission of a server-built transaction (POO-301).
 */
"use client";

import type { BuiltTx } from "./builtTxSchema";
import type { ReceiptLog } from "./decodeExecutedAmounts";

/** Minimal EIP-1193 provider surface used to submit and confirm a transaction. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** A submission or on-chain failure. `cause` carries the original provider error when present. */
export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TransactionError";
  }
}

/** Options for {@link waitForReceipt} (overridable in tests). */
export interface ReceiptOptions {
  timeoutMs?: number;
  pollMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 2500;

/** Convert a wei decimal string to a hex quantity for eth_sendTransaction. */
function toHexValue(value: string | undefined): string {
  if (!value || value === "0") return "0x0";
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return "0x0";
  }
}

/** Stable machine code for a chain mismatch the corrective switch could not resolve (POO-824). */
export const WRONG_CHAIN_CODE = "WRONG_CHAIN";

/** Stable machine code for an active-account mismatch at broadcast (POO-892 R5). */
export const WRONG_ACCOUNT_CODE = "WRONG_ACCOUNT";

/**
 * Pick the connected wallet handle matching the ACTIVE address (POO-892 R5, the established
 * lookup from useUpdateProfile): after a wallet switch, `wallets[0]` can be the stale handle.
 * Falls back to `wallets[0]` when the active address is unknown or nothing matches (the
 * broadcast-time account assertion below still catches a genuine mismatch).
 */
export function findWalletForAddress<W extends { address?: string }>(
  wallets: readonly W[],
  address: string | undefined,
): W | undefined {
  if (!address) return wallets[0];
  return wallets.find((w) => w.address?.toLowerCase() === address.toLowerCase()) ?? wallets[0];
}

/**
 * Ensure the provider's ACTIVE account is the account the transaction was built for (POO-892 R5,
 * mirroring the chain assert above): a wallet switch mid-flow otherwise produces mixed-identity
 * sends (server built for session wallet A, extension signs as B). Unlike the chain assert this
 * fails OPEN when the account cannot be read (eth_accounts unsupported or a locked wallet): the
 * provider itself rejects an unauthorized `from`, so the assert only adds the typed failure for
 * the readable mismatch case. Privy embedded wallets always report the owner and pass untouched.
 */
async function assertProviderAccount(provider: Eip1193Provider, owner: string): Promise<void> {
  let accounts: unknown;
  try {
    accounts = await provider.request({ method: "eth_accounts" });
  } catch (error) {
    console.warn("[PP] could not read the wallet's accounts; skipping the account assert", error);
    return;
  }
  const active = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
  if (!active) {
    console.warn("[PP] wallet reported no active account; skipping the account assert");
    return;
  }
  if (active.toLowerCase() !== owner.toLowerCase()) {
    throw new TransactionError(
      `Wallet's active account ${active} does not match the account this transaction was built for (${owner})`,
      { code: WRONG_ACCOUNT_CODE },
    );
  }
}

/** Read the wallet's ACTUAL active chain (eth_chainId hex quantity → number). */
async function readProviderChainId(provider: Eip1193Provider): Promise<number> {
  try {
    const hex = (await provider.request({ method: "eth_chainId" })) as string;
    return Number(BigInt(hex));
  } catch (error) {
    throw new TransactionError("Could not verify the wallet's network", error);
  }
}

/**
 * Ensure the wallet is on `targetChainId` before broadcasting (POO-824 R1/R3). On mismatch it
 * attempts ONE corrective EIP-3326 switch and re-verifies; a switch that rejects or silently
 * no-ops (the Privy external-wallet gap behind POO-350) throws a typed WRONG_CHAIN error.
 */
async function assertProviderOnChain(
  provider: Eip1193Provider,
  targetChainId: number,
): Promise<void> {
  const actual = await readProviderChainId(provider);
  if (actual === targetChainId) return;
  // Recoveries must be visible in logs, not just failures (POO-824 R5).
  console.warn("[PP] wallet on the wrong chain at broadcast; switching", {
    actual,
    target: targetChainId,
  });
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${targetChainId.toString(16)}` }],
    });
  } catch (error) {
    throw new TransactionError(
      `Wallet is on chain ${actual} but this transaction targets chain ${targetChainId}`,
      // POO-1026 [R2]: carry the target chain so the error copy can name the network.
      { code: WRONG_CHAIN_CODE, targetChainId, cause: error },
    );
  }
  const switched = await readProviderChainId(provider);
  if (switched !== targetChainId) {
    throw new TransactionError(
      `Wallet stayed on chain ${switched} after switching; this transaction targets chain ${targetChainId}`,
      { code: WRONG_CHAIN_CODE, targetChainId },
    );
  }
}

/**
 * Submit the built transaction; resolves with the transaction hash. `targetChainId` is the chain
 * the flow built the tx for — asserted against the wallet's actual chain (and against the build's
 * own `chainId` when the API returns one, POO-824 R4) before the send.
 */
export async function sendBuiltTransaction(
  provider: Eip1193Provider,
  built: BuiltTx,
  from: string,
  targetChainId: number,
): Promise<`0x${string}`> {
  // POO-824 [R4]: a build that declares its chain must agree with the flow's target — a mismatch
  // is a build/target bug and is never sendable, on any chain.
  if (built.chainId != null && built.chainId !== targetChainId) {
    throw new TransactionError(
      `Transaction was built for chain ${built.chainId} but targets chain ${targetChainId}`,
      { code: WRONG_CHAIN_CODE },
    );
  }
  // POO-892 [R5]: assert the EFFECTIVE from (the build's pinned from when present, else the
  // flow's owner) against the wallet's active account before any wallet interaction.
  await assertProviderAccount(provider, built.tx.from ?? from);
  await assertProviderOnChain(provider, targetChainId);
  try {
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          to: built.tx.to,
          from: built.tx.from ?? from,
          data: built.tx.data,
          value: toHexValue(built.tx.value),
        },
      ],
    });
    return hash as `0x${string}`;
  } catch (error) {
    throw new TransactionError("Failed to submit the transaction", error);
  }
}

/** The mined receipt facts callers need: the block it landed in + the event logs. */
export interface ReceiptResult {
  /** The block the tx was mined into, parsed from the receipt's hex `blockNumber`; null if absent. */
  blockNumber: number | null;
  /**
   * The receipt's event logs, preserved for the truthful-amounts decode (POO-810 R1): the real
   * ERC-20 `Transfer`-to-user events are summed from these. `[]` when the node omits logs — the
   * decoder then yields nothing and the caller falls back to the pre-broadcast figure (R9).
   */
  logs: ReceiptLog[];
}

/** Parse a receipt's hex `blockNumber` (e.g. "0x1a2b") into a number; null when absent/unparseable. */
function parseBlockNumber(hex: string | undefined): number | null {
  if (!hex) return null;
  try {
    const value = Number(BigInt(hex));
    return Number.isSafeInteger(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Poll for the receipt until mined (`0x1` → ok, otherwise revert) or timed out. Resolves with the
 * mined block number (POO-308: the create-pool flow feeds it into POO-638 convergence) and the
 * receipt `logs` (POO-810 R1: the truthful-amounts decode reads the ERC-20 `Transfer`-to-user
 * events from them). A node that omits `blockNumber`/`logs` yields `{ blockNumber: null, logs: [] }`
 * — success is still gated on the `status`, and the empty logs drive the R9 fallback downstream.
 */
export async function waitForReceipt(
  provider: Eip1193Provider,
  hash: `0x${string}`,
  { timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS }: ReceiptOptions = {},
): Promise<ReceiptResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string; blockNumber?: string; logs?: ReceiptLog[] } | null;

    if (receipt?.status) {
      if (receipt.status === "0x1")
        return { blockNumber: parseBlockNumber(receipt.blockNumber), logs: receipt.logs ?? [] };
      throw new TransactionError("The transaction reverted on-chain");
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new TransactionError("Transaction confirmation timed out");
}

/** Submit and confirm a built transaction; resolves with the mined transaction hash. */
export async function executeBuiltTransaction(
  provider: Eip1193Provider,
  built: BuiltTx,
  from: string,
  targetChainId: number,
  receiptOptions?: ReceiptOptions,
): Promise<`0x${string}`> {
  const hash = await sendBuiltTransaction(provider, built, from, targetChainId);
  await waitForReceipt(provider, hash, receiptOptions);
  return hash;
}

/**
 * Like {@link executeBuiltTransaction} but also resolves the mined block (POO-308): the create-pool
 * send step threads `blockNumber` into the flow context so the success handler can drive POO-638
 * deterministic convergence (indexed block >= receipt block). Other callers keep the hash-only form.
 */
export async function executeBuiltTransactionWithReceipt(
  provider: Eip1193Provider,
  built: BuiltTx,
  from: string,
  targetChainId: number,
  receiptOptions?: ReceiptOptions,
): Promise<{ hash: `0x${string}`; blockNumber: number | null }> {
  const hash = await sendBuiltTransaction(provider, built, from, targetChainId);
  const { blockNumber } = await waitForReceipt(provider, hash, receiptOptions);
  return { hash, blockNumber };
}

/**
 * Like {@link executeBuiltTransaction} but also resolves the receipt `logs` (POO-810 R1): the
 * invest/collect/withdraw executors decode the real ERC-20 `Transfer`-to-user events from them to
 * surface the truthful executed amounts on the success receipt. Empty `logs` (a node that omits
 * them) drives the R9 fallback to the pre-broadcast figure. Hash-only callers keep
 * {@link executeBuiltTransaction}.
 *
 * PP-INTEGRATION-POINT: the real on-chain receipt logs the truthful-amounts decode consumes.
 */
export async function executeBuiltTransactionWithLogs(
  provider: Eip1193Provider,
  built: BuiltTx,
  from: string,
  targetChainId: number,
  receiptOptions?: ReceiptOptions,
): Promise<{ hash: `0x${string}`; logs: ReceiptLog[] }> {
  const hash = await sendBuiltTransaction(provider, built, from, targetChainId);
  const { logs } = await waitForReceipt(provider, hash, receiptOptions);
  return { hash, logs };
}
