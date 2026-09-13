/**
 * @id PP-STR-LIB-023 (POO-1811) - tests
 * @name buffer ledger - tests
 * @implements-rules-version v1 (POO-1811 rules v1)
 * @analytics-events none, the ledger is pure and returns a measurement; the PANEL emits it.
 *
 * [R2] is the rule with teeth here: this ledger MEASURES, it does not decide anything new. Its
 * `held` must be byte-identical to the callback `ProvisioningPanel` has been shipping, so the first
 * describe below replays that logic's own cases rather than restating the rule in prose.
 *
 * The shipped logic, for the record:
 *   const next = consumed + worseBps;
 *   if (next > limitBps) return false;   // refused: the total is NOT banked
 *   consumed = next; return true;        // held: the total IS banked
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_BUFFER_RATE } from "../components/provisioning/fundingSelection";
import { DEFAULT_SOURCE_BUFFER_RATE } from "../components/provisioning/fundingTarget";
import { measureBufferAsk } from "./bufferLedger";

/** The shipped budget, in bps, exactly as the panel computes it. */
const BUDGET_BPS = DEFAULT_SOURCE_BUFFER_RATE * 10_000;

/** The decision the panel makes today, transcribed so the ledger can be compared against it. */
function shippedDecision(consumed: number, asked: number): { held: boolean; consumed: number } {
  const next = consumed + asked;
  if (next > BUDGET_BPS) return { held: false, consumed };
  return { held: true, consumed: next };
}

describe("measureBufferAsk decision parity", () => {
  // @rule R2
  it("[R2] answers exactly what the shipped callback answers, across the range", () => {
    // Every combination that matters, including both sides of the boundary and the exact hit.
    for (const consumed of [0, 1, 100, 250, 499, 500, 501]) {
      for (const asked of [0, 1, 49, 50, 250, 499, 500, 501, 1030, 10_000]) {
        const expected = shippedDecision(consumed, asked);
        const measured = measureBufferAsk({
          askedBps: asked,
          consumedBps: consumed,
          budgetBps: BUDGET_BPS,
          askIndex: 0,
        });
        expect({ held: measured.held, consumed: measured.cumulativeBps }).toEqual(expected);
      }
    }
  });

  // @rule R2
  it("[R2] refuses the documented flagship case: 1030 bps against a fresh 500 bps budget", () => {
    // `ProvisioningPanel.flagship.test.tsx` drives the buffer-exceeded prompt with exactly this ask.
    const measured = measureBufferAsk({
      askedBps: 1030,
      consumedBps: 0,
      budgetBps: BUDGET_BPS,
      askIndex: 0,
    });
    expect(measured.held).toBe(false);
    expect(measured.cumulativeBps).toBe(0);
  });

  // @rule R2
  it("[R2] holds an ask that lands exactly ON the budget", () => {
    // `>` and not `>=`: spending the last basis point is spending, not overspending.
    expect(
      measureBufferAsk({ askedBps: 500, consumedBps: 0, budgetBps: BUDGET_BPS, askIndex: 0 }).held,
    ).toBe(true);
    expect(
      measureBufferAsk({ askedBps: 1, consumedBps: 499, budgetBps: BUDGET_BPS, askIndex: 0 }).held,
    ).toBe(true);
    expect(
      measureBufferAsk({ askedBps: 1, consumedBps: 500, budgetBps: BUDGET_BPS, askIndex: 0 }).held,
    ).toBe(false);
  });

  // @rule R2
  it("[R2] a refused ask never banks, so a later leg sees the untouched total", () => {
    // A rejected move was never sent, so it never happened against the budget.
    const refused = measureBufferAsk({
      askedBps: 600,
      consumedBps: 200,
      budgetBps: BUDGET_BPS,
      askIndex: 1,
    });
    expect(refused.held).toBe(false);
    expect(refused.cumulativeBps).toBe(200);
    expect(refused.headroomBps).toBe(300);
  });

  // @rule R2
  it("[R2] a held ask banks, so the running total accumulates across legs", () => {
    const first = measureBufferAsk({
      askedBps: 200,
      consumedBps: 0,
      budgetBps: BUDGET_BPS,
      askIndex: 0,
    });
    expect(first).toMatchObject({ held: true, cumulativeBps: 200, headroomBps: 300 });
    const second = measureBufferAsk({
      askedBps: 250,
      consumedBps: first.cumulativeBps,
      budgetBps: BUDGET_BPS,
      askIndex: 1,
    });
    expect(second).toMatchObject({ held: true, cumulativeBps: 450, headroomBps: 50 });
  });
});

