/**
 * @id PP-CORE-LIB-110 (POO-1804)
 * @name on-ramp settlement observation window
 * @implements-rules-version v1 (POO-1804 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * @analytics-events none, funding_buy_settled fires from the observed delta in POO-1813's emitter,
 *   which reads this module's outcome. A watcher that emitted its own would report a settlement the
 *   host has not yet acted on, and would fire again from the passive phase on a later visit.
 *
 * Implements ADR-0004 and ADR-0006. The settlement loop leaves React, following
 * `awaitBridgeSettlement` (`PP-STR-LIB-018`) as the precedent: a pure async watcher, deps-injected,
 * bounded, backing off, honest at the ceiling, and testable under fake timers.
 *
 * ## The test, and why it is a delta ([R1], ADR-0004)
 *
 *     balanceOf(address, asset) on the destination chain  minus  baseline  >  0
 *
 * The baseline is read by the HOST before the checkout opens and passed in. This module never
 * invents a zero, because a zero is a claim about somebody's money: a failed `readBalance` is a
 * retry, never a balance, and never a delta.
 *
 * There is deliberately **no floor**. `awaitBridgeSettlement` compares against `minAmountOut`
 * because a bridge quotes what it will deliver. A fiat provider does not: every input it takes is
 * spend-fixed, the buyer can retype the amount inside the provider's own modal, and the spread
 * belongs to the provider. So ANY positive delta is the delivery, and the figure we report is the
 * one we observed, never the one we asked for.
 *
 * ### The risk that buys, named rather than left implied
 *
 * The FIRST positive reading wins. A partial arrival settles the window at whatever had landed by
 * then, and an unrelated inbound transfer of the same asset during the window is read as the
 * delivery. That is the shipped precedent (`computeTokenDeltas`, `PP-CORE-LIB-066`: "every token
 * whose balance GREW"), and it is the honest choice here, because a fiat provider quotes no
 * delivered figure, so any threshold we compared against would be one we had invented. A dust guard,
 * if one is ever wanted, belongs with POO-1811's measurements of what the rail actually delivers,
 * never as a constant chosen in this file.
 *
 * ### Which figure IS the delivered amount
 *
 * The observed delta, and it is written in two places for two jobs. The BASE UNITS go to the record
 * as `delivered.amountRaw` (`PP-CORE-LIB-107`), which is the authority anything sizes from. The
 * STRING in {@link OnRampDelivered.amount} is the same delta through `formatUnits`, and it is the
 * authoritative figure to PRINT: never the requested one, never the prefilled one. The record's
 * `delivered.amount` is a float companion for support, and a float is not a base-unit-safe figure to
 * size anything from, so POO-1806's settle-then-size and POO-1813's emitter take the string or the
 * raw, never that number.
 *
 * ## Two phases, because the two populations are asymmetric ([R2], ADR-0006)
 *
 * The VISIBLE window ({@link ONRAMP_VISIBLE_WINDOW_MS}) is the one a screen waits on. After it, the
 * screen is released and {@link resumeOnRampObservation} carries the intent in the background to
 * {@link ONRAMP_PASSIVE_CEILING_MS}. Abandonment is common and cheap to get wrong; a lost charge is
 * rare and expensive, so the cheap case gets a short wait and the expensive one keeps being watched.
 *
 * The passive phase is resumed WITHIN THE SAME PAGE SESSION, by the host that still holds the
 * pre-purchase baseline: it hands that baseline and the asset's decimals straight to
 * {@link resumeOnRampObservation} when the visible window releases its screen. Nothing here should
 * be read as promising a CROSS-SESSION resume, because this module has no caller that survives a
 * reload: it takes its baseline from its caller and reads no record to start itself.
 *
 * The substrate for the cross-session half now exists, which it did not when this module was
 * written: POO-1802's landed record carries `wallet`, `baselineRaw`, `decimals` and `confirmedAt`,
 * so the pre-purchase baseline a reloaded host cannot re-read is on disk, and `moved` is derivable
 * from the record's own phase. What is still missing is only the WIRING: a host that, on mount,
 * takes `findOpenOnRampIntent(wallet)` and resumes the window from the record.
 *
 * PP-DEBT(SEV:HIGH): so ADR-0006's passive half still does not reach a returning buyer, who is
 * reconciled by hand from the record instead. That host resume is POO-1833, which owns the reading
 * side here as well; this module deliberately does not grow an unused record-reading input path
 * ahead of it.
 *
 * ## `settling` and `unverified` are different claims ([R3])
 *
 * One word used to mean both, and the copy promised arrival in each. They are split here:
 *
 *   - **`settling`**: we hold PROOF OF PAYMENT, the provider's own claim (`moved === "confirmed"`).
 *     Money is expected. The record stays open for support even past the passive ceiling.
 *   - **`unverified`**: we hold no such claim. It says only that we never saw a delta, which is not
 *     the same as saying nothing was charged, and the difference is exactly what we cannot resolve.
 *
 * ## There is no `cancelled` ([R4])
 *
 * Not as a value and not as a branch: the outcome union has three members and none of them is it,
 * so the type system refuses the word before a reviewer has to. Every path out of here is `settled`,
 * `settling` or `unverified`, and a test asserts that union exhaustively by running every path and
 * comparing the set. The only cancellation the product ever renders is a provider-reported
 * PRE-CHARGE one, which this module never observes and therefore must never be able to express.
 *
 * ## One read, on one chain ([R5])
 *
 * Scoped to a single `{chain, asset}`, so one `balanceOf` replaces the three-network fan-out the
 * Paybis hook runs. That removes the false-zero baseline trap (a chain the fan-out could not read
 * looked like a zero balance) and the refusal path that came with it.
 *
 * ## Scope
 *
 * A new module, not a rewrite. `useOnRampSettlement.ts` (`PP-CORE-HOK-025`, postMessage-driven,
 * three-network fan-out) keeps serving the live Paybis rail untouched until POO-1809 retires it. No
 * host is wired here: POO-1807/1808 bind `readBalance` and render the phases.
 */

