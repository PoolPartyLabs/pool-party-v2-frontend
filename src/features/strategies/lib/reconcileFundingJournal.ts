/**
 * @id PP-STR-LIB-020 (POO-1038, POO-1055)
 * @name funding journal reconciliation
 * @implements-rules-version v2 (POO-1055 rules v1) · v1 (POO-1038 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Reconciles a {@link FundingJournal} against the chain, which is the only actual authority on
 * whether a transaction happened. Implements the decision table of
 * `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.5 and the destination-arrival test of §3.6.
 *
 * ## Three rules bind the whole table
 *
 * 1. **An ambiguous state is never resolved by broadcasting.** It is resolved by reading, or by
 *    asking. A re-broadcast is how a user pays twice, and a duplicate bridge deposit is not
 *    refundable by us. {@link ChainReader} has three read methods and no way to send anything: the
 *    type is the guarantee, not a comment.
 * 2. **A journal for a different wallet is never acted on.** That filter lives in
 *    {@link findResumableJournal}, so a foreign journal never reaches this function.
 * 3. **Nothing auto-broadcasts on load.** This is a read. It produces a surfaced state and an
 *    {@link JournalReconciliation.action} the user presses. Silently continuing to move money
 *    because a tab reopened is not acceptable regardless of how safe the reconciliation is.
 *
 * ## Why re-deriving is the safe resolution
 *
 * A funding plan is a pure function of current holdings (§3.1), so `"rederive"` is correct whichever
 * way an ambiguity resolves: if the leg did execute, its output is already in the balances and the
 * new plan will not repeat it. That is why the worst outcome here is a re-derive plus a question,
 * never a re-broadcast.
 *
 * PP-INTEGRATION-POINT: {@link ChainReader} is implemented over real RPC by the caller. The three
 * reads map 1:1 onto viem's `getTransactionReceipt`, `getTransactionCount({ blockTag: "latest" })`
 * and an ERC-20 `balanceOf` (`readErc20Balance`, PP-MGR/POO-309), each on the leg's OWN chain, which
 * is why the reader takes `chainId` per call rather than being bound to one client.
 */
"use client";

import type { FundingJournal, FundingLeg } from "./fundingJournal";
import { updateLeg } from "./fundingJournal";

/**
 * How long a broadcast leg is given before its silence counts as evidence (§3.6). Under the ceiling,
 * no receipt means "still pending" and the answer is to wait; at the ceiling the account nonce
 * becomes the tie-breaker. Ten minutes against an `estimatedFillTimeMs` measured in seconds.
 */
export const JOURNAL_POLL_CEILING_MS = 10 * 60_000;

/** Reads only. Every method takes its own `chainId`: a route spans chains, a client does not. */
export interface ChainReader {
  /** `null` when the node has no receipt yet, which is a legitimate in-flight answer. */
  getTransactionReceipt: (args: {
    chainId: number;
    txHash: string;
  }) => Promise<{ status: "success" | "reverted" } | null>;
  /** `eth_getTransactionCount(address, "latest")`. */
  getTransactionCount: (args: { chainId: number; address: string }) => Promise<number>;
  /** ERC-20 `balanceOf`, base units as a decimal string. */
  getTokenBalance: (args: { chainId: number; token: string; owner: string }) => Promise<string>;
}

/**
 * What the chain says about one leg.
 *
 * - `settled` — done (for a bridge: ARRIVED, not merely left).
 * - `pending` — in flight. Wait and poll. Never re-broadcast.
 * - `reverted` — mined and failed. The money did not move; the gas did.
 * - `absent`  — nothing of ours is on-chain. Safe to re-derive and execute.
 * - `unknown` — ambiguous. Surface it and ask. Never broadcast.
 */
export type LegVerdict = "settled" | "pending" | "reverted" | "absent" | "unknown";

/** One reconciled leg, with the i18n key that explains it. Keys, never copy: this is a lib. */
export interface ReconciledLeg {
  index: number;
  verdict: LegVerdict;
  reasonKey: string;
  /** The hash, when we hold one, so the surface can link to the explorer. */
  txHash?: string;
  chainId: number;
}

/**
 * What the user may do next.
 *
 * - `complete`  — every leg settled; retire the journal.
 * - `wait`      — something is in flight; poll, show it, offer nothing that sends.
 * - `rederive`  — safe to re-plan from fresh balances and continue (the Resume button).
 * - `ask`       — an ambiguous leg. Show the account, the chain and the amount, and let the user
 *                 choose. The only safe path we offer is a re-derive, which is correct either way.
 */
export type JournalAction = "complete" | "wait" | "rederive" | "ask";

