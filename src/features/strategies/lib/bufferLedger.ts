/**
 * @id PP-STR-LIB-023 (POO-1811)
 * @name buffer ledger
 * @implements-rules-version v1 (POO-1811 rules v1)
 * @analytics-events none, this module RETURNS a measurement and emits nothing. The panel that owns
 *   the running total is the emitter, because only it knows the plan the measurement belongs to.
 *
 * Measure the price-move buffer before anyone argues about its size.
 *
 * ## Why this exists, and what it deliberately does not do
 *
 * `SEED_BUFFER_RATE` has been 5% since it was written, and of the three components its comment
 * names, one has no code behind it: `costBreakdown.ts` excludes swap cost because the quote is
 * already net of it. So one third of the stated justification for the number is not a thing the
 * system does. That is an argument nobody can settle, because nothing has ever been recorded: the
 * shipped `consumeBuffer` returns a boolean and keeps no trace of what it was asked.
 *
 * This module changes that and NOTHING else. [R2]: the measurement must not influence sizing until
 * a decision is taken, so the decision it returns is byte-identical to the callback's own arithmetic
 * and is pinned against a transcription of it in `bufferLedger.test.ts`. [R3]: reducing the rate to
 * 3% is P4-3's call and is blocked on the evidence this produces, not on this issue. The measured
 * headroom is why: on a $1000 operation with $5 of gas it is about 3.0% at 5% and about 1.0% at 3%,
 * but only 0.02% at 3% once 3% slippage is real, and NEGATIVE $19.85 at 3% with 5% slippage.
 *
 * ## What the series CANNOT answer, stated here so nobody reads it as more than it is
 *
 * **It is censored below `REQUOTE_MATERIAL_BPS` (100 bps).** `gateRequote` (`buildPlanSteps.ts`)
 * returns BEFORE it calls the consumer whenever the re-quote is not materially worse, so a leg whose
 * price drifted by less than 1% never asks and never appears here. Every recorded `askedBps` is
 * therefore above 100 by construction, and an ABSENCE of events is not evidence that the market
 * held: it is indistinguishable from a run where every leg moved 99 bps. Whatever this series says
 * about the tail, it says nothing about the distribution below the gate's own threshold.
 *
 * **It is a bps allowance, not the seeded USD surplus.** What is measured here is the RUN GATE's
 * budget: per-leg rate shortfalls summed, amount-blind, and a 200 bps ask on a $20 leg counts exactly
 * as much as one on a $2000 leg. `seedRequiredUsd` (`fundingSelection.ts`) spends the same rate on a
 * different quantity, `(transaction + gas) * (1 + rate)` in DOLLARS. The two share a constant and
 * nothing else, so they must not be compared directly, and the [R3] headroom figures above are
 * dollars rather than anything this event carries.
 *
 * ## Pure, and stateless on purpose
 *
 * The running total stays in the panel's ref. This module is handed the total and gives back what
 * the total becomes, which is what keeps it structurally unable to steer sizing: it has no state to
 * accumulate, no import that reaches the sizing surface, and a test asserts the absence of both.
 */

/** One ask against the run's shared buffer, with the state the caller is holding for it. */
export interface BufferAsk {
  /** How much worse this leg's re-quote came back, in basis points. Never negative in practice. */
  askedBps: number;
  /** What the run has already banked, across every earlier leg. */
  consumedBps: number;
  /** The whole budget for the run, in bps (`DEFAULT_SOURCE_BUFFER_RATE * 10_000`, so 500 today). */
  budgetBps: number;
  /** Which ASK this is within the run, so a series can be read back in order. Not a leg id. */
  askIndex: number;
}

/** What the ask cost, and whether it was allowed. The emitted record ([R1]) is this object. */
export interface BufferMeasurement {
  askedBps: number;
  /** The running total AFTER this ask: advanced when held, untouched when refused. */
  cumulativeBps: number;
  /**
   * The whole budget for the run, in bps. Today it is always the CLIENT default
   * (`DEFAULT_SOURCE_BUFFER_RATE * 10_000`, 500), because the caller has nothing else to pass; when
   * POO-1499 wires the quote's own `bufferRate` (the integration seam already marked on
   * `SourceTargetInput.bufferRate` in `fundingTarget.ts`) this must follow that rate instead, or the
   * series will report a budget the run was not actually held to.
   */
  budgetBps: number;
  /** What is left. Never negative, because the ask that would have gone under was refused. */
  headroomBps: number;
  /** The decision, identical to the shipped callback's. `true` also means the ask was BANKED. */
  held: boolean;
  /** The ask ordinal within the run. See {@link BufferAsk.askIndex}. */
  askIndex: number;
}

/**
 * Decide an ask and describe it in one pass.
 *
 * The decision is the shipped one, transcribed: `consumed + asked > budget` refuses, anything else
 * holds and banks. `>` and not `>=`, so an ask landing exactly ON the budget is spending rather than
 * overspending. A refusal does NOT bank, because a rejected move was never sent and so never
 * happened against the budget; that is why `headroomBps` can never go negative.
 */
export function measureBufferAsk({
  askedBps,
  consumedBps,
  budgetBps,
  askIndex,
}: BufferAsk): BufferMeasurement {
  const next = consumedBps + askedBps;
  const held = next <= budgetBps;
  const cumulativeBps = held ? next : consumedBps;
  return {
    askedBps,
    cumulativeBps,
    budgetBps,
    headroomBps: budgetBps - cumulativeBps,
    held,
    askIndex,
  };
}
