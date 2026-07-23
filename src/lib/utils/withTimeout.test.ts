/**
 * @id PP-CORE-LIB-038 (POO-707)
 * @name withTimeout tests
 * @implements-rules-version v1
 *
 * A wedged/hung wallet provider (POO-702 silent-hang) must fail VISIBLY rather than leaving the
 * profile Save spinner spinning forever. {@link withTimeout} races a promise against a deadline: it
 * resolves/rejects with the promise when it settles first, and rejects with a {@link TimeoutError}
 * when the deadline wins. The pending timer is always cleared so a settled promise leaves no dangling
 * timer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, withTimeout } from "./withTimeout";

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the promise value when it settles before the deadline", async () => {
    const result = withTimeout(Promise.resolve("ok"), 1000);
    await expect(result).resolves.toBe("ok");
  });

  it("rejects with the promise error when it rejects before the deadline", async () => {
    const result = withTimeout(Promise.reject(new Error("boom")), 1000);
    await expect(result).rejects.toThrow("boom");
  });

  it("rejects with a TimeoutError when the deadline wins (wedged provider)", async () => {
    // A promise that never settles — the wedged/hung wallet provider case (POO-702).
    const result = withTimeout(new Promise<never>(() => {}), 1000, "Wallet timed out");
    const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    await expect(result).rejects.toThrow("Wallet timed out");
  });

  it("clears the timer when the promise settles first (no dangling timer)", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await withTimeout(Promise.resolve("done"), 5000);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
