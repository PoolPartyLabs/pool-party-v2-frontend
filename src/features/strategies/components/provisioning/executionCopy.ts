/**
 * @id PP-CORE-LIB-060
 * @name executionStepCopy
 * @implements-rules-version v5 (POO-1507 rules v1) · v4 (POO-1504 rules v1) · v2 (POO-1385 rules v2) · v3 (POO-1136 / POO-1129 rules v3) · v2 (POO-1088 rules v2) · v1 (POO-1084 rules v1) · v1 (POO-1173 rules v1)
 *
 * The one-line status under each row of the Running (`6550:615`) and Step-failed (`6550:703`)
 * screens, as an i18n key rather than a string.
 *
 * Two decisions worth stating, because both are the difference between a screen that reassures and
 * one that alarms:
 *
 * **`idle` is two different things.** While the route is alive, a step that has not run yet is
 * *Waiting*: it is coming. Once a step has failed, the same status is *Not started*: nothing is
 * coming for it, and telling a user their money is "waiting" when the route has stopped is the kind
 * of copy that gets read as "still in flight, do not touch anything".
 *
 * **A failure names its cause with real values.** The design writes "Price moved past your 2%
 * slippage"; the 2% is the plan's own tolerance, and hardcoding it would make the line wrong for
 * everyone who changed it in the gear. When there is no tolerance to quote, the copy drops the
 * figure rather than inventing a plausible one (POO-799 #1).
 *
 * POO-1504 adds the other half of a row's copy: {@link stepTitleKey} conjugates the TITLE by state
 * ([R24]) and {@link hasExecutionSubtitle} decides whether there is a sub-line at all ([R25]). Both are
 * here rather than in the carousel for the same reason the status line is: the vocabulary of a running
 * route belongs in one pure module, so a step type added to the contract fails a type check instead of
 * quietly rendering a missing key.
 *
 * Pure: no React, no i18n runtime, no formatting. The card interpolates.
 */

import type { ProvisioningStepStatus, ProvisioningStepType } from "@/lib/provisioning";
import type { TxErrorKind } from "@/lib/tx/diagnostics";
import type { PlanRow } from "./provisioningView";

/** An i18n key plus whatever it interpolates. */
export interface ExecutionCopy {
  key: string;
  values?: Record<string, string | number>;
}

/**
 * Failure kind → key. A `Record` over the union, so adding a `TxErrorKind` is a type error here
 * rather than a step that silently renders the generic line.
 */
