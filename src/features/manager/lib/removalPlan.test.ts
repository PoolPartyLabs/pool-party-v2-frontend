/**
 * @id PP-MGR-MOD (POO-312)
 * @name removalPlan tests
 * @implements-rules-version v1
 *
 * > 50% closes; dust (< $5 remaining) promotes a partial to a close; otherwise partial.
 */
import { describe, expect, it } from "vitest";
import { ownedRemovalClosesPool, planRemoval } from "./removalPlan";

describe("planRemoval", () => {
  it("keeps 1–50% as a partial remove", () => {
    const plan = planRemoval(25, 1000);
    expect(plan.closing).toBe(false);
    expect(plan.percentage).toBe(25);
    expect(plan.newAmountUsd).toBeCloseTo(750, 6);
  });

  it("treats exactly 50% as a partial", () => {
    expect(planRemoval(50, 1000).closing).toBe(false);
  });

  it("closes when the percentage is strictly greater than 50", () => {
    const plan = planRemoval(51, 1000);
    expect(plan.closing).toBe(true);
    expect(plan.percentage).toBe(100);
    expect(plan.newAmountUsd).toBe(0);
  });

  it("promotes to a close when the remaining value would be dust (< $5)", () => {
    // 96% of $100 leaves $4 (< $5) → close.
    const plan = planRemoval(96, 100);
    expect(plan.closing).toBe(true);
    expect(plan.percentage).toBe(100);
  });

  it("does not treat a zero remainder (100%) as dust — it's already a close", () => {
    const plan = planRemoval(100, 100);
    expect(plan.closing).toBe(true);
    expect(plan.newAmountUsd).toBe(0);
  });

  it("leaves a comfortable remainder as a partial", () => {
    // 50% of $100 leaves $50 (>= $5) → partial.
    expect(planRemoval(50, 100).closing).toBe(false);
  });
});

describe("ownedRemovalClosesPool", () => {
  // @rule POO-847 R4: the owned mobile withdraw mirrors the desktop POO-312 threshold on a USD
  // amount — a full exit OR a > 50% removal OR a dust remainder promotes to a full pool close.
  it("[POO-847 R4] a full USD exit closes the pool", () => {
    expect(ownedRemovalClosesPool(100, 100)).toBe(true);
  });

  it("[POO-847 R4] a near-full USD amount (float slack) closes the pool", () => {
    expect(ownedRemovalClosesPool(100 - 1e-9, 100)).toBe(true);
  });

  it("[POO-847 R4] a > 50% removal promotes to a close", () => {
    // $60 of $100 = 60% (> 50) → close.
    expect(ownedRemovalClosesPool(60, 100)).toBe(true);
  });

  it("[POO-847 R4] exactly 50% stays a partial (not a close)", () => {
    expect(ownedRemovalClosesPool(50, 100)).toBe(false);
  });

  it("[POO-847 R4] a <= 50% removal stays a partial", () => {
    expect(ownedRemovalClosesPool(25, 100)).toBe(false);
  });

  it("[POO-847 R4] a dust remainder (< $5 left) promotes to a close", () => {
    // $96 of $100 leaves $4 (< $5) → close, even though it is under a full exit.
    expect(ownedRemovalClosesPool(96, 100)).toBe(true);
  });

  it("[POO-847 R4] a zero / non-positive position never closes", () => {
    expect(ownedRemovalClosesPool(0, 0)).toBe(false);
  });
});