describe("the measurement itself ([R1])", () => {
  // @rule R1
  it("[R1] reports what was asked, what is spent, the budget and the headroom", () => {
    const measured = measureBufferAsk({
      askedBps: 120,
      consumedBps: 80,
      budgetBps: BUDGET_BPS,
      askIndex: 2,
    });
    expect(measured).toEqual({
      askedBps: 120,
      cumulativeBps: 200,
      budgetBps: 500,
      headroomBps: 300,
      held: true,
      askIndex: 2,
    });
  });

  // @rule R1
  it("[R1] headroom never goes negative, because a refusal does not spend", () => {
    // The measurement has to be readable as a series. A negative headroom would mean the budget was
    // overspent, which cannot happen: the ask that would have done it was refused instead.
    for (const asked of [501, 5_000, 10_000]) {
      const measured = measureBufferAsk({
        askedBps: asked,
        consumedBps: 0,
        budgetBps: BUDGET_BPS,
        askIndex: 0,
      });
      expect(measured.headroomBps).toBeGreaterThanOrEqual(0);
    }
  });

  // @rule R2
  it("[R2] a zero ask is total-preserving, a purity property and NOT a production data point", () => {
    // Deliberately not read as "a re-quote that held is recorded as 0 bps": production never
    // produces that row. `gateRequote` (`buildPlanSteps.ts`) returns BEFORE it calls the consumer
    // unless the re-quote is materially worse, so every real `askedBps` is above
    // `REQUOTE_MATERIAL_BPS` (100). What this pins is the function's own behaviour on the identity
    // ask: it banks nothing, moves no total, and is therefore safe under any future caller.
    expect(
      measureBufferAsk({ askedBps: 0, consumedBps: 0, budgetBps: BUDGET_BPS, askIndex: 0 }),
    ).toMatchObject({
      askedBps: 0,
      held: true,
      cumulativeBps: 0,
      headroomBps: 500,
    });
  });

  // @rule R2
  it("[R2] is pure: the same ask measured twice gives the same answer", () => {
    // The ledger holds no state of its own. The running total belongs to the panel's ref, which is
    // what keeps this module unable to influence sizing.
    const ask = { askedBps: 120, consumedBps: 80, budgetBps: BUDGET_BPS, askIndex: 2 };
    expect(measureBufferAsk(ask)).toEqual(measureBufferAsk(ask));
  });
});

describe("[R2]/[R3] the ledger cannot reach sizing", () => {
  // @rule R2
  it("[R2] has no write path into sizing: it imports nothing that sizes", () => {
    const source = readFileSync(join(__dirname, "bufferLedger.ts"), "utf8");
    // Comments are stripped first, and deliberately: the header NAMES the sizing surface, because
    // saying what this measurement is not (`seedRequiredUsd` sizes dollars, this counts basis
    // points) is the whole point of that paragraph, and a doc comment is not a dependency. What must
    // stay absent is a reference in the CODE, which is where an import lives. A measurement module
    // that imported the sizing surface would be one refactor away from steering it, which is exactly
    // what [R2] forbids until a decision is taken.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/seedRequiredUsd|fundingSelection|buildPlan|import .*fundingTarget/);
  });

  // @rule R3
  it("[R3] the rate is still 5%, and reducing it is P4-3's decision, not this issue's", () => {
    // Handoff rejection 13. The measured headroom on a $1000 op with $5 gas is ~3.0% at 5% and
    // 0.02% at 3% once 3% slippage is real, so the number is not obviously safe to move; this issue
    // exists to produce the evidence, not to spend it.
    expect(SEED_BUFFER_RATE).toBe(0.05);
    expect(DEFAULT_SOURCE_BUFFER_RATE).toBe(SEED_BUFFER_RATE);
  });
});
