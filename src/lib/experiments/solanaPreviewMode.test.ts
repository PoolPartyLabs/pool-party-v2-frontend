/**
 * @id PP-CORE-LIB-124
 * @name solanaPreviewMode tests
 * @implements-rules-version v2 (POO-2281)
 * @analytics-events none, pure gesture regression tests.
 */
import { describe, expect, it } from "vitest";
import { advanceSolanaPreviewGesture, createSolanaPreviewGesture } from "./solanaPreviewMode";

describe("local Solana preview reveal gesture", () => {
  // @rule R1: three explicit presses within one second.
  it("requests activation on the third press, including the window boundary", () => {
    let gesture = createSolanaPreviewGesture();
    for (const now of [100, 500]) {
      const result = advanceSolanaPreviewGesture(gesture, now);
      expect(result.ready).toBe(false);
      gesture = result.gesture;
    }
    const result = advanceSolanaPreviewGesture(gesture, 1_100);
    expect(result.ready).toBe(true);
    expect(result.gesture).toEqual(createSolanaPreviewGesture());
  });

  // @rule R1: a slow or backwards sequence starts a fresh burst.
  it.each([1_101, 50])("restarts after an invalid time interval: %s", (now) => {
    const first = advanceSolanaPreviewGesture(createSolanaPreviewGesture(), 100).gesture;
    const result = advanceSolanaPreviewGesture(first, now);
    expect(result.ready).toBe(false);
    expect(result.gesture).toEqual({ count: 1, firstAt: now });
  });

  // @rule R1: invalid clock cannot accumulate presses.
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("clears the sequence for a non-finite clock: %s", (now) => {
    expect(advanceSolanaPreviewGesture({ count: 2, firstAt: 100 }, now)).toEqual({
      gesture: createSolanaPreviewGesture(),
      ready: false,
    });
  });

  // @rule R3: no persisted family, grant or draft participates in the gesture.
  it("is pure and leaves the input unchanged", () => {
    const gesture = Object.freeze({ count: 1, firstAt: 100 });
    expect(advanceSolanaPreviewGesture(gesture, 200).gesture.count).toBe(2);
    expect(gesture).toEqual({ count: 1, firstAt: 100 });
  });
});