import { formatUnits } from "viem";
import {
  type OnRampIntentPatch,
  readOnRampIntents,
  recordOnRampDelivery,
  updateOnRampIntent,
} from "./onRampIntent";

/**
 * How long a screen waits before it is released. **v1 default, set by the epic, meant to move on
 * evidence.** ADR-0006 says "roughly the first 90 seconds": long enough that a fast card settles
 * while the buyer is still looking at it, short enough that an abandonment does not hold a screen.
 */
export const ONRAMP_VISIBLE_WINDOW_MS = 90_000;

/**
 * The ceiling on OBSERVATION AS A WHOLE, measured from the intent record's `createdAt` rather than
 * from the moment {@link resumeOnRampObservation} happened to be called. **v1 default.** 30 minutes
 * covers a 3DS detour and a slow provider without pinning a background loop to a tab for an hour.
 *
 * Measuring it from the record is what makes it a bound at all. A per-call ceiling restarts in full
 * every time a window is resumed, so one attempt could be watched forever in 30-minute instalments.
 * The passive window is therefore CLIPPED to whatever is left of this budget, and an attempt whose
 * budget is already spent reports the ceiling without opening a window at all.
 *
 * It bounds WATCHING only, never the intent record, which is kept for 30 days (`PP-CORE-LIB-107`),
 * so a purchase that lands after this is still reconcilable by hand.
 */
export const ONRAMP_PASSIVE_CEILING_MS = 30 * 60_000;

