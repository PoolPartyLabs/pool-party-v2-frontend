/**
 * @id PP-REW-LIB-007 (POO-718, POO-853)
 * @name pendingReferralCode
 * @implements-rules-version v1
 *
 * The `?ref=` referral-capture persistence (POO-718 [R1][R2]). The v2 landing and the SIWE connect are
 * decoupled (a visitor may land signed out, then connect on a later navigation that drops the query), so
 * unlike v1's single-session hold the captured code is persisted in a first-touch `pp_ref` cookie until
 * the next authenticated load can apply it.
 *
 * Client-safe (guards `document`/`window`), so BOTH the client `ReferralTracker` (capture + optimistic
 * clear) and the server-only `applyReferralCode` (which reads the cookie name via `next/headers`) can
 * import it. The cookie is intentionally NOT HttpOnly: the value is a low-trust referral code the client
 * writes on capture, and the apply Server Action still reads it server-side via `cookies()`. It is not a
 * session secret. `Secure` is added only on an https origin so capture also works on http localhost.
 *
 * The accepted code shape is the FULL backend contract `^[A-Za-z0-9]{3,10}$` (POO-853 [R2]), NOT the
 * stricter creation floor. Capture must honor anything the backend may hold: a legacy 3-5 char code
 * arriving via `?ref=` still counts, even though v2's creation form floors new codes at 6 (POO-290).
 * The value is kept AS-TYPED (case-sensitive) end-to-end per the shared `?ref=` contract (POO-717);
 * nothing here lowercases it.
 */

/** The first-touch referral-capture cookie name (read server-side by the apply action). */
export const PENDING_REFERRAL_COOKIE = "pp_ref";
/** Cookie TTL: 30 days (POO-718 [R2]). Long enough to survive the connect round-trip and a return visit. */
export const PENDING_REFERRAL_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Accepted `?ref=` code shape: the full backend contract, 3-10 alphanumerics (POO-853 [R2]). */
const CODE_PATTERN = /^[a-zA-Z0-9]{3,10}$/;

/** [R1] Whether a raw `?ref=` value is a well-formed referral code (empty/malformed → discard). */
export function isValidReferralCode(value: string | null | undefined): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

/** The pending referral code from the `pp_ref` cookie, or null (also null during SSR). */
export function readPendingReferralCode(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === PENDING_REFERRAL_COOKIE) {
      const value = rest.join("=");
      return value.length > 0 ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

/**
 * [R2] First-touch persist: write `pp_ref` only when no pending code exists (first `?ref=` wins; a later
 * different `?ref=` never overwrites). Returns true when it wrote, false when a code was already pending.
 */
export function writePendingReferralCodeFirstTouch(code: string): boolean {
  if (typeof document === "undefined") return false;
  if (readPendingReferralCode() !== null) return false;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:";
  // biome-ignore lint/suspicious/noDocumentCookie: synchronous, SSR-safe, universally-supported first-touch write (the async Cookie Store API is not available in all browsers).
  document.cookie =
    `${PENDING_REFERRAL_COOKIE}=${encodeURIComponent(code)}` +
    `; Max-Age=${PENDING_REFERRAL_MAX_AGE_SECONDS}; path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  return true;
}

/**
 * POO-853 [R5]: the invest-time apply RETRY only fires above this first-invest floor (v1 parity: the
 * add-liquidity path gated at `20 * 1e6` USDC). The primary visit-time apply (POO-718) has no minimum;
 * this belt-and-braces retry re-runs it after a qualifying first invest in case capture was missed.
 */
export const REFERRAL_APPLY_MIN_USD = 20;

/**
 * [R5] Whether a just-confirmed invest should re-run the (idempotent) apply: a referral code is still
 * pending AND the invest cleared the {@link REFERRAL_APPLY_MIN_USD} floor.
 */
export function qualifiesForApplyRetry(amountUsd: number, hasPendingCode: boolean): boolean {
  return hasPendingCode && amountUsd >= REFERRAL_APPLY_MIN_USD;
}

/** [R8] Optimistic client clear of `pp_ref` (the apply Server Action also clears it server-side). */
export function clearPendingReferralCode(): void {
  if (typeof document === "undefined") return;
  // biome-ignore lint/suspicious/noDocumentCookie: synchronous expiry write; see writePendingReferralCodeFirstTouch.
  document.cookie = `${PENDING_REFERRAL_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
}
