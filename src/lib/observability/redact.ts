/**
 * @id PP-CORE-LIB-072 (POO-1147)
 * @name redaction primitives
 * @implements-rules-version v1
 *
 * The address/secret masking POO-243 wrote inside `logger.ts`, lifted into a leaf so the BROWSER can
 * use it too. `logger.ts` is `server-only`; the Sentry `beforeSend` scrubber runs in the browser, on
 * the Node server and on the Edge runtime, and it has to mask exactly the same things the log lines
 * do or the two channels disagree about what counts as sensitive.
 *
 * Behaviour of {@link redactAddresses} is unchanged from POO-243 (`logger.test.ts` still asserts it
 * through the logger's re-export). {@link redactSecrets} is additive and used ONLY by the Sentry
 * scrubber: a log line is written by us from values we chose, whereas a Sentry event carries whatever
 * an SDK integration scraped off the page, so it needs the wider net.
 *
 * Client-safe: no `server-only`, no Node APIs.
 */

/**
 * Mask every EVM-ish `0x…` run in a string to `0x1234…cdef`. Applied to every string that reaches a
 * log line, so a wallet embedded in an endpoint path (`portfolio/0xabc…`), a query string
 * (`?managerWallet=0x…`) or a correlation key is masked without each call site having to remember.
 * Eight hex digits is the floor so a chain id, a short selector or a `0x0` is left alone.
 *
 * The prefix is matched case-INSENSITIVELY. The hex digits always were, but the literal `0x` was
 * not, so an uppercased run (`0XABCD…`) walked straight through the mask. That is reachable: the
 * API's `toMachineCode(label)` uppercases its whole input, and POO-1173 widened what flows into
 * `error_code`, so a value that passed through it arrives uppercased prefix and all.
 */
export function redactAddresses(value: string): string {
  return value.replace(
    /0[xX][0-9a-fA-F]{8,}/g,
    (match) => `0x${match.slice(2, 6)}…${match.slice(-4)}`,
  );
}

/**
 * Mask a long UNPREFIXED hex run, e.g. a raw 64-character private key or a 40-character address that
 * lost its `0x` on the way into a message. Forty is the floor on purpose: it is the shortest thing
 * here worth hiding (an address), and it is comfortably above the 8-to-32-character hex that build
 * hashes, trace ids and chunk names are made of, which must stay readable to be useful.
 *
 * Runs already masked by {@link redactAddresses} are not re-matched: the `…` breaks the run.
 */
function redactBareHex(value: string): string {
  return value.replace(
    /\b[0-9a-fA-F]{40,}\b/g,
    (match) => `${match.slice(0, 4)}…${match.slice(-4)}`,
  );
}

/**
 * The full mask for a value leaving the app in a Sentry event: `0x…` runs first, then any bare hex
 * run long enough to be a key or an address.
 */
export function redactSecrets(value: string): string {
  return redactBareHex(redactAddresses(value));
}