/** Shortest visible-phase window. Anything tighter is a busy loop against an RPC. */
export const ONRAMP_VISIBLE_POLL_MIN_MS = 2_000;
/** Longest visible-phase window: the screen is live, so it stays responsive. */
export const ONRAMP_VISIBLE_POLL_MAX_MS = 10_000;
/** Shortest passive-phase window. No screen is waiting, so it is deliberately slower. */
export const ONRAMP_PASSIVE_POLL_MIN_MS = 15_000;
/** Longest passive-phase window. */
export const ONRAMP_PASSIVE_POLL_MAX_MS = 60_000;
/** Window growth factor, matching the bridge watcher's. */
export const ONRAMP_POLL_BACKOFF = 2;

/** What is being watched, and what we already know about the charge. */
export interface OnRampObservationInput {
  attemptId: string;
  /** CAIP-2 chain and token address, the rail's vocabulary (`PP-CORE-LIB-106`). */
  destination: { chain: string; asset: string };
  /** The wallet the funds are expected on. */
  address: string;
  /**
   * The destination balance read by the HOST before the checkout opened, in base units. Passed in
   * rather than read here, because a baseline taken after the buyer may already have paid would
   * silently subtract their own money from the delta. The record persists the same figure as
   * `baselineRaw`, which is what POO-1833's cross-session resume will read; this module still takes
   * it from its caller, so there is exactly one way in. See the header's PP-DEBT note.
   */
  baseline: bigint;
  /** The asset's decimals, used only to format the observed delta for display. */
  decimals: number;
  /**
   * The adapter's verdict (`PP-CORE-LIB-109`). `confirmed` means the provider CLAIMED it charged,
   * which is proof of payment and never settlement; `maybe` means the exit was inconclusive.
   */
  moved: "maybe" | "confirmed";
}

/** Everything this module touches that is not pure, so a test can drive all of it. */
export interface OnRampSettlementDeps {
  /**
   * One on-chain balance read, in base units ([R5]). The host binds a viem `readContract` of
   * `balanceOf` on the destination chain.
   *
   * PP-INTEGRATION-POINT: the chain read that decides whether money arrived. This module owns the
   * polling policy and the classification, never the transport.
   */
  readBalance: (args: { chain: string; asset: string; address: string }) => Promise<bigint>;
  sleep: (ms: number) => Promise<void>;
  /**
   * Wall-clock epoch milliseconds; a host binds `Date.now`. It is compared against the intent
   * record's `createdAt` to clip the passive ceiling, so a monotonic clock would make that clip
   * meaningless.
   */
  now: () => number;
}

/** What arrived, in the only figure a screen may print (ADR-0004). */
export interface OnRampDelivered {
  /**
   * The OBSERVED delta, formatted at `decimals`. Never the requested or prefilled figure, and the
   * AUTHORITATIVE copy of it: the intent record holds the same number as a float, for display and
   * support only.
   */
  amount: string;
  asset: string;
  chain: string;
  observedAt: number;
}

/**
 * What the window actually did, carried on every outcome. Mirrors `awaitBridgeSettlement`'s
 * `polls` / `waitedMs` / `lastError` (`PP-STR-LIB-018`), so a ceiling reached against a healthy RPC
 * can be told apart from one reached because every single read failed.
 *
 * Optional rather than required, because this shape is an INJECTED contract: the hosts take the
 * watcher as a dep, and a test double answers with a verdict, not with an observation count. The
 * real watcher always fills `polls` and `waitedMs`.
 */
export interface OnRampObservationDiagnostics {
  /** How many observations were made (the first one is immediate). */
  polls?: number;
  /** Wall-clock time spent watching, ms. */
  waitedMs?: number;
  /**
   * The MESSAGE of the last read failure, when one was still outstanding as the window ended. A
   * message only: an error object would carry a stack and a transport's own fields into a record
   * and a log line that neither needs.
   */
  lastError?: string;
}

/**
 * The three answers, and the complete set. There is no `cancelled` here by design ([R4]): a value
 * that cannot be expressed cannot be rendered by mistake.
 */