export const FAILURE_KEYS: Record<TxErrorKind, string> = {
  slippage: "provisioning.exec.failure.slippage",
  deadlineExpired: "provisioning.exec.failure.deadlineExpired",
  insufficientFunds: "provisioning.exec.failure.insufficientFunds",
  userRejected: "provisioning.exec.failure.userRejected",
  unauthorized: "provisioning.exec.failure.unauthorized",
  wrongChain: "provisioning.exec.failure.wrongChain",
  // POO-1385: the wallet does not HAVE this leg's chain, which on a cross-chain route is the leg
  // that cannot run rather than the route that is broken. Worded as the network being missing from
  // the wallet, never as a switch, because there is nothing here to switch to.
  chainUnavailable: "provisioning.exec.failure.chainUnavailable",
  // POO-1093: already on chain and the rail refused to re-send it. Deliberately worded as a
  // statement and never as an invitation to press again: the money is fine, and a second send
  // is the one action that would make it not fine.
  alreadyBroadcast: "provisioning.exec.failure.alreadyBroadcast",
  // POO-1107: the route could not be PRICED, which is not the same as no route existing. The two
  // ask opposite things of the user: wait, versus find more money.
  upstreamUnavailable: "provisioning.exec.failure.upstreamUnavailable",
  // POO-1763 [R9]: the chain or the RPC did not answer in time. Worded as "try this step again"
  // because that is the remedy, and because nothing moved.
  transient: "provisioning.exec.failure.transient",
  // POO-1763 [R9]: a leg was broadcast but not confirmed. Unlike `transient`, this must not invite a
  // plain retry: the leg may be on chain, so the copy says it was sent and to check before retrying.
  confirmationTimeout: "provisioning.exec.failure.confirmationTimeout",
  gasBlocked: "provisioning.exec.failure.gasBlocked",
  /**
   * POO-1173: the four kinds added by the classifier reconciliation deliberately point at the
   * GENERIC line for now. The type error this Record produced is what surfaced the decision, which
   * is the interlock working, and the answer is "classify correctly now, write copy separately".
   *
   * Classification and copy are different jobs with different costs. POO-1173's job was to stop
   * these failures folding into `unknown` and dropping out of the product failure rate, and that is
   * done: `error_origin` is now right for all four. Dedicated copy means four keys across twelve
   * locales, two of which are curated rather than machine-translated, and inventing forty-eight
   * strings inside a classifier PR is how copy nobody approved reaches production.
   *
   * TWO of these have a genuinely actionable remedy and should get their own line, which is worth
   * an issue rather than a TODO nobody reads:
   *   - `staleState`: the user's view is out of date, so "refresh and try again" is real advice.
   *   - `noRoute`: no route AT THIS SIZE right now, so "try a different amount" is real advice.
   * The other two correctly stay generic: on `reverted` and `invalidParams` there is nothing the
   * user can do, and pretending otherwise is worse than the generic line.
   */
  reverted: "provisioning.exec.failure.unknown",
  invalidParams: "provisioning.exec.failure.unknown",
  staleState: "provisioning.exec.failure.unknown",
  noRoute: "provisioning.exec.failure.unknown",
  // POO-1711: a move-range-only kind. Provisioning never moves a range, so this is unreachable on
  // this surface and takes the generic line rather than earning provisioning copy of its own.
  rangeUnchanged: "provisioning.exec.failure.unknown",
  unknown: "provisioning.exec.failure.unknown",
};

/** The slippage variant with no percentage to quote. */
const SLIPPAGE_NO_PCT_KEY = "provisioning.exec.failure.slippageNoPct";

/**
 * POO-1504 [R24]: **tense follows state.** Done reads past (`Converted ETH`), running reads gerund
 * (`Converting USDT`), not started reads plain (`Move to Arbitrum`).
 *
 * A not-started step written as if it were happening is the specific thing this forbids, and it is not
 * a style preference: on a four-leg route, three rows saying `Converting` and `Moving` while one of
 * them is the only thing actually running describes a machine doing four things at once, which is what
 * makes a user close the tab thinking it has hung.
 *
 * The op anchor is excluded because it is a LABEL for the operation this route funds, resolved by the
 * caller from `opLabel`, and never something the rail runs. Approval rows conjugate too, through
 * `sign.steps.*`, since they are broadcasts the user has to get through.
 *
 * `error` and `skipped` fall back to the plain form deliberately: the failure's cause is on the
 * sub-line where the plan's own figures are, and conjugating a step that stopped ("Converting" for
 * something that is not) would contradict it.
 */
const RUNNING_TITLE_KEYS: Partial<Record<ProvisioningStepType, string>> = {
  buy: "provisioning.stepsRunning.buy",
  bridge: "provisioning.stepsRunning.bridge",
  "bridge-gas": "provisioning.stepsRunning.bridgeGas",
  "swap-gas": "provisioning.stepsRunning.swapGas",
  "swap-token": "provisioning.stepsRunning.swapToken",
};

const DONE_TITLE_KEYS: Partial<Record<ProvisioningStepType, string>> = {
  buy: "provisioning.stepsDone.buy",
  bridge: "provisioning.stepsDone.bridge",
  "bridge-gas": "provisioning.stepsDone.bridgeGas",
  "swap-gas": "provisioning.stepsDone.swapGas",
  "swap-token": "provisioning.stepsDone.swapToken",
};

/** The approval row's three tenses, which live under `sign.*` with the rest of the signing copy. */
const APPROVAL_TITLE_KEYS = {
  idle: "sign.steps.approve",
  active: "sign.stepsRunning.approve",
  done: "sign.stepsDone.approve",
} as const;

