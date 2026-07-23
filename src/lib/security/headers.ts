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

export const securityHeaders: SecurityHeader[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // PP-SECURITY [R4]: clickjacking, paired with CSP `frame-ancestors 'none'`.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), usb=(), payment=()",
  },
  // PP-SECURITY [R1]: allow-popups (NOT same-origin) so Privy / WalletConnect / OAuth popups work.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // PP-SECURITY: HSTS without `preload` (one-way door; preload submission is owned by Infra).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

// PP-SECURITY [R2]: intentionally NO Cross-Origin-Embedder-Policy. `require-corp` breaks wallet
// SDKs, TradingView, and remote token logos, and we do not need SharedArrayBuffer.