export type OnRampSettlementOutcome =
  | ({ outcome: "settled"; delivered: OnRampDelivered } & OnRampObservationDiagnostics)
  | ({ outcome: "settling" } & OnRampObservationDiagnostics)
  | ({ outcome: "unverified" } & OnRampObservationDiagnostics);

/** The honest word for a ceiling, given whether we hold the provider's claim ([R3]). */
function ceilingOutcome(moved: "maybe" | "confirmed"): "settling" | "unverified" {
  return moved === "confirmed" ? "settling" : "unverified";
}

/** The ceiling answer plus what the window did, built per member so the union narrows on its tag. */
function ceilingResult(
  moved: "maybe" | "confirmed",
  diagnostics: OnRampObservationDiagnostics,
): OnRampSettlementOutcome {
  return ceilingOutcome(moved) === "settling"
    ? { outcome: "settling", ...diagnostics }
    : { outcome: "unverified", ...diagnostics };
}

/**
 * Stamp a ceiling phase on the record, unless the record has already moved past us.
 *
 * Two observers can watch one attempt: a second tab, or a passive window still running after the
 * visible one released its screen. The loops are not synchronised, so writing blind let the slower
 * one stamp `unverified` over a record another had already closed as `settled`, turning a delivered
 * purchase into an unanswerable support question. `outcome !== null` means somebody already decided,
 * which makes this write stale by definition; `phase === "settled"` is the same fact said twice, and
 * is checked as well so a record closed by a future writer is equally safe.
 */
function writeCeilingPhase(attemptId: string, patch: OnRampIntentPatch): void {
  // No record is not an error: it was pruned or never existed, and `updateOnRampIntent` would write
  // nothing for it either way.
  const record = readOnRampIntents().find((entry) => entry.attemptId === attemptId);
  if (!record) return;
  if (record.outcome !== null || record.phase === "settled") return;
  updateOnRampIntent(attemptId, patch);
}

/** One bounded observation window. Both phases are this loop with different numbers. */
async function observe(
  input: OnRampObservationInput,
  deps: OnRampSettlementDeps,
  window: {
    ceilingMs: number;
    minDelayMs: number;
    maxDelayMs: number;
  },
): Promise<OnRampSettlementOutcome> {
  const startedAt = deps.now();
  let delay = window.minDelayMs;
  let polls = 0;
  let lastError: string | undefined;

  for (;;) {
    polls += 1;
    try {
      const balance = await deps.readBalance({
        chain: input.destination.chain,
        asset: input.destination.asset,
        address: input.address,
      });
      lastError = undefined;
      const delta = balance - input.baseline;
      // Strictly positive: a flat balance is "nothing has happened", and a balance that went DOWN
      // is somebody spending, neither of which is a delivery.
      if (delta > BigInt(0)) {
        const amount = formatUnits(delta, input.decimals);
        const observedAt = deps.now();
        // ADR-0007: the record is the substrate. This is the one writer of a delivered figure,
        // and it writes the BASE UNITS as the authority (`amountRaw`), never only the float.
        recordOnRampDelivery(input.attemptId, {
          amountRaw: delta.toString(),
          amount: Number(amount),
          asset: input.destination.asset,
          chain: input.destination.chain,
        });
        return {
          outcome: "settled",
          delivered: {
            amount,
            asset: input.destination.asset,
            chain: input.destination.chain,
            observedAt,
          },
          polls,
          waitedMs: observedAt - startedAt,
        };
      }
    } catch (error) {
      // [R1] A failed read says nothing about where the money is. The window simply retries; it must
      // never be read as a zero balance, which would be a claim we cannot support. The message is
      // kept so a ceiling reached against a dead RPC is distinguishable from one reached honestly.
      lastError = error instanceof Error ? error.message : String(error);
    }

    const remaining = window.ceilingMs - (deps.now() - startedAt);
    if (remaining <= 0) break;
    // The final window is clipped to the ceiling, so the wait always ends on a fresh observation
    // rather than on a sleep that overshoots it.
    await deps.sleep(Math.min(delay, remaining));
    delay = Math.min(delay * ONRAMP_POLL_BACKOFF, window.maxDelayMs);
  }

  return ceilingResult(input.moved, {
    polls,
    waitedMs: deps.now() - startedAt,
    ...(lastError === undefined ? {} : { lastError }),
  });
}

