/**
 * @id PP-REW-LIB-010 (POO-579)
 * @name referralWelcome
 * @implements-rules-version v1
 *
 * Feature B (POO-579): a one-time "you joined through a referral" flag. When a new user's `?ref=` code
 * is validated (the apply succeeds — happens once, ever), the `ReferralTracker` marks this flag right
 * before `router.refresh()`, so it survives the navigation to Home. The Home `ReferralWelcomeBanner`
 * consumes it on mount (read-and-clear) and shows the welcome banner exactly once.
 *
 * This is a simple, non-sensitive UI signal (a boolean the user could clear in devtools with no
 * consequence beyond hiding a welcome banner), so localStorage is the right store per the repo policy
 * (`usePersistentState` doc). It is intentionally NOT a session/auth flag. Client-safe: every access
 * guards `window`/`localStorage` and fails silently (private mode, quota, SSR) so it never throws.
 */

/** The one-time referral-welcome flag key (simple UI pref; repo localStorage policy). */
export const REFERRAL_WELCOME_KEY = "pp-referral-welcome";

/** The stored sentinel value. Presence (=== this) means a welcome is pending. */
const PENDING_VALUE = "1";

/** Flag that a first-time referral welcome should show on the next Home render. */
export function markReferralWelcomePending(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REFERRAL_WELCOME_KEY, PENDING_VALUE);
  } catch {
    // Unavailable storage (private mode / quota / SSR) — the banner just won't show; not critical.
  }
}

/**
 * Read-and-clear the pending flag. Returns true exactly once after a `mark`; every subsequent call
 * (and any call with no prior mark) returns false, so the banner shows exactly once.
 */
export function consumeReferralWelcomePending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const pending = window.localStorage.getItem(REFERRAL_WELCOME_KEY) === PENDING_VALUE;
    if (pending) window.localStorage.removeItem(REFERRAL_WELCOME_KEY);
    return pending;
  } catch {
    return false;
  }
}
