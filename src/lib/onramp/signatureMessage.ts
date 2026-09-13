/**
 * @id PP-CORE-LIB-063 (POO-1132)
 * @name on-ramp signature message
 * @implements-rules-version v2 (POO-1132 rules v2)
 *
 * The exact plaintext the wallet `personal_sign`s before an on-ramp purchase, and the single source of
 * truth for its shape. Pure and client-importable (the browser is where the signing happens), so the
 * sign-and-continue client (POO-1135) builds a message the backend will accept instead of re-deriving
 * a shape that must match byte-for-byte.
 *
 * ## Why the backend cares about the shape (verified, POO-1132)
 *
 * The message rule is not cosmetic. `OnRampService.verifyOnRampSignature`
 * (pool-party-api `on-ramp/on-ramp.service.ts:62-98`, merged) does three things with this string, and
 * all three are load-bearing:
 *   1. `verifyMessage({ address, message, signature })` — the signature must recover to the wallet the
 *      SERVER derived from the SIWE session (the action's `recipientAddress`), not one the caller named.
 *   2. `message.toLowerCase().includes("wallet: " + address.toLowerCase())` — so the message MUST carry
 *      a `Wallet: <addr>` line. This is what binds a stolen-but-valid signature to a wallet.
 *   3. `message.match(/Timestamp: (.+)$/m)` → rejects anything older than 5 minutes, a replay window.
 *      The `Timestamp:` line therefore has to be a fresh, `Date`-parseable value on its OWN line.
 *
 * So this reproduces v1's shape verbatim (`pool-party-interface` wallet-modal): a fixed disclosure, a
 * `Wallet:` line, a `Timestamp:` line. A drift in either label silently breaks signing in production,
 * which is why the shape is unit-tested here rather than inlined at the (not-yet-built) call site.
 *
 * PP-I18N: intentionally NOT internationalized. A signed message is a security artifact, not app UI:
 * the backend matches the literal English tokens `Wallet:` / `Timestamp:`, `verifyMessage` needs the
 * exact signed bytes, and localizing would make the signed payload vary by locale for no user benefit
 * (the wallet renders it, not our DOM). This mirrors the SIWE message, which is likewise not localized.
 */

/**
 * The fixed consent preamble, verbatim from v1 (`pool-party-interface`). It is what the user
 * acknowledges when they sign: no KYC / no personal data on our side, the on-ramp provider may collect
 * an IP for compliance, we store none of it. Kept identical so the consent text a user signs does not
 * change silently between the two interfaces during the migration.
 */
const ON_RAMP_SIGNATURE_PREAMBLE = `Pool Party On-Ramp Verification

This signature confirms you are the owner of this wallet. It will not cost any gas.

By signing, you acknowledge that:
- Pool Party does not process any personal data and requires no KYC
- The on-ramp provider may collect your IP address and other information for security and compliance purposes
- Pool Party does not store any of this data
- More information can be found at https://pool-party.xyz/`;

/**
 * Build the on-ramp verification message for `wallet`, timestamped at `now`.
 *
 * The `Wallet:` and `Timestamp:` lines are the two the backend parses (see the module header); the
 * timestamp is an ISO-8601 string so `new Date(...)` round-trips it inside the 5-minute replay window.
 * `now` is injectable purely so the shape is deterministically testable; production omits it and gets
 * the current instant, which must be signed within five minutes.
 *
 * The wallet is written as passed (checksummed or lowercase both work: the backend lowercases both
 * sides of its `includes` check). Callers should pass the SESSION wallet, since that is what the
 * action forwards as `recipientAddress` and what the signature must recover to.
 */
export function buildOnRampSignatureMessage(wallet: string, now: Date = new Date()): string {
  return `${ON_RAMP_SIGNATURE_PREAMBLE}

Wallet: ${wallet}
Timestamp: ${now.toISOString()}`;
}