/** What the carousel needs to know to conjugate one row's title. */
export interface StepTitleContext {
  type: ProvisioningStepType;
  status: ProvisioningStepStatus;
  /** A rail-only allowance row, whose copy lives under `sign.*` ([R6] of POO-1041). */
  isApproval?: boolean;
  /** The op anchor, which is a label rather than a step and is never conjugated. */
  isOp?: boolean;
  /** The plain-form key the view already carries, used for every state this does not conjugate. */
  labelKey: string;
}

/**
 * The i18n key for one row's title, in the tense its state calls for ([R24]).
 *
 * Returns the row's own `labelKey` unchanged whenever there is nothing to conjugate, so a step type
 * added to the contract without a tense table renders its plain form rather than an absent key.
 */
export function stepTitleKey(context: StepTitleContext): string {
  const { type, status, isApproval, isOp, labelKey } = context;
  if (isOp) return labelKey;
  if (isApproval) {
    if (status === "active") return APPROVAL_TITLE_KEYS.active;
    if (status === "done") return APPROVAL_TITLE_KEYS.done;
    return APPROVAL_TITLE_KEYS.idle;
  }
  if (status === "active") return RUNNING_TITLE_KEYS[type] ?? labelKey;
  if (status === "done") return DONE_TITLE_KEYS[type] ?? labelKey;
  return labelKey;
}

/**
 * POO-1504 [R25]: a subtitle exists ONLY if the user must act, or there is a real warning.
 *
 * `Done` and `Waiting` are the badge repeated in words, and a row that says both is a row that says
 * one thing twice while looking like it says two. The states that survive are the ones that ask for
 * something (`active`: continue in your wallet, or finish the purchase) and the ones that warn (a
 * failure's cause, a bridge's "this takes longer than the others").
 */
export function hasExecutionSubtitle(status: ProvisioningStepStatus): boolean {
  return status === "active" || status === "error";
}

/** What the card knows about a row when it asks for its sub-line. */
export interface ExecutionStepContext {
  status: ProvisioningStepStatus;
  /** Has any step in this route already failed? Changes what `idle` means. */
  routeFailed?: boolean;
  /** The classification of the failure, when this row is the one that failed. */
  errorKind?: TxErrorKind;
  /** The plan's own max-slippage, in percent. Absent means the copy drops the figure. */
  slippagePct?: number;
  /**
   * POO-1136: this row is the fiat `buy`, whose active state is the embedded Paybis widget, not a
   * wallet prompt. "Continue in your wallet" is wrong for it, so its active line points at the iframe.
   */
  inIframe?: boolean;
}

/** The sub-line for one execution row. See {@link ExecutionStepContext}. */
export function executionStepCopy(context: ExecutionStepContext): ExecutionCopy {
  const { status, routeFailed, errorKind, slippagePct, inIframe } = context;

  switch (status) {
    case "done":
      return { key: "provisioning.exec.status.done" };
    case "active":
      // POO-1136: a fiat buy's active state is the embedded widget, not a wallet prompt.
      return {
        key: inIframe ? "provisioning.exec.status.buying" : "provisioning.exec.status.active",
      };
    case "skipped":
      return { key: "provisioning.exec.status.skipped" };
    case "error": {
      const kind = errorKind ?? "unknown";
      if (kind === "slippage") {
        return Number.isFinite(slippagePct) && slippagePct !== undefined
          ? { key: FAILURE_KEYS.slippage, values: { pct: slippagePct } }
          : { key: SLIPPAGE_NO_PCT_KEY };
      }
      return { key: FAILURE_KEYS[kind] };
    }
    // Cased explicitly, and NO `default`: every member of the union returns, so a status added to
    // `ProvisioningStepStatus` falls past the switch and `tsc` reports a missing return instead of
    // captioning the new state "Waiting". Same reason `LEG_KIND_BY_STEP_TYPE` is `satisfies` over
    // the union rather than a lookup with a fallback (`provisioningFunnel.ts`).
    case "idle":
      return {
        key: routeFailed
          ? "provisioning.exec.status.notStarted"
          : "provisioning.exec.status.waiting",
      };
  }
}

