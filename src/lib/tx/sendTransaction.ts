/**
 * @id PP-TX (POO-301 / POO-824 / POO-892 / POO-1093 / POO-1826 / POO-1783)
 * @name sendTransaction
 * @implements-rules-version v4 (POO-1783 rules v1) · v3 (POO-1826 rules v1) · v2 (POO-1385 rules v2) · v1
 *
 * Submits a pool-party-api-built transaction through the connected wallet's EIP-1193 provider
 * and waits for the receipt. Wallet-type agnostic (single eth_sendTransaction), mirroring the
 * pool-party-interface send path. The API builds the calldata; the client only signs + sends.
 *
 * POO-824 [R1/R3]: this is the single choke point every broadcast passes through, so the target
 * chain is asserted HERE. POO-1080 corrects the original reasoning: EIP-1193 does not REQUIRE a
 * chainId on `eth_sendTransaction`, but a wallet may honour one, and a Privy embedded wallet routes
 * by it. Omitting it sent a Base transaction to Polygon's RPC while the switch reported success.
 * The request now states the target chain AND the assertion still runs, because an injected wallet
 * ignores the field and broadcasts on whatever chain it is pointed at. An earlier
 * `wallet.switchChain` can also no-op or be undone
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
 * POO-1826 [R2]: the build response may advertise a gas LIMIT, and this is the only place it can
 * reach the wallet. Left to its own `eth_estimateGas`, a wallet broadcasts a 13-frame manager write
 * at the bare estimate, EIP-150's 63/64 rule strands ~7% of it, and the deepest frame runs out of
 * gas: the Robinhood move range `0x38b45a3e…c83f37b` failed exactly that way, with EMPTY revert
 * data. When the build states one it is forwarded; when it does not, the request is unchanged.
 *
 * POO-1783 [R1]: the corrective switch now teaches the wallet the chain when it does not have one.
 * A wallet that has never added chain 4663 answers with EIP-3326's 4902, and until now that was the
 * end of the flow: "Wallet cannot reach chain 4663", with no way to fix it from inside the app. The
 * chain's definition already lives in `src/lib/chains/config.ts`, so it is offered via
 * `wallet_addEthereumChain` and the switch is retried ONCE. Every other switch failure keeps the
 * surface it had [R2], and the landing verification below is unchanged: an accepted add is not a
 * completed switch.
 *
 * PP-INTEGRATION-POINT: real on-chain submission of a server-built transaction (POO-301).
 */
"use client";

import { addEthereumChainParams } from "@/lib/chains/config";
import { TimeoutError, withTimeout } from "@/lib/utils/withTimeout";
import type { BuiltTx } from "./builtTxSchema";
import type { ReceiptLog } from "./decodeExecutedAmounts";
// One direction only: `diagnostics` does not import this module, so classifying here is cycle-free.
import { classifyTxError } from "./diagnostics";

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

/**
 * A receipt came back saying the transaction FAILED. Distinct from a confirmation timeout, which
 * says only that we never learned the outcome. POO-1093 turns on that distinction.
 */
export const TX_REVERTED = "TX_REVERTED";

/**
 * POO-1763 [R9]: we broadcast, then the receipt poll hit its ceiling with no answer. The transaction
 * MAY be on chain, so this is NOT a revert ("nothing moved, safe to retry") and NOT `transient`
 * ("nothing moved, try again"): both would lie about the funds and invite a blind re-broadcast. It
 * gets its own `confirmationTimeout` kind, which carries the hash and tells the user to check their
 * wallet before retrying. Kept out of the `transient` message class in `diagnostics.ts` precisely by
 * carrying this code, which classifies before any message pattern runs.
 */
export const TX_CONFIRMATION_UNKNOWN_CODE = "TX_CONFIRMATION_UNKNOWN";

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

/**
 * The gas LIMIT to state on the request, as a hex quantity, or `undefined` to let the wallet
 * estimate (POO-1826 [R2]).
 *
 * Deliberately NOT `toHexValue`'s silent-zero fallback: `0x0` is a valid-looking limit that
 * guarantees an out-of-gas failure, which is the very defect this forwards a limit to prevent. A
 * missing, zero or unparseable advertisement is therefore dropped, restoring the wallet's own
 * estimate rather than broadcasting a doomed request.
 */
