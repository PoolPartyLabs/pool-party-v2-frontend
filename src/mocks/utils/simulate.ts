/**
 * @id PP-CORE-MCK-001
 * @name simulate
 * @implements-rules-version v1
 *
 * Simulation helpers for the mock service layer: pseudo-random delays, probabilistic
 * failures, and random element selection, so mocked services can mimic real network
 * latency and error conditions (see docs/05_MOCK_STRATEGY.md).
 */

/**
 * Resolve after a pseudo-random delay (in milliseconds) within the inclusive range
 * [min, max]. Used to mimic network latency in mocked services.
 *
 * @param min - Lower bound of the delay in milliseconds.
 * @param max - Upper bound of the delay in milliseconds.
 * @returns A promise that resolves once the delay elapses.
 */
export function simulateDelay(min: number, max: number): Promise<void> {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const ms = lo + Math.random() * (hi - lo);
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Throw a synthetic error with the given probability, used to mimic intermittent
 * failures in mocked services.
 *
 * `simulateError(1)` always throws; `simulateError(0)` never throws. The probability is
 * clamped to the [0, 1] range.
 *
 * @param probability - Chance of throwing, between 0 (never) and 1 (always).
 * @throws {Error} When the random draw falls below `probability`.
 */
export function simulateError(probability: number): void {
  const p = Math.min(1, Math.max(0, probability));
  if (Math.random() < p) {
    throw new Error("Simulated error");
  }
}

/**
 * Return a randomly chosen element from a non-empty array.
 *
 * @typeParam T - Element type of the array.
 * @param arr - A non-empty readonly array to pick from.
 * @returns A randomly selected element of `arr`.
 * @throws {Error} When `arr` is empty.
 */
export function randomFromArray<T>(arr: readonly T[]): T {
  if (arr.length === 0) {
    throw new Error("Cannot pick a random element from an empty array");
  }
  const index = Math.floor(Math.random() * arr.length);
  // Safe under noUncheckedIndexedAccess: index is in [0, arr.length) and arr is non-empty.
  return arr[index] as T;
}
