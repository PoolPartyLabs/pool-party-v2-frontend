import { afterEach, describe, expect, it, vi } from "vitest";
import { randomFromArray, simulateDelay, simulateError } from "./simulate";

describe("simulateError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always throws when probability is 1", () => {
    expect(() => simulateError(1)).toThrow();
  });

  it("never throws when probability is 0", () => {
    expect(() => simulateError(0)).not.toThrow();
  });

  it("throws when the random draw falls below the probability", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.4);
    expect(() => simulateError(0.5)).toThrow();
  });

  it("does not throw when the random draw is at or above the probability", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(() => simulateError(0.5)).not.toThrow();
  });
});

describe("randomFromArray", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an element that is a member of the array", () => {
    const arr = ["a", "b", "c"] as const;
    expect(arr).toContain(randomFromArray(arr));
  });

  it("selects by index derived from Math.random", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(randomFromArray([10, 20, 30])).toBe(30);
  });

  it("throws on an empty array", () => {
    expect(() => randomFromArray([])).toThrow();
  });
});

describe("simulateDelay", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves after the timer fires", async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const promise = simulateDelay(100, 200).then(settled);

    expect(settled).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await promise;

    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately for a zero-length range", async () => {
    await expect(simulateDelay(0, 0)).resolves.toBeUndefined();
  });

  it("handles an inverted range (min greater than max)", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = simulateDelay(200, 100);
    await vi.runAllTimersAsync();
    await promise;

    const delayArg = setTimeoutSpy.mock.calls[0]?.[1] ?? Number.NaN;
    expect(delayArg).toBeGreaterThanOrEqual(100);
    expect(delayArg).toBeLessThanOrEqual(200);
  });
});