function toGasQuantity(gas: string | undefined): string | undefined {
  if (!gas) return undefined;
  try {
    const limit = BigInt(gas);
    return limit > BigInt(0) ? `0x${limit.toString(16)}` : undefined;
  } catch {
    return undefined;
  }
}

/** Stable machine code for a chain mismatch the corrective switch could not resolve (POO-824). */
export const WRONG_CHAIN_CODE = "WRONG_CHAIN";

/** Stable machine code for an active-account mismatch at broadcast (POO-892 R5). */
export const WRONG_ACCOUNT_CODE = "WRONG_ACCOUNT";

/**
 * Stable machine code for a chain the WALLET DOES NOT HAVE (POO-1385 [R5]).
 *
 * Deliberately not {@link WRONG_CHAIN_CODE}, because the two need opposite sentences from the user.
 * `WRONG_CHAIN` says the wallet is pointed somewhere else and the remedy is to move it. This says the
 * wallet cannot be pointed there at all, and the remedy is to enable that network in the wallet app
 * and reconnect. Telling a Ledger Live user with only Arbitrum paired to "switch to Polygon" sends
 * them looking for a control that does not exist in their session.
 *
 * Raised for an EIP-3326 `4902`, for the WalletConnect namespace rejections, and for a switch request
 * that is never ANSWERED, which is the shape Ledger Live actually produces: a chain outside the
 * approved session namespace is not refused, it is dropped, and an unbounded await on it is what
 * froze the app.
 */
export const CHAIN_UNAVAILABLE_CODE = "CHAIN_UNAVAILABLE";

/**
 * How long a wallet gets to ANSWER a switch request (POO-1385 [R4]). Generous, because an external
 * wallet may need a confirmation tap in a phone app; bounded, because the alternative is the freeze.
 */
export const CHAIN_SWITCH_TIMEOUT_MS = 30_000;

/** How long a wallet gets to answer `eth_chainId`. A read needs no human, so it is short. */
export const CHAIN_READ_TIMEOUT_MS = 5_000;

/**
 * Patterns for "this wallet has never heard of that chain", the subset that ADDING can fix
 * (POO-1783 [R1]). Wallets that do not set the 4902 code say it in these words instead.
 */
const UNRECOGNIZED_CHAIN_PATTERNS = [/unrecognized chain/i, /unsupported chain/i];

/**
 * Patterns for "this wallet does not have that chain", matched across an error's message chain.
 * A superset of {@link UNRECOGNIZED_CHAIN_PATTERNS}: the extra entries are chains the wallet cannot
 * reach for reasons an add would not resolve.
 *
 * Kept narrow on purpose. The two NEGATIVES are what the narrowness protects: a connector that
 * reports it cannot switch means "use the other lever" and must not short-circuit the fallback, and a
 * declined prompt is a chain the wallet plainly has (POO-1026 pins that as `wrongChain`).
 */
const CHAIN_UNAVAILABLE_PATTERNS = [
  ...UNRECOGNIZED_CHAIN_PATTERNS,
  /chain(?: id)?\s*\d*\s*(?:is )?not (?:approved|added|available|enabled|configured in the wallet)/i,
  /approve\(\) namespaces(?:\/| )?chains/i,
  /non conforming namespaces/i,
];

/**
 * Walk an error's cause chain once, collecting what the two chain predicates below both need: every
 * message on the way down, and whether EIP-3326's `4902` appears anywhere in it.
 *
 * Bounded at four links because a provider error can be self-referential, and because nothing
 * meaningful has ever been found deeper than the wallet's own wrapper around the RPC error.
 */
function chainErrorSignals(error: unknown): { unrecognizedCode: boolean; messages: string } {
  const seen: string[] = [];
  let unrecognizedCode = false;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (typeof current === "string") {
      seen.push(current);
      break;
    }
    if (typeof current !== "object") break;
    const source = current as { code?: unknown; message?: unknown; cause?: unknown };
    // EIP-3326's own "Unrecognized chain ID" code, the one unambiguous signal in the set.
    if (source.code === 4902 || source.code === "4902") unrecognizedCode = true;
    if (typeof source.message === "string") seen.push(source.message);
    current = source.cause;
  }
  return { unrecognizedCode, messages: seen.join("\n") };
}

/**
 * Whether the wallet is saying it does not KNOW this chain (POO-1783 [R1]).
 *
 * Deliberately narrower than {@link isChainUnavailableError}, because this predicate decides whether
 * to spend a second wallet round trip on `wallet_addEthereumChain`. Silence and a WalletConnect
 * namespace rejection are both "cannot reach", and neither is FIXED by adding: a chain outside an
 * approved namespace drops the add exactly the way it dropped the switch, so treating those as
 * addable would only double the freeze POO-1385 bounded and end at the same error.
 */
