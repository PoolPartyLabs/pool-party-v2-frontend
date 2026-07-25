/**
 * @id PP-CORE (SETUP-015 / POO-81)
 * @name buildContentSecurityPolicy
 * @implements-rules-version v2
 *
 * Wallet-aware Content-Security-Policy for Pool Party. Shipped Report-Only first (see
 * `src/middleware.ts`); promote to enforce after reviewing `/api/csp-report`. Source:
 * `docs/10_SECURITY.md` + the `frontend-security` skill.
 *
 * v2 (PP-SECURITY [R6]): App Router emits many inline scripts (the bootstrap + every React Flight
 * `self.__next_f.push(...)` streaming chunk), not just our Consent Mode default. A single hash
 * cannot cover the framework's per-build, per-stream scripts, so the middleware mints a per-request
 * nonce and `script-src` carries `'nonce-...'`; Next.js stamps that nonce onto its own inline
 * scripts. The Consent Mode snippet stays hash-allowlisted as well (belt-and-suspenders, and it is
 * drift-guarded by csp.test.ts). We deliberately do NOT use `'strict-dynamic'` so the GTM and
 * TradingView host allowlists keep working.
 *
 * PP-SECURITY [R3]: `script-src` / `connect-src` / `frame-src` are explicit allowlists. No `*`,
 * no `'unsafe-eval'`. PP-SECURITY [R5]: every new RPC, script, iframe, or onramp is a reviewed
 * edit to the lists below, never silent.
 */
const SELF = "'self'";

const directives: Record<string, string[]> = {
  "default-src": [SELF],
  "base-uri": [SELF],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "form-action": [SELF],
  // Next.js inline scripts (bootstrap + Flight stream) carry the per-request nonce injected below.
  // The Consent Mode default stays hash-allowlisted too. GTM and the TradingView widget load from
  // their allowlisted origins (kept working by NOT using 'strict-dynamic').
  "script-src": [
    SELF,
    // SHA-256 of src/lib/analytics/consentSnippet.ts; drift-guarded by csp.test.ts. Recompute on change.
    "'sha256-jVw1eGdHL8e1Srej/DxWoUXoh/E2Or7t5QPTxhUdseE='",
    // PP-SECURITY: Privy's EMBEDDED wallet compiles a WebAssembly module to sign, and CSP gates that
    // under script-src. Without this the browser reports "Compiling or instantiating a WebAssembly
    // module violates ... 'unsafe-eval' is not an allowed source" and, once the policy is ENFORCED
    // rather than report-only, social-login wallets would stop being able to sign at all.
    //
    // `'wasm-unsafe-eval'` is the narrow grant for exactly this: it permits WebAssembly compilation
    // and NOTHING else. It is not `'unsafe-eval'`, which would re-open `eval()` and `new Function()`
    // for ordinary JavaScript and is the thing this policy exists to forbid.
    "'wasm-unsafe-eval'",
    "https://www.googletagmanager.com",
    "https://*.tradingview.com",
  ],
  // PP-SECURITY: `'unsafe-inline'` styles are a pragmatic allowance (Next/Tailwind inject inline
  // styles; style-based XSS is low risk). Revisit if a nonce-based style flow is adopted.
  "style-src": [SELF, "'unsafe-inline'"],
  "img-src": [SELF, "data:", "blob:", "https:"],
  "font-src": [SELF, "data:"],
  "connect-src": [
    SELF,
    // Privy auth + embedded wallet
    "https://*.privy.io",
    "wss://*.privy.io",
    // WalletConnect relay (both TLDs, both protocols)
    "https://*.walletconnect.com",
    "wss://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.org",
    // Public RPC endpoints for supported chains (Arbitrum, Base, Polygon).
    // The BFF RPC proxy is same-origin ('self'). These cover direct calls from
    // Privy/wagmi and the Polygon fallback (matches pool-party-interface).
    "https://arb1.arbitrum.io",
    "https://mainnet.base.org",
    "https://polygon-bor-rpc.publicnode.com",
    // Third-party services
    "https://api.hyperliquid.xyz",
    "wss://api.hyperliquid.xyz",
    "https://*.polymarket.com",
    "https://*.kalshi.com",
    "https://*.paybis.com",
    "https://api.coingecko.com",
    // Analytics
    "https://*.google-analytics.com",
    "https://*.googletagmanager.com",
    "https://*.analytics.google.com",
  ],
  "frame-src": [
    SELF,
    "https://*.tradingview.com",
    "https://*.paybis.com",
    // Privy login / embedded-wallet iframe (rendered from auth.privy.io).
    "https://auth.privy.io",
    // WalletConnect Verify (domain verification iframes)
    "https://verify.walletconnect.com",
    "https://verify.walletconnect.org",
  ],
};

/**
 * Build the CSP header value.
 *
 * @param nonce - Per-request nonce (from middleware). When present, it is added to `script-src` as
 *   `'nonce-...'` so Next.js's inline scripts are allowlisted. Omit only where no nonce exists.
 * @param reportUri - Where Report-Only violations are collected.
 */
export function buildContentSecurityPolicy(nonce?: string, reportUri = "/api/csp-report"): string {
  const parts = Object.entries(directives).map(([name, sources]) => {
    // [R6] Inject the per-request nonce into script-src (right after 'self') when provided.
    const resolved =
      name === "script-src" && nonce
        ? [sources[0], `'nonce-${nonce}'`, ...sources.slice(1)]
        : sources;
    return `${name} ${resolved.join(" ")}`;
  });
  // report-uri for legacy browsers; report-to (paired with the Reporting-Endpoints header set in
  // middleware) for modern ones.
  parts.push(`report-uri ${reportUri}`);
  parts.push("report-to csp-endpoint");
  return parts.join("; ");
}