export interface JournalReconciliation {
  journalId: string;
  legs: ReconciledLeg[];
  action: JournalAction;
  /** i18n key for the whole journal's state, for the "you have funding in progress" surface. */
  statusKey: string;
}

/** i18n keys, one per verdict. Investor-facing copy lives in `strategies.json`, never here. */
export const RECOVERY_REASON_KEYS: Record<LegVerdict, string> = {
  settled: "provisioning.recovery.leg.settled",
  pending: "provisioning.recovery.leg.pending",
  reverted: "provisioning.recovery.leg.reverted",
  absent: "provisioning.recovery.leg.absent",
  unknown: "provisioning.recovery.leg.unknown",
};

/** i18n keys, one per action. */
export const RECOVERY_STATUS_KEYS: Record<JournalAction, string> = {
  complete: "provisioning.recovery.status.complete",
  wait: "provisioning.recovery.status.wait",
  rederive: "provisioning.recovery.status.rederive",
  ask: "provisioning.recovery.status.ask",
};

/**
 * Reconcile every leg against the chain, in route order.
 *
 * Pure with respect to storage: it reads the chain and returns verdicts. Persisting the corrections
 * is {@link applyReconciliation}, split out so the decision table can be tested without a store and
 * so a caller can show the state before it writes anything.
 */
export async function reconcileJournal(
  journal: FundingJournal,
  chain: ChainReader,
  now: number = Date.now(),
): Promise<JournalReconciliation> {
  const legs: ReconciledLeg[] = [];
  for (const leg of journal.legs) {
    const verdict = await verdictFor(leg, journal.wallet, chain, now);
    legs.push({
      index: leg.index,
      verdict,
      reasonKey: RECOVERY_REASON_KEYS[verdict],
      chainId: leg.chainId,
      ...(leg.txHash === undefined ? {} : { txHash: leg.txHash }),
    });
  }
  const action = resolveAction(legs);
  return { journalId: journal.journalId, legs, action, statusKey: RECOVERY_STATUS_KEYS[action] };
}

/**
 * The §3.5 table for one leg. Every branch either reads the chain or reads the record; none of them
 * sends anything, because there is nothing here that could.
 */
async function verdictFor(
  leg: FundingLeg,
  wallet: string,
  chain: ChainReader,
  now: number,
): Promise<LegVerdict> {
  if (leg.status === "settled") return "settled";
  if (leg.status === "failed") return "reverted";
  // An ambiguity already recorded stays ambiguous: nothing we can read now would resolve it, since
  // there is no RPC method that maps a nonce back to a transaction hash (§3.9).
  if (leg.status === "unknown") return "unknown";

  if (leg.status === "broadcast" && leg.txHash) {
    const receipt = await readReceipt(chain, leg.chainId, leg.txHash);
    if (receipt === "error") return "pending"; // A degraded read is not evidence of anything.
    if (receipt?.status === "reverted") return "reverted";
    if (receipt?.status === "success") {
      // `destChainId` is written only for a leg whose funds land on ANOTHER chain, so it is the
      // durable record of "this one has to be checked for arrival". Asking the kind instead let a
      // `bridge-gas` leg be reconciled settled off the source receipt (POO-1075), which would let
      // the flow resume and broadcast on a chain whose gas had not landed: the very dead end this
      // rail removes, reintroduced on the recovery path.
      return leg.destChainId !== undefined ? await arrivalVerdict(leg, wallet, chain) : "settled";
    }
    // No receipt. Under the ceiling that is normal; at it, the nonce is the only evidence left.
    if (!pastCeiling(leg, now)) return "pending";
    return await nonceVerdict(leg, wallet, chain, "absent");
  }

  // `planned`, no hash. Two very different situations share this shape, and POO-1055 [R3] is the
  // one that was being conflated.
  //
  // With NO `nonceBefore` the leg was never begun. `createJournal` writes every leg of the approved
  // route `planned` and empty; the baseline only appears in `beginLeg`, which §3.4 places strictly
  // BEFORE the wallet is prompted. So a missing baseline means the prompt never happened and nothing
  // could have been broadcast for this leg. That is the ordinary shape of a route that failed early
  // (a `/check_approval` error on the first leg, say), and reading it as ambiguous asked the user
  // about a transaction that never existed.
  //
  // With a baseline it is the genuine residual window of §3.9: the wallet may have broadcast before
  // the tab died and we would never have learned the hash, so the account nonce is the only evidence
  // left.
  if (leg.nonceBefore === undefined) return "absent";
  return await nonceVerdict(leg, wallet, chain, "absent");
}