export function isUnrecognizedChainError(error: unknown): boolean {
  if (error instanceof TimeoutError) return false;
  const { unrecognizedCode, messages } = chainErrorSignals(error);
  return unrecognizedCode || UNRECOGNIZED_CHAIN_PATTERNS.some((pattern) => pattern.test(messages));
}

/**
 * Whether `error` says the wallet cannot offer this chain at all (POO-1385 [R5]).
 *
 * A {@link TimeoutError} counts: a wallet that never answers a switch is indistinguishable, from
 * here, from one that refused it, and the actionable reading of silence on a WalletConnect session
 * is that the chain is not in the approved namespace.
 */
export function isChainUnavailableError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  const { unrecognizedCode, messages } = chainErrorSignals(error);
  return unrecognizedCode || CHAIN_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(messages));
}

/**
 * Stable machine code for a build-vs-target discrepancy (POO-824 R4, split out in POO-1026): the
 * API built the calldata for one chain and the flow targets another. Deliberately NOT
 * {@link WRONG_CHAIN_CODE} — the wallet may well be sitting on the correct chain, so this is a
 * server/client build bug, not a user-recoverable wallet state. It is kept OUT of the diagnostics
 * catalog on purpose so it classifies as `"unknown"` and renders the generic copy: telling the user
 * to switch networks here would send them to fix something that is not broken on their side.
 */
export const BUILD_TARGET_MISMATCH_CODE = "BUILD_TARGET_MISMATCH";

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
/**
 * How long a wallet gets to actually LAND on the chain it just agreed to switch to (POO-1077).
 *
 * `wallet_switchEthereumChain` RESOLVING means the wallet accepted the request, not that it has
 * finished applying it. An injected wallet updates its reported chain before resolving, so reading
 * `eth_chainId` once immediately afterwards worked and shipped. A Privy EMBEDDED wallet applies the
 * switch asynchronously and keeps reporting the OLD chain for a moment, so that single re-read
 * failed a wallet that was about to be perfectly fine.
 *
 * Bounded deliberately: a wallet still on the wrong chain after this has genuinely not switched, and
 * waiting longer would hold a prompt open against a quote that is going stale.
 */
export const CHAIN_SWITCH_SETTLE_MS = 4_000;
/** How often to re-read while waiting. Short enough to feel instant when the switch is quick. */
const CHAIN_SWITCH_POLL_MS = 120;

/**
 * Read a chain until it reports `targetChainId`, or the budget runs out.
 *
 * Polls rather than listening for `chainChanged`: {@link Eip1193Provider} is deliberately narrowed
 * to `request` alone, and a provider that does not emit the event would wait the full budget for
 * nothing. Returns whatever the chain finally reads as, so the caller reports the REAL one.
 *
 * Generic over a reader (POO-1385) so the pre-signature ladder in `ensureWalletChain.ts` and this
 * broadcast-time backstop share ONE verification loop instead of drifting apart.
 */
export async function awaitChainId(
  readChainId: () => Promise<number>,
  targetChainId: number,
  budgetMs: number,
  pollMs = CHAIN_SWITCH_POLL_MS,
): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let actual = await readChainId();
  while (actual !== targetChainId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    actual = await readChainId();
  }
  return actual;
}

/**
 * Read the provider's active chain, bounded (POO-1385 [R4]).
 *
 * The bound is not defensive dressing: a WalletConnect session whose peer has gone quiet answers
 * NOTHING, and this read sits directly in front of every broadcast. Unbounded, one silent wallet
 * wedged the whole flow with no error and no way out.
 */
export async function readProviderChainId(provider: Eip1193Provider): Promise<number> {
  try {
    const hex = (await withTimeout(
      provider.request({ method: "eth_chainId" }),
      CHAIN_READ_TIMEOUT_MS,
      "The wallet did not report its network",
    )) as string;
    return Number(BigInt(hex));
  } catch (error) {
    throw new TransactionError("Could not verify the wallet's network", error);
  }
}

/**
 * Ask the wallet to move to `targetChainId`, bounded (POO-1385 [R4]).
 *
 * A chain outside a WalletConnect session's approved namespace is not refused, it is never answered,
 * and this await is where the app used to hang forever.
 */
