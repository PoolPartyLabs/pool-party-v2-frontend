/**
 * @id PP-CORE (SETUP-015 / POO-81)
 * @name securityHeaders
 * @implements-rules-version v1
 *
 * Static HTTP security headers applied to every response via `next.config.ts` `headers()`.
 * Source: `docs/10_SECURITY.md` (Frontend-owned controls) + the `frontend-security` skill.
 * The Content-Security-Policy is set per request in `src/middleware.ts`; these are the static layer.
 */
export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * The allowlist body shared by every feature the embedded Paybis checkout needs: our own origin plus
 * the two vetted widget hosts, never `*`.
 *
 * One constant rather than the same quoted pair written three times, because the structural guard in
 * `headers.test.ts` exists precisely because a single stray quote anywhere in this value makes the
 * browser discard the WHOLE header and revert every feature to its default `self` allowlist. Three
 * hand-written copies is three chances to cause that silently.
 *
 * Dev loads `widget.sandbox.paybis.com` (`.env.dev`), prod loads `widget.paybis.com` (`.env.prod`),
 * and both are already inside the `https://*.paybis.com` CSP allowlist (POO-1138), so neither host
 * adds reachability the CSP did not already permit.
 */
const PAYBIS_WIDGET_ALLOWLIST =
  'self "https://widget.paybis.com" "https://widget.sandbox.paybis.com"';

export const securityHeaders: SecurityHeader[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // PP-SECURITY [R4]: clickjacking, paired with CSP `frame-ancestors 'none'`.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    /**
     * PP-SECURITY: default-deny, with three delegations the embedded fiat checkout requires, all to
     * the same two vetted vendor origins and never to `*`.
     *
     * `payment=()` was an empty allowlist, which disables the Payment Request API for the whole
     * document INCLUDING our own origin. That is what broke the embedded fiat checkout, and it broke
     * it invisibly: inside `widget.paybis.com`, `<GooglePayButton>` calls `initGooglePaymentRequest`
     * as the payment-details step loads, `new PaymentRequest()` throws
     * `SecurityError: Must be in a top-level browsing context or an iframe needs to specify
     * allow="payment" explicitly` (DOMException 18), the widget's Vue handler catches it, and the
     * user gets our generic ONRAMP_ERROR with nothing behind it. Confirmed 2026-08-06 from Paybis'
     * own Sentry envelope, captured off the network tab.
     *
     * `allow="payment"` on the iframe alone could never have fixed it, which is worth stating because
     * this file's sibling note in `PaybisWidgetFrame` suggested exactly that as the first thing to
     * try: a document cannot DELEGATE a feature it does not itself have. Both halves are needed, and
     * this is the half we own.
     *
     * Scoped to `self` plus the widget origins, not `*`. The API is the browser's own payment sheet
     * (Google Pay / Apple Pay); granting it to one vetted origin that we already frame, already
     * allowlist in CSP `frame-src`, and already hand a purchase intent to, adds no reachable surface.
     *
     * ## camera and microphone (POO-1496)
     *
     * Structurally the same defect, left live for identity verification after POO-1405 fixed
     * `payment`. Paybis runs KYC INSIDE the embedded checkout through Sumsub, document capture plus a
     * selfie, and documents the requirement in three places including a verbatim iframe recipe. An
     * exhaustive sweep of their doc set found no second-device path of any kind: no mobile handoff, no
     * device-switch QR, no SMS link. So a user who cannot grant camera here has no route to
     * verification at all, and the empty allowlist denied it to every child frame.
     *
     * The iframe half needs nothing from us, which POO-1496 established against the live vendor bundle
     * rather than assuming: `createIframe` sets
     * `allow="clipboard-read; clipboard-write *; payment *; camera *; microphone *"` on the element it
     * builds, while it is still DETACHED and before it is appended. A frame resolves its permissions
     * policy when it NAVIGATES and a detached iframe does not navigate, so the vendor's delegation is
     * committed before the load. This header is the only half we own.
     *
     * `geolocation` and `usb` stay denied. This delegates two more capabilities to one vetted origin,
     * it does not relax the posture.
     *
     * ## Compliance, recorded rather than implied
     *
     * `CR-CORE-011` asks whether we SHOULD delegate biometric capture through a frame we embed, given
     * the permission is granted by our origin even though Paybis and Sumsub are the parties that
     * receive and assess the document and the face. It is OPEN, owner Legal, and this ships ahead of
     * it on Rafael's explicit authorization (2026-08-10), logged in `docs/COMPLIANCE_REGISTER.md` as
     * `ACCEPTED RISK`. That is the register's own word for shipping with the reasoning on the record,
     * and it is deliberately NOT `ANSWERED`: no Legal determination exists, and nothing here should be
     * read as one. Part (b) of that row is still a live product gap, because the checkout has a dead
     * end for a user who will not or cannot grant camera and no screen names it.
     */
    key: "Permissions-Policy",
    value: [
      `camera=(${PAYBIS_WIDGET_ALLOWLIST})`,
      `microphone=(${PAYBIS_WIDGET_ALLOWLIST})`,
      "geolocation=()",
      "usb=()",
      `payment=(${PAYBIS_WIDGET_ALLOWLIST})`,
    ].join(", "),
  },
  // PP-SECURITY [R1]: allow-popups (NOT same-origin) so Privy / WalletConnect / OAuth popups work.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // PP-SECURITY: HSTS without `preload` (one-way door; preload submission is owned by Infra).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

// PP-SECURITY [R2]: intentionally NO Cross-Origin-Embedder-Policy. `require-corp` breaks wallet
// SDKs, the Paybis widget and remote token logos, and we do not need SharedArrayBuffer.
// POO-1451 (found in POO-1189) dropped TradingView from this list: it was cited here as a reason
// while nothing in the app ever loaded it, and its CSP allowlist entries are gone. The remaining
// three are real.
