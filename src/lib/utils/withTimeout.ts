/**
 * @id PP-CORE-LIB-038 (POO-707)
 * @name withTimeout
 * @implements-rules-version v1
 *
 * Race a promise against a deadline so a wedged/hung dependency fails VISIBLY instead of spinning
 * forever. Used by the profile Save flows ([R6], POO-707): a hung wallet provider (the POO-702
 * silent-hang) or a stalled upload rejects after the deadline, which the caller surfaces as an
 * explicit error rather than an infinite saving state.
 *
 * The pending timer is always cleared once the race settles, so a promise that resolves fast leaves no
 * dangling timer (and a test's fake-timer clock stays clean).
 */

/** Rejection thrown when a {@link withTimeout} deadline elapses before the wrapped promise settles. */
export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Resolve/reject with `promise` when it settles before `ms`; otherwise reject with a {@link TimeoutError}.
 * `message` customizes the timeout error (e.g. which operation wedged).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
