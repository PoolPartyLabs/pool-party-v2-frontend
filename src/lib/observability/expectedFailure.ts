/**
 * @id PP-CORE-LIB-074 (POO-1147)
 * @name expected non-outage predicate
 * @implements-rules-version v1
 *
 * `isExpectedNonOutage`, moved out of the `server-only` `logger.ts` so the BROWSER can apply the same
 * rule. `logger.ts` re-exports it, so every existing import and the POO-243 tests are untouched.
 *
 * The move is the whole reason this file exists. POO-243 wired a global `QueryCache`/`MutationCache`
 * `onError` (`providers.tsx`), which means EVERY failing wagmi/viem/react-query read now reaches
 * `reportClientError` - including the two failures that are not failures: mock mode, and a wallet
 * with no data yet. Forwarding those to an error tracker would put a permanent floor of expected
 * events under the error rate, which is how a dashboard becomes something nobody looks at. That was
 * `observeAnalyticsFailure`'s single best idea ([R3]/[R4], POO-567) and it has to survive the vendor.
 *
 * Client-safe: no `server-only`, no Node APIs.
 */

/** The shape {@link isExpectedNonOutage} duck-types off a caught error. */
interface CodedError {
  status?: number;
  code?: string;
}

/**
 * True when a failure is an EXPECTED non-outage that must stay SILENT. Lifted verbatim from
 * `observeAnalyticsFailure` ([R3]/[R4], POO-567), which is the single most important piece of design
 * in the prototype: a logger that fires on mock mode and on every young wallet trains everyone to
 * ignore it, and then the real outage scrolls past unread.
 *
 * - `SYSTEM_NOT_CONFIGURED`: mock mode / an unset upstream URL. Not an outage, it is the default.
 * - 404 / `WALLET_NOT_FOUND`: the wallet simply has no data for this slice yet.
 * - 429: our OWN throttle answering, which is the system working rather than failing. It is here for
 *   a second and more important reason: the global `QueryCache` `onError` means one throttled minute
 *   turns every failing read in every open tab into a report, so the reporting AMPLIFIES under
 *   exactly the load that caused it. A rate limit is the one failure class where the volume of
 *   reports scales with the problem instead of describing it.
 *
 * Deliberately NOT here: RPC transport flakes from the keyless public endpoints (`HttpRequestError`,
 * `TimeoutError`). Those are noisy but they are somebody's broken session, and there is no volume
 * figure to tune against yet; they stay visible until there is one.
 */
export function isExpectedNonOutage(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { status, code } = error as CodedError;
  if (code === "SYSTEM_NOT_CONFIGURED") return true;
  if (status === 404 || code === "WALLET_NOT_FOUND") return true;
  if (status === 429) return true;
  return false;
}
