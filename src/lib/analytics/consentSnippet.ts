/**
 * @id PP-CORE-LIB
 * @name CONSENT_DEFAULT_SNIPPET
 * Inline Consent Mode v2 default (denied) snippet injected before GTM in the app layout. Kept in
 * one module so the CSP that allowlists it by SHA-256 hash (src/lib/security/csp.ts) can be
 * drift-tested against this exact string. If you edit this snippet, recompute the hash in csp.ts
 * (the csp.test.ts drift guard will fail until you do).
 */
export const CONSENT_DEFAULT_SNIPPET =
  "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}" +
  "gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied',wait_for_update:500});";