/**
 * What the Step-failed screen can honestly say already settled ([F5-R5], parent [R10]).
 *
 * `none`    → nothing moved, so the screen says that and names no figure.
 * `amount`  → a total the plan substantiates.
 * `unknown` → money DID settle, but not all of it is priced, so the copy ships without an amount.
 */
export type SettledSafe = { kind: "none" } | { kind: "amount"; usd: number } | { kind: "unknown" };

/**
 * What a settled row contributes to the safe total, by step type.
 *
 * `satisfies Record<ProvisioningStepType, SettlementRole>` on purpose, the same hazard `isBridgeLegKind`
 * exists to prevent: a step type added or renamed in the contract is a COMPILE error here rather than a
 * row that silently falls through a string compare and is miscounted (POO-1131 acceptance). It is a
 * lookup, never `row.type === "bridge"`.
 *
 * - `excluded` moves nothing safe-at-rest: the `op` is a spend, and `swap-gas` / `bridge-gas` are gas,
 *   spent on the transaction rather than held. A `buy` that DELIVERS native gas ([R1]'s gas-first
 *   purchase) is the same, but its type nominally `holds`, so that one exclusion rides on the delivered
 *   asset (`PlanRow.deliversGas`) rather than the type name.
 * - `carries` moves what the previous leg produced onward (a bridge): the same money, one leg further.
 * - `holds` is a settled balance sitting where it landed (a swap into USDC, or a fiat buy of USDC).
 */
type SettlementRole = "excluded" | "carries" | "holds";
const SETTLEMENT_ROLE = {
  op: "excluded",
  "swap-gas": "excluded",
  "bridge-gas": "excluded",
  bridge: "carries",
  "swap-token": "holds",
  buy: "holds",
} as const satisfies Record<ProvisioningStepType, SettlementRole>;

/** USD ⇄ integer micro-dollars, so a two-source total adds up in cents and never drifts in floats. */
const MICROS = 1_000_000;
const toMicros = (usd: number): number => Math.round(usd * MICROS);
const toUsd = (micros: number): number => Math.round(micros / 10_000) / 100;

/**
 * The settled-and-safe total, and why it is not `rows.filter(done).sum()` ([F5-R9], rules v2).
 *
 * A plan is a ROUTE, not a ledger: the same money appears on more than one row as it moves. In the
 * flagship route the swap row is $120.40 and the bridge row right after it is the same $120.40,
 * because the bridge carries what the swap produced. Summed, a user who settled both would be told
 * $240.80 of theirs is safe, which is a fabricated figure of exactly the kind [R10] exists to ban,
 * and the most reassuring possible way to be wrong about someone's money.
 *
 * So the walk groups by SOURCE and reports each source's furthest-along settled leg once. A leg that
 * consumes the previous leg's output continues that source (a bridge carrying a swap's proceeds; the
 * money moved, it is not new), and its amount REPLACES the leg it fed. A leg whose input is a fresh
 * holding starts a new source and adds its own amount. Which of the two a leg is comes from the view's
 * `continuesPrevious`, derived from the legs' endpoints (`sameEndpoint`); absent it (a mock plan, a
 * hand-built row) the default is by role, a bridge continues and a swap/buy starts fresh, which is the
 * single-source shape a mock plan can produce.
 *
 * This fixes POO-1142: the old walk reset ALL at-rest money on ANY bridge, so a target-chain swap-only
 * source that settled before a foreign bridge was silently zeroed even though that bridge never
 * carried it. Grouping supersedes only within the source a leg actually continues.
 *
 * Deliberately not counted: approvals (grant permission, move nothing); gas legs and a gas-delivering
 * buy (spent, not held); the op row (a spend; if it settled the route succeeded and no failure screen
 * renders). A settled value-moving row the plan never priced makes the total unprovable, so the result
 * degrades to `unknown` rather than reporting the part it happens to know.
 */
