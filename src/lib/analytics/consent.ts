/**
 * @id PP-CORE (SETUP-014 / POO-82)
 * @name consent
 * @implements-rules-version v1
 *
 * Consent state persisted in the first-party `pp_consent` cookie (read client-side by the banner
 * and by `useAnalytics`). Consent Mode v2 defaults to `denied`; granting flips analytics/ad storage.
 * The cookie is Secure + SameSite=Lax but NOT HttpOnly (the client must read it).
 */
export type ConsentState = "granted" | "denied" | "unknown";

export const CONSENT_COOKIE = "pp_consent";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Read the persisted consent choice from the cookie. Returns "unknown" before any choice. */
export function readConsent(): ConsentState {
  if (typeof document === "undefined") return "unknown";
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  const value = entry?.slice(CONSENT_COOKIE.length + 1);
  return value === "granted" || value === "denied" ? value : "unknown";
}

/** Persist a consent choice in the first-party cookie (client-side). */
export function writeConsent(state: "granted" | "denied"): void {
  if (typeof document === "undefined") return;
  document.cookie = `${CONSENT_COOKIE}=${state}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; Secure; SameSite=Lax`;
  // Signal in-page listeners (e.g. AnalyticsIdentify) so a banner choice applies without a reload.
  window.dispatchEvent(new CustomEvent("pp:consent", { detail: state }));
}

/**
 * Update Consent Mode v2 after a choice. Relies on the `gtag` shim defined before GTM loads
 * (see the app shell). No-op when GTM is absent (local dev), since `window.gtag` is undefined.
 */
export function updateConsentMode(granted: boolean): void {
  if (typeof window === "undefined") return;
  const value = granted ? "granted" : "denied";
  window.gtag?.("consent", "update", { ad_storage: value, analytics_storage: value });
}
