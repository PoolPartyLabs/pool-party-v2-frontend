/**
 * @id PP-CORE (SETUP-015 / POO-81)
 * @name buildContentSecurityPolicy
 * @implements-rules-version v3 (POO-1799 rules v1) · v2
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
 * Paybis host allowlists keep working.
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
  // The Consent Mode default stays hash-allowlisted too. GTM and the Paybis widget load from
  // their allowlisted origins (kept working by NOT using 'strict-dynamic').
  "script-src": [
    SELF,
    // SHA-256 of src/lib/analytics/consentSnippet.ts; drift-guarded by csp.test.ts. Recompute on change.
    "'sha256-jVw1eGdHL8e1Srej/DxWoUXoh/E2Or7t5QPTxhUdseE='",
    // POO-1189: SHA-256 of the `_next-gtm-init` inline script that @next/third-parties'
    // GoogleTagManager writes via dangerouslySetInnerHTML, so Next.js never stamps the request
    // nonce on it. It is not even server-rendered: `next/script` injects it into the DOM after
    // hydration (afterInteractive), and CSP hash-sources match an inline script's text no matter
    // how the element was inserted, which is exactly why a hash works here and a nonce cannot.
    // Without this entry, promoting the header from Report-Only to enforce kills GTM boot (and
    // every event behind it) on all routes. Hashed, NOT nonced via headers() in the layout: that
    // read is a Dynamic API and converts all ~96 SSG pages into per-request SSR (see the POO-1211
    // comment in src/app/[locale]/layout.tsx). The body is constant because the layout passes no
    // dataLayer/dataLayerName props (the container id only rides the external gtm.js URL, already
    // host-allowlisted below). Drift-guarded by csp.test.ts against the installed dist template,
    // so a @next/third-parties bump that changes the init fails the gate, never prod.
    "'sha256-mjAPvJKRBATPwtDkDe1t+tw2mbmVjgXVfYImJfeAdz8='",
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
    // PP-SECURITY (POO-1451, found in POO-1189): `https://*.tradingview.com` was REMOVED from here
    // and from frame-src.
    // It was a dead entry: nothing in src/, public/ or package.json ever loaded TradingView. This
    // file's own header says every entry is a reviewed decision, so a stale one weakens that claim
    // for every entry beside it. Guarded by an inverted assertion in `csp.test.ts`.
    // PP-SECURITY [R5] (POO-1138): the Paybis fiat on-ramp widget loads its client script from
    // widget.paybis.com (prod) / widget.sandbox.paybis.com (sandbox). script-src is an explicit host
    // allowlist and we deliberately do NOT use 'strict-dynamic', so the widget loader (added in
    // POO-1134) is blocked here even when it carries the per-request nonce until this host is listed.
    // The wildcard matches the form already allowlisting the same origin in connect-src and frame-src
    // below, and covers both sandbox and prod so dev and prod need no CSP divergence.
    "https://*.paybis.com",
    // PP-SECURITY [R1] (POO-1799): the Privy on-ramp rail's Stripe loader, PROVEN rather than taken
    // from a vendor guide. `@privy-io/react-auth@3.40.0` declares `@stripe/crypto@>=1.1.1` in
    // `dependencies` (a hard dependency, not a peer and not optional), and that package's
    // `src/shared.ts:11` holds `https://crypto-js.stripe.com/crypto-onramp-outer.js`, which its
    // `injectScript()` loads with `document.createElement('script')` +
    // `headOrBody.appendChild(script)`. A `<script src>` injection is script-src, and this policy
    // deliberately avoids 'strict-dynamic', so the host is blocked at enforcement until it is named
    // here even though the injecting script is itself allowlisted.
    "https://crypto-js.stripe.com",
    // PP-SECURITY [R1] (POO-1799): the SECOND Stripe host the SAME loader reaches. An earlier read
    // of this file called it "Privy Cards, a product this app does not use" and asserted it absent;
    // that was wrong, and three shipped files say so:
    //
    //   * `@privy-io/react-auth@3.40.0`'s `dist/esm/FiatOnrampScreen-CdmfW60V.mjs` does
    //     `await import("@stripe/crypto")` and destructures `loadCryptoOnrampAndInitialize` from it,
    //     so the on-ramp screen itself is what pulls the package in;
    //   * `@stripe/crypto@1.1.3/src/embedded_components.ts:12-13` defines that function against
    //     `https://js.stripe.com/crypto-onramp/v1/crypto-onramp.js`, injected the same way the
    //     sibling host is (`document.createElement('script')` at :34, `appendChild` at :47);
    //   * the same import reaches `@stripe/stripe-js@1.54.2` through `@stripe/crypto/src/index.ts:1`,
    //     and `@stripe/stripe-js/src/index.ts:5` runs `loadScript(null)` at MODULE SCOPE for
    //     `https://js.stripe.com/v3` (`src/shared.ts:15`), i.e. merely evaluating the chunk fetches
    //     the host, with no Cards surface anywhere in the path.
    //
    // Wildcards do not save us here: `https://crypto-js.stripe.com` and `https://js.stripe.com` are
    // different hosts and each must be named. Deliberately `script-src` ONLY: what the loaded script
    // then FRAMES or CALLS is not readable from these files, and a frame-src / connect-src entry
    // written from a vendor guide is exactly the dead-entry class POO-1451 removed. Those come from
    // the POO-1809 harvest, with a violation report behind each one.
    "https://js.stripe.com",
  ],
  // PP-SECURITY: `'unsafe-inline'` styles are a pragmatic allowance (Next/Tailwind inject inline
  // styles; style-based XSS is low risk). Revisit if a nonce-based style flow is adopted.
  "style-src": [SELF, "'unsafe-inline'"],
  /**
   * PP-SECURITY: `https:` here is effectively a wildcard, and it is a KNOWN, deliberate gap rather
   * than an oversight (recorded as F-SEC-06 in `docs/_analysis/07_lib.md`). Tightening it needs an
   * inventory this directive cannot fake: `resolveTokenLogo` serves logos from four host families
   * across ~870 token-list entries (`basescan.org`, `arbiscan.io`, `polygonscan.com`,
   * `coin-images.coingecko.com`, `raw.githubusercontent.com`), manager and profile avatars come from
   * a per-environment media CloudFront domain, and both sets are chosen by the BACKEND at runtime.
   * An allowlist that is one host short does nothing today (the policy is Report-Only) and blanks a
   * token logo beside a balance the day it is enforced. It is its own issue, inventory first.
   *
   * POO-1643 adds NOTHING here, and that is the design rather than an omission. Paybis' method logos
   * are served through our own origin (`/api/onramp/method-icon`, `PP-CORE-SEC-003`), so they are
   * covered by `'self'` and the buyer's browser never resolves a vendor host at all. A future PR
   * that "fixes" a missing logo by naming `cdn.paybis.com` here has undone the whole point of that
   * route, so `csp.test.ts` asserts the absence directly (the POO-1451 / POO-1211 inverted-guard
   * pattern) instead of leaving it to review.
   */
  "img-src": [SELF, "data:", "blob:", "https:"],
  "font-src": [SELF, "data:"],
  "connect-src": [
    SELF,
    // Privy auth + embedded wallet. This wildcard already covers `api.privy.io` and `auth.privy.io`,
    // so POO-1799 adds no literal entry for either: a second line would read as new coverage while
    // adding none.
    "https://*.privy.io",
    "wss://*.privy.io",
    // PP-SECURITY [R1] (POO-1799): Privy's own RPC host, which the EMBEDDED wallet uses for THIS
    // app's chains. `@privy-io/chains@0.3.0` is a direct dependency of the INSTALLED
    // `@privy-io/react-auth@3.29.2` (so this is today's behaviour, not the migration's), and its
    // `dist/esm/ethereum/definitions/base.mjs:1` declares
    // `rpcUrls:{privy:{http:["https://base-mainnet.rpc.privy.systems"]}, default:{http:[...]}}`,
    // with `arbitrum.mjs:1` and `polygon.mjs:1` doing the same for the other two chains we ship.
    //
    // It is not theoretical: `src/lib/tx/sendTransaction.ts:501` records a LIVE incident (POO-1080)
    // where an embedded wallet sent a Base transaction to `polygon-mainnet.rpc.privy.systems` and
    // failed against a POL balance. A request this app has demonstrably made is exactly the standard
    // this policy is meant to describe.
    //
    // The `wss://` twin is deliberately NOT here: the EVM definitions carry `http:` only, and the
    // sole `wss://...rpc.privy.systems` in the SDK is `dist/esm/solana.mjs`'s `rpcSubscriptions:`,
    // a chain family this app does not configure. Guarded by an inverted assertion in `csp.test.ts`.
    "https://*.rpc.privy.systems",
    // WalletConnect relay (both TLDs, both protocols)
    "https://*.walletconnect.com",
    "wss://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.org",
    // Public RPC endpoints for supported chains (Arbitrum, Base, Polygon, Robinhood Chain).
    // The BFF RPC proxy is same-origin ('self'). These cover direct calls from
    // Privy/wagmi and the Polygon fallback (matches pool-party-interface).
    "https://arb1.arbitrum.io",
    "https://mainnet.base.org",
    "https://polygon-bor-rpc.publicnode.com",
    // PP-SECURITY [R3] (POO-1776): Robinhood Chain RPC. Explorer deliberately absent, see `csp.test.ts`.
    "https://rpc.mainnet.chain.robinhood.com",
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
    // PP-SECURITY [R5] (POO-1147): Sentry error/trace ingest. The org lives in the EU data region,
    // so the host is `*.ingest.DE.sentry.io` and NOT the `.us` / bare `sentry.io` default every
    // snippet shows; with the wrong one here the browser blocks every envelope and the project looks
    // simply empty. Scoped to the ingest subdomain rather than `*.sentry.io`, which would also
    // authorise the dashboard and the API.
    "https://*.ingest.de.sentry.io",
  ],
  "frame-src": [
    SELF,
    // POO-1451: the TradingView entry that stood here is gone; see the note in script-src above.
    "https://*.paybis.com",
    // Privy login / embedded-wallet iframe (rendered from auth.privy.io).
    "https://auth.privy.io",
    // WalletConnect Verify (domain verification iframes)
    "https://verify.walletconnect.com",
    "https://verify.walletconnect.org",
    // POO-1211 [R4]: no googletagmanager entry here, on purpose. POO-1156 added one for a GTM
    // <noscript> fallback iframe; that fallback was removed because a no-JS session cannot reach
    // Consent Mode v2 and GA4 has no non-JS variant, so it disclosed IP + UA to Google while
    // measuring nothing. The app now frames no Google origin, and script-src (which the JS loader
    // still needs) is a separate directive. Re-adding here means the noscript came back.
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