export function settledSafe(rows: readonly PlanRow[]): SettledSafe {
  // Banked total from source groups already closed, in micro-dollars.
  let finalized = 0;
  // The open source group's furthest-along settled amount, in micro-dollars.
  let groupMicros = 0;
  let groupOpen = false;
  let settledAnything = false;

  for (const row of rows) {
    if (row.status !== "done") continue;
    if (row.isApproval) continue;
    const role = SETTLEMENT_ROLE[row.type];
    if (role === "excluded") continue;
    // A `buy` that delivered native gas is spent, not held: excluded like the gas legs even though
    // its type `holds`.
    if (row.deliversGas) continue;

    settledAnything = true;
    if (row.amountUsd === undefined) return { kind: "unknown" };

    // A bridge continues by default (it carries the leg before it); a swap/buy starts a new source by
    // default (it converts or delivers a distinct holding). A real plan overrides both with the
    // endpoint-derived `continuesPrevious`.
    const continues = row.continuesPrevious ?? role === "carries";

    if (continues && groupOpen) {
      // Same money, one leg further along: the latest settled leg is where it now rests.
      groupMicros = toMicros(row.amountUsd);
    } else {
      if (groupOpen) finalized += groupMicros;
      groupMicros = toMicros(row.amountUsd);
      groupOpen = true;
    }
  }

  if (!settledAnything) return { kind: "none" };
  return { kind: "amount", usd: toUsd(finalized + groupMicros) };
}

/** One step's live position within the run, 1-based, matching what `Step {index} of {total}` prints. */
export interface StepPosition {
  index: number;
  total: number;
  /** The row the position describes, so a caller can derive what comes after it without re-selecting. */
  key: string;
}

/**
 * The step in flight, or the first one that has not finished, or the last one when all have — the
 * SAME selection {@link ExecutionCarousel} makes for its own `Step N of M`, extracted here (POO-1507
 * [R29]) so the stop-confirmation's numbers cannot drift from the carousel's.
 *
 * The op anchor is excluded, exactly as the carousel excludes it: it is a label for the operation
 * this route funds, not a step the rail runs. `null` when there is nothing to run at all.
 */
export function currentStepPosition(rows: readonly PlanRow[]): StepPosition | null {
  const steps = rows.filter((row) => !row.isOp);
  if (steps.length === 0) return null;
  const current =
    steps.find((row) => row.status === "active") ??
    steps.find((row) => row.status === "error") ??
    steps.find((row) => row.status === "idle") ??
    steps[steps.length - 1];
  // Unreachable in practice (`steps.length > 0` guarantees the last fallback is defined), but
  // `steps[…]` is indexed access rather than a narrowed type, so this is what makes that provable.
  if (!current) return null;
  return { index: steps.indexOf(current) + 1, total: steps.length, key: current.key };
}

/**
 * [R23] The progress bar's fraction, `(done + 0.5) / total`, capped at 1 — the SAME formula
 * {@link ExecutionCarousel} uses for its own bar, extracted here (POO-1505) so the buy-step mini
 * summary's bar (spec R32, "on the summary's top edge") cannot drift from the carousel's. The half
 * counts the step in flight, which is the only reason the bar moves at all during a leg; at `allDone`
 * there is no step in flight, so the half is dropped rather than pushing the bar past full.
 */
export function progressFraction(rows: readonly PlanRow[]): number {
  const steps = rows.filter((row) => !row.isOp);
  const total = steps.length;
  if (total === 0) return 0;
  const doneCount = steps.filter((row) => row.status === "done").length;
  const allDone = doneCount === total;
  return Math.min(1, (doneCount + (allDone ? 0 : 0.5)) / total);
}

/**
 * [R29]'s `{rest}`: what comes after the running step, for "Steps {rest} will not start". A single
 * number when one step remains, a range when more than one does; `null` when the running step is the
 * last one, so there is nothing left to name.
 */
export function remainingStepsLabel(
  rows: readonly PlanRow[],
): { count: number; label: string } | null {
  const steps = rows.filter((row) => !row.isOp);
  const position = currentStepPosition(rows);
  if (!position) return null;
  const remaining = steps.slice(position.index);
  if (remaining.length === 0) return null;
  const first = position.index + 1;
  const last = position.index + remaining.length;
  return {
    count: remaining.length,
    label: remaining.length === 1 ? `${first}` : `${first}-${last}`,
  };
}