/**
 * The nonce test: has ANYTHING from this account mined since we recorded the baseline?
 *
 * Unmoved means nothing of ours is on-chain, so `safe` (re-derive and execute) is correct. Moved is
 * genuinely ambiguous, because we cannot tell our leg from something the user did in another app,
 * and it therefore fails toward asking rather than toward spending.
 *
 * A leg with no recorded `nonceBefore` has no baseline to compare against. This function answers
 * `unknown` for it, which is right for its one remaining caller: a leg that reached `broadcast` WAS
 * prompted, so a missing baseline there is a real gap in what we know. The never-begun case is
 * decided in {@link verdictFor} before it can reach here (POO-1055 [R3]).
 */
async function nonceVerdict(
  leg: FundingLeg,
  wallet: string,
  chain: ChainReader,
  safe: LegVerdict,
): Promise<LegVerdict> {
  if (leg.nonceBefore === undefined) return "unknown";
  try {
    const nonce = await chain.getTransactionCount({ chainId: leg.chainId, address: wallet });
    return nonce > leg.nonceBefore ? "unknown" : safe;
  } catch {
    return "unknown";
  }
}

/**
 * §3.6: a source receipt proves only that the funds LEFT. Arrival is a separate observation on the
 * destination chain, minutes later:
 *
 *   balanceOf(wallet, tokenOut) on destChainId − destBalanceBefore ≥ minAmountOut
 *
 * **The delta against the recorded baseline is the point.** An absolute test reports instant success
 * for a user who already held the destination token and never fires for one whose arrival is netted
 * against a concurrent spend. Without a baseline there is no test to run, so the leg is ambiguous
 * rather than optimistically settled.
 *
 * At the poll ceiling an unarrived bridge stays `pending`: not failed, not succeeded. It never spins
 * forever, never fakes success, and never re-broadcasts.
 */
async function arrivalVerdict(
  leg: FundingLeg,
  wallet: string,
  chain: ChainReader,
): Promise<LegVerdict> {
  if (leg.destBalanceBefore === undefined || leg.destChainId === undefined) return "unknown";
  try {
    const balance = await chain.getTokenBalance({
      chainId: leg.destChainId,
      token: leg.tokenOut,
      owner: wallet,
    });
    const delta = BigInt(balance) - BigInt(leg.destBalanceBefore);
    return delta >= BigInt(leg.minAmountOut) ? "settled" : "pending";
  } catch {
    return "pending";
  }
}

/** A receipt read, with a failure that is distinguishable from "no receipt yet". */
async function readReceipt(
  chain: ChainReader,
  chainId: number,
  hash: string,
): Promise<{ status: "success" | "reverted" } | null | "error"> {
  try {
    return await chain.getTransactionReceipt({ chainId, txHash: hash });
  } catch {
    return "error";
  }
}

function pastCeiling(leg: FundingLeg, now: number): boolean {
  return leg.broadcastAt !== undefined && now - leg.broadcastAt >= JOURNAL_POLL_CEILING_MS;
}

/**
 * The journal's action is its worst leg: ask beats wait beats rederive beats complete.
 *
 * Ask first because an ambiguity has to reach the user before anything else happens. Wait next
 * because in-flight money outranks a re-plan: re-deriving while a bridge is mid-flight would size
 * the next leg against balances that are about to change.
 */
function resolveAction(legs: ReconciledLeg[]): JournalAction {
  if (legs.some((leg) => leg.verdict === "unknown")) return "ask";
  if (legs.some((leg) => leg.verdict === "pending")) return "wait";
  if (legs.some((leg) => leg.verdict === "reverted" || leg.verdict === "absent")) return "rederive";
  return "complete";
}

/**
 * Write the corrections back: when the journal and the chain disagree, the chain wins (§3.2).
 *
 * Only the verdicts that are FACTS about the chain are persisted. A `pending` leg is left exactly as
 * it was, hash and all, because "we still do not know" is not a state change and overwriting it
 * would lose the in-flight fact that stops a double broadcast. An `absent` leg likewise keeps its
 * record: the plan is about to be re-derived, and re-derivation is safe on its own terms.
 */
export function applyReconciliation(
  reconciliation: JournalReconciliation,
  now: number = Date.now(),
): void {
  for (const leg of reconciliation.legs) {
    if (leg.verdict === "settled") {
      updateLeg(reconciliation.journalId, leg.index, { status: "settled", settledAt: now }, now);
    } else if (leg.verdict === "reverted") {
      updateLeg(reconciliation.journalId, leg.index, { status: "failed" }, now);
    } else if (leg.verdict === "unknown") {
      updateLeg(reconciliation.journalId, leg.index, { status: "unknown" }, now);
    }
  }
}