async function requestChainSwitch(provider: Eip1193Provider, targetChainId: number): Promise<void> {
  await withTimeout(
    provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${targetChainId.toString(16)}` }],
    }),
    CHAIN_SWITCH_TIMEOUT_MS,
    "The wallet did not answer the network switch",
  );
}

/**
 * Move the provider onto `targetChainId`, teaching the wallet the chain first when it does not know
 * it (POO-1783 [R1]). Returns the error to report, or `undefined` once the wallet accepted a switch.
 *
 * The Robinhood alpha is what forced this: an external wallet that has never added chain 4663
 * answers the corrective switch with 4902, and the flow ended there with "Wallet cannot reach chain
 * 4663" and nothing the user could do about it from inside the app. Privy embedded wallets carry
 * every configured chain, which is why the alpha smoke never saw it and three external wallets did.
 *
 * ONE retry [R1], and only after an add the wallet accepted. The add is not itself proof of a
 * switch, so the caller's landing verification still runs afterwards exactly as before.
 *
 * The outcome is a tagged result rather than an error-or-undefined, matching `attempt()` in
 * `ensureWalletChain.ts`: a provider is free to reject with `undefined`, and a sentinel that a
 * wallet can forge is a silent wrong-chain send.
 */
async function switchWithAddFallback(
  provider: Eip1193Provider,
  targetChainId: number,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await requestChainSwitch(provider, targetChainId);
    return { ok: true };
  } catch (switchError) {
    const params = addEthereumChainParams(targetChainId);
    // [R2] Everything else keeps today's surface untouched: a declined switch is a chain the wallet
    // plainly HAS, and a chain this app has no definition of is nothing we can offer to add.
    if (!params || !isUnrecognizedChainError(switchError)) return { ok: false, error: switchError };
    try {
      await withTimeout(
        provider.request({ method: "wallet_addEthereumChain", params: [params] }),
        CHAIN_SWITCH_TIMEOUT_MS,
        "The wallet did not answer the request to add the network",
      );
    } catch {
      // A declined or dropped ADD leaves the wallet exactly where the 4902 found it. That first
      // answer is still the true diagnosis and the actionable one, so it is what gets reported,
      // rather than a rejection code that would render "switch to a network you do not have".
      return { ok: false, error: switchError };
    }
    try {
      await requestChainSwitch(provider, targetChainId);
      return { ok: true };
    } catch (retryError) {
      // The chain IS there now, so this is an ordinary wrong-chain state with an ordinary remedy.
      // Reporting it as unavailable would send the user hunting for a network they just gained.
      return { ok: false, error: retryError };
    }
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
  // POO-824 R5 asked for recoveries to be visible in logs. That was written when a wrong chain was
  // an ANOMALY. Since the funding rail, a plan legitimately changes chain between legs, so this
  // fired on every cross-chain broadcast and became noise in a console the user needs for real
  // signals. The typed WRONG_CHAIN failure below is still loud; the ordinary path is now quiet.
  const outcome = await switchWithAddFallback(provider, targetChainId);
  if (!outcome.ok) {
    // POO-1385 [R5]: a chain the wallet does not HAVE is a different failure from a wallet pointed
    // at the wrong one, and gets copy the user can act on instead of "switch to a network you have
    // no way to select".
    const code = isChainUnavailableError(outcome.error) ? CHAIN_UNAVAILABLE_CODE : WRONG_CHAIN_CODE;
    throw new TransactionError(
      code === CHAIN_UNAVAILABLE_CODE
        ? `Wallet cannot reach chain ${targetChainId}`
        : `Wallet is on chain ${actual} but this transaction targets chain ${targetChainId}`,
      // POO-1026 [R2]: carry the target chain so the error copy can name the network.
      { code, targetChainId, cause: outcome.error },
    );
  }
  // Not a single re-read: the switch is applied asynchronously by some wallets ([R2], POO-1077).
  const switched = await awaitChainId(
    () => readProviderChainId(provider),
    targetChainId,
    CHAIN_SWITCH_SETTLE_MS,
  );
  if (switched !== targetChainId) {
    throw new TransactionError(
      `Wallet stayed on chain ${switched} after switching; this transaction targets chain ${targetChainId}`,
      { code: WRONG_CHAIN_CODE, targetChainId },
    );
  }
}

/**
 * How much of the wallet's own message to carry.
 *
 * A viem provider error's `.message` is a multi-kilobyte blob (`Request body:` + `Details:` +
 * `Version:` + a docs URL), and this string now reaches React state, the DOM, the clipboard and a
 * Sentry event. The length is controlled by the RPC, not by us. The first line or two is where the
 * diagnosis lives; the rest is boilerplate that would only cost quota and legibility.
 */
const PROVIDER_MESSAGE_MAX = 500;

/** The wallet's OWN words for a failure, dug out of wherever the provider put them, bounded. */
function providerMessage(error: unknown): string | undefined {
  if (typeof error === "string") return clip(error);
  if (typeof error !== "object" || error === null) return undefined;
  const source = error as {
    message?: unknown;
    shortMessage?: unknown;
    data?: { message?: unknown };
  };
  for (const candidate of [source.shortMessage, source.message, source.data?.message]) {
    if (typeof candidate === "string" && candidate.trim()) return clip(candidate);
  }
  return undefined;
}

function clip(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= PROVIDER_MESSAGE_MAX
    ? trimmed
    : `${trimmed.slice(0, PROVIDER_MESSAGE_MAX)}…`;
}

/** Whether the wallet is telling us the USER said no. Their answer, never a fault to diagnose. */
export function isUserRejection(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (code === 4001 || code === "4001") return true;
  return /user rejected|user denied|rejected the request/i.test(providerMessage(error) ?? "");
}

/**
 * Turn a failed `eth_sendTransaction` into an error that says something (POO-1385, added after the
 * first real Ledger run).
 *
 * Disabling the operation's network in the wallet mid-flow produced `INVEST_FAILED` / "Failed to
 * submit the transaction", the generic copy. The chain ladder had already passed, because the wallet
 * still REPORTED the right chain, so the whole thing only surfaced here, in a catch that threw away
 * every signal it had: the wallet's own message never reached the error, so neither the classifier,
 * nor the details box, nor the clipboard payload could see it.
 *
 * Four ways out, in order of how much they assume:
 *   1. the wallet NAMES the chain problem, so believe it;
 *   2. the user declined, which is an answer and not a fault (checked before the probe below,
 *      because a stable `CHAIN_UNAVAILABLE` code would otherwise outrank the rejection message);
 *   3. the error ALREADY classifies as something specific (a revert, a slippage failure, a funds
 *      shortfall). A stable code outranks every message pattern in `classifyTxError`, so relabelling
 *      one of those as a chain fault would DESTROY a correct classification to guess at a worse one.
 *      Only a genuinely opaque failure earns the probe;
 *   4. so ask the wallet where it is NOW, and answer the two outcomes separately, because they are
 *      the two different kinds this issue exists to tell apart:
 *        - it cannot answer at all      -> `CHAIN_UNAVAILABLE` (it cannot sign here either)
 *        - it answers a DIFFERENT chain -> `WRONG_CHAIN` (it plainly has chains, and moved)
 *      Collapsing those two into `CHAIN_UNAVAILABLE` told a user who had switched networks in their
 *      wallet mid-confirm to go and enable a network they were demonstrably already using.
 *      A wallet still on the target chain did not lose it, and stays generic.
 */
async function describeSendFailure(
  provider: Eip1193Provider,
  error: unknown,
  targetChainId: number,
): Promise<TransactionError> {
  const detail = providerMessage(error);
  const message = detail
    ? `Failed to submit the transaction: ${detail}`
    : "Failed to submit the transaction";

  if (isChainUnavailableError(error)) {
    return new TransactionError(message, {
      code: CHAIN_UNAVAILABLE_CODE,
      targetChainId,
      cause: error,
    });
  }
  if (isUserRejection(error)) return new TransactionError(message, error);
  // [3] Already diagnosable on its own terms: do not overwrite it with a guess. POO-1763 [R9]:
  // `transient` is NOT "already diagnosed" here. An "Internal JSON-RPC error" envelope is exactly
  // what a wallet returns when its network went away mid-send, and the probe below is the only
  // thing that can tell that apart from a hiccup; a wallet still on its chain keeps `transient`.
  const kind = classifyTxError(error);
  if (kind !== "unknown" && kind !== "transient") return new TransactionError(message, error);

  let actual: number | null;
  try {
    actual = await readProviderChainId(provider);
  } catch {
    // The wallet cannot even answer which chain it is on. Whatever else is true, it cannot sign here.
    actual = null;
  }
  if (actual === targetChainId) return new TransactionError(message, error);
  return new TransactionError(message, {
    code: actual === null ? CHAIN_UNAVAILABLE_CODE : WRONG_CHAIN_CODE,
    targetChainId,
    cause: error,
  });
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
  // is a build/target bug and is never sendable, on any chain. POO-1026: typed
  // BUILD_TARGET_MISMATCH, not WRONG_CHAIN, and worded to avoid the "targets chain <id>" phrasing
  // the wrongChain message pattern keys on, so this never renders "switch networks in your wallet".
  if (built.chainId != null && built.chainId !== targetChainId) {
    throw new TransactionError(
      `Transaction was built for chain ${built.chainId} but this flow expects chain ${targetChainId}`,
      { code: BUILD_TARGET_MISMATCH_CODE },
    );
  }
  // POO-892 [R5]: assert the EFFECTIVE from (the build's pinned from when present, else the
  // flow's owner) against the wallet's active account before any wallet interaction.
  await assertProviderAccount(provider, built.tx.from ?? from);
  await assertProviderOnChain(provider, targetChainId);
  // POO-1826 [R2]: the build's advertised limit, when it advertises a usable one. Spread in rather
  // than set to `undefined`, so a build without one produces the pre-POO-1826 request exactly.
  const gas = toGasQuantity(built.tx.gas);
  try {
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          to: built.tx.to,
          from: built.tx.from ?? from,
          data: built.tx.data,
          value: toHexValue(built.tx.value),
          ...(gas ? { gas } : {}),
          // POO-1080: the target chain, stated on the REQUEST rather than left to the wallet's
          // current one. An injected wallet ignores this and broadcasts wherever it is pointed,
          // which is why the header above assumed it was unnecessary. A Privy EMBEDDED wallet
          // ROUTES BY IT: absent, it estimates and sends against its own configured RPC, so a
          // Base transaction went to `polygon-mainnet.rpc.privy.systems` and failed for
          // "insufficient funds" against a POL balance, having reported the chain switch as
          // successful moments earlier. Stating it costs nothing and removes the ambiguity.
          chainId: `0x${targetChainId.toString(16)}`,
        },
      ],
    });
    return hash as `0x${string}`;
  } catch (error) {
    throw await describeSendFailure(provider, error, targetChainId);
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
  let lastReadError: string | undefined;

  while (Date.now() < deadline) {
    try {
      const receipt = (await provider.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      })) as { status?: string; blockNumber?: string; logs?: ReceiptLog[] } | null;

      lastReadError = undefined;
      if (receipt?.status) {
        if (receipt.status === "0x1")
          return { blockNumber: parseBlockNumber(receipt.blockNumber), logs: receipt.logs ?? [] };
        // A receipt that says the transaction failed is a real ANSWER, not a failed read. Terminal.
        // The code lets a caller tell a REVERT (nothing moved, safe to retry) from a TIMEOUT (we
        // never learned, so it may well be on chain) without matching on prose.
        throw new TransactionError("The transaction reverted on-chain", { code: TX_REVERTED });
      }
    } catch (error) {
      // POO-1093 [R1]: a dropped read says NOTHING about where the money is, so it must not fail
      // the step. Before this, one flaky `eth_getTransactionReceipt` failed the leg, and on the
      // provisioning rail a failed leg arms an unconditional "Try again" that re-broadcasts a
      // transaction already on chain. `awaitBridgeSettlement` and `reconcileFundingJournal` already
      // treat a degraded read as "no evidence"; this brings the receipt poll in line with them.
      //
      // The revert above is deliberately rethrown rather than swallowed: it is an answer.
      if (error instanceof TransactionError) throw error;
      lastReadError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  // Carry the last read failure. "Timed out" alone would send someone hunting a slow chain when
  // the truth is that their RPC never answered.
  //
  // POO-1763 [R9]: a STABLE code plus the hash. The code makes this classify as `confirmationTimeout`
  // (a broadcast we could not confirm) instead of falling to the `transient` message pattern, whose
  // "Nothing was moved. Try again" is a false claim here — the transaction may well be on chain. The
  // hash rides along so the user can check their wallet activity, which the honest copy tells them to.
  throw new TransactionError(
    lastReadError
      ? `Transaction confirmation timed out (last read failed: ${lastReadError})`
      : "Transaction confirmation timed out",
    { code: TX_CONFIRMATION_UNKNOWN_CODE, txHash: hash },
  );
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