/**
 * The VISIBLE window ([R2]): what a screen waits on.
 *
 * At its ceiling the intent is marked `settling` or `unverified` and left OPEN (`outcome` still
 * null), because the passive phase keeps observing it. Closing it here would end the observation at
 * exactly the moment ADR-0006 says it should continue.
 */
export async function watchOnRampSettlementVisible(
  input: OnRampObservationInput,
  deps: OnRampSettlementDeps,
): Promise<OnRampSettlementOutcome> {
  const result = await observe(input, deps, {
    ceilingMs: ONRAMP_VISIBLE_WINDOW_MS,
    minDelayMs: ONRAMP_VISIBLE_POLL_MIN_MS,
    maxDelayMs: ONRAMP_VISIBLE_POLL_MAX_MS,
  });
  if (result.outcome !== "settled") {
    writeCeilingPhase(input.attemptId, { phase: result.outcome });
  }
  return result;
}

/**
 * The PASSIVE window ([R2]): it outlives the screen, but not the page session.
 *
 * Resumed by the host that still holds the pre-purchase baseline, when the visible window releases
 * its screen. It is not a cross-session resume, for the reason set out in the header's PP-DEBT note:
 * the record now holds the baseline, but nothing mounts this loop against
 * `findOpenOnRampIntent(wallet)` until POO-1833 wires that host.
 *
 * Its ceiling is {@link ONRAMP_PASSIVE_CEILING_MS} counted from the record's `createdAt`, clipped by
 * whatever the attempt has already spent, so resuming never grants a fresh budget. At the ceiling:
 *
 *   - with no claim, the intent is closed `unverified` / `outcome: "unverified"`. We watched for as
 *     long as we said we would and saw nothing.
 *   - with a claim, it stays `settling` and stays OPEN. The provider still says it charged, nothing
 *     has disproved that, and a record closed against a live claim is a support question nobody can
 *     answer later.
 */
export async function resumeOnRampObservation(
  attemptId: string,
  input: Omit<OnRampObservationInput, "attemptId">,
  deps: OnRampSettlementDeps,
): Promise<OnRampSettlementOutcome> {
  const full: OnRampObservationInput = { ...input, attemptId };
  // A record we no longer hold gets the full window: it is the only budget we can honestly compute,
  // and refusing to watch on a missing record would be the harsher error of the two.
  const record = readOnRampIntents().find((entry) => entry.attemptId === attemptId);
  const spent = record ? Math.max(deps.now() - record.createdAt, 0) : 0;
  const ceilingMs = ONRAMP_PASSIVE_CEILING_MS - spent;

  const result =
    ceilingMs > 0
      ? await observe(full, deps, {
          ceilingMs,
          minDelayMs: ONRAMP_PASSIVE_POLL_MIN_MS,
          maxDelayMs: ONRAMP_PASSIVE_POLL_MAX_MS,
        })
      : // The budget is spent, so there is no window left to open. Reporting the ceiling is the
        // answer the loop would reach anyway, and the record stays exactly as an expired window
        // leaves it: available for hand reconciliation, never re-observed on every later visit.
        ceilingResult(full.moved, { polls: 0, waitedMs: 0 });

  if (result.outcome === "unverified") {
    writeCeilingPhase(attemptId, { phase: "unverified", outcome: "unverified" });
  } else if (result.outcome === "settling") {
    writeCeilingPhase(attemptId, { phase: "settling" });
  }
  return result;
}
