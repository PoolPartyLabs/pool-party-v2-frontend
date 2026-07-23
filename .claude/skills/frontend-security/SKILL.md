---
name: frontend-security
description: Frontend security hardening for the Pool Party Next.js wallet app. How to set HTTP security headers and a wallet-aware CSP in Next 15, harden cookies and SIWE/sessions, secure the wallet write flows (clear-vs-blind signing, Permit2/approval phishing, server-built-tx trust), defend the client UX surface (clipboard/address-poisoning), keep the dependency supply chain intact, scope app-owned API routes and the server-only secret boundary, and test it all. Implements the Frontend rows of docs/10_SECURITY.md and maps to OWASP Top 10:2025 / ASVS 5.0.
---

# Frontend Security

Concrete Next 15 implementation of the Frontend-owned controls in `docs/10_SECURITY.md`, plus the wallet-app threats that a generic web checklist misses. Defense in depth: this never replaces HTTPS, the WAF, the backend's own controls, or careful code.

**This app is a wallet dApp.** The highest-value risks are not classic web XSS but the **signing surface** (a user blind-signing a Permit2 permit or a server-built transaction) and the **supply chain** (a compromised dependency in a page that touches a wallet). Weight your review accordingly.

## What the repo already implements (don't regress these)

The implementation is, in several places, ahead of older guidance. Confirmed in code (keep them):

- Static headers in `src/lib/security/headers.ts` (+ `headers.test.ts`); `poweredByHeader: false` in `next.config.ts`.
- CSP **Report-Only** with a per-request nonce in `src/middleware.ts`, composed with next-intl as a single middleware; allowlists + the Consent-Mode inline snippet pinned by SHA-256 hash, drift-guarded by `src/lib/security/csp.test.ts`.
- Reporting via **`report-to` + the `Reporting-Endpoints` header** (modern Reporting API), with `report-uri` kept only as a legacy fallback; hardened `/api/csp-report` collector (8KB cap, shape-validated, never throws, 204).
- SIWE access token in an **HttpOnly** cookie (`pp_access_token`); wallet identity derived server-side from the token (`src/lib/auth/session.ts`), never trusted from the client.
- **Server-only data access** (no BFF proxy; server actions call the backend directly): `PP_API_KEY`/`PP_API_URL` are non-`NEXT_PUBLIC_`, `client.ts` is `import "server-only"`, `x-api-key` injected server-side; `serverActions.allowedOrigins` set to survive CloudFront without disabling Next's origin/CSRF check.
- Analytics secret-scrubbing (`src/lib/analytics/sanitizeParams.ts`) drops seed/mnemonic/secret keys and any raw address/private-key value before the dataLayer; `user_id` is an HMAC of the wallet, attached only after consent.

If a change weakens any of the above, that is a blocking regression.

## Where headers live

- **Static headers** go in `next.config.ts` via `async headers()` (the repo factors them into `src/lib/security/headers.ts`).
- **CSP with a per-request nonce** needs `src/middleware.ts`. The app already runs the next-intl middleware there, so compose them: run next-intl, then attach CSP and pass the nonce via a request header on the returned response. Do not fork into two middlewares.
- Always ship CSP as `Content-Security-Policy-Report-Only` first. Promote to `Content-Security-Policy` only after the report stream is quiet.

## Static headers (next.config.ts)

```ts
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // HSTS: only behind HTTPS; no `preload` until the policy is proven stable.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];
```

`X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'` are intentionally both present (old browsers use the former, modern ones the latter).

**COOP nuance (critical):** use `same-origin-allow-popups`, never `same-origin`. Privy, WalletConnect, and OAuth open popups and rely on `window.opener`/`postMessage`; `same-origin` severs that handshake and breaks wallet connection. Do **not** set `Cross-Origin-Embedder-Policy: require-corp` (it blocks wallet SDK assets, TradingView, Paybis, and remote token logos) unless a feature genuinely needs `SharedArrayBuffer`. (Watch the newer COOP `restrict-properties`/`noopener-allow-popups` values as support grows.)

## CSP recipe (wallet + RPC aware)

Start in Report-Only and default-deny. Scope `connect-src`/`script-src`/`frame-src` to exactly the third parties in use. `connect-src` is the **anti-exfiltration control**: if a dependency is compromised, it is what bounds the blast radius.

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self' 'nonce-<REQUEST_NONCE>' 'strict-dynamic';   // see strict-dynamic note
style-src 'self' 'nonce-<REQUEST_NONCE>';                       // prod; 'unsafe-inline' only in dev
img-src 'self' data: blob: https:;                             // see img-src note
font-src 'self' data:;
connect-src 'self'
  https://*.privy.io wss://*.privy.io
  https://*.walletconnect.com wss://*.walletconnect.org
  https://arb1.arbitrum.io https://mainnet.base.org https://polygon-bor-rpc.publicnode.com
  https://api.hyperliquid.xyz wss://api.hyperliquid.xyz
  https://*.polymarket.com https://*.kalshi.com
  https://*.paybis.com https://api.coingecko.com
  https://*.google-analytics.com https://*.googletagmanager.com https://*.analytics.google.com;
frame-src 'self' https://auth.privy.io https://*.tradingview.com https://*.paybis.com;
report-to csp-endpoint;            // modern Reporting API (+ Reporting-Endpoints header)
report-uri /api/csp-report;        // legacy fallback only
```

- **`strict-dynamic`: the repo deliberately does NOT use it** (`src/lib/security/csp.ts`). It keeps explicit `script-src` host allowlists so GTM/gtag and TradingView load; `strict-dynamic` would make modern browsers **ignore** those host allowlists and break them. The chosen tradeoff is therefore to keep the host-allowlist in lockstep with reality. `strict-dynamic` is a valid Next 15/16 pattern in the abstract, but switching to it here is a breaking change, not a "fix". Add `'unsafe-eval'` **only in development**; never `'unsafe-inline'`/`'unsafe-eval'` in prod `script-src`.
- **`connect-src` must enumerate every RPC + `wss://`.** The real surface is **3 chains (Arbitrum / Base / Polygon)** plus Privy, WalletConnect relay, the onramp, charts, and GA4. **Derive these from the single chain source** (`src/lib/chains/config.ts` exports `rpcOrigins`) so adding a chain can't silently leave `connect-src` behind; today `csp.ts` duplicates the origins as literals, which is a drift risk. `strict-dynamic` does NOT relax `connect-src`, so it stays your tightest lever. Every new RPC/onramp/pixel is a reviewed CSP edit, never silent.
- **Styles:** the repo currently ships `style-src 'unsafe-inline'` (`csp.ts`), a deliberate, accepted tradeoff for now. Moving to `style-src 'self' 'nonce-<n>'` in prod is a possible future hardening (Next auto-nonces its inline styles), but re-test before switching and do not flip it casually; CSS injection that reads attribute values is a real, if lower, risk.
- **`img-src https:`** allows any HTTPS host. This is a deliberate, temporary loosening; tighten to an explicit allowlist once the remote image hosts (token logos, avatars) are known, to shrink the tracking/exfiltration surface before enforcing.
- **Reporting:** `report-uri` is deprecated. Ship `report-to` + a matching `Reporting-Endpoints` header (the repo does); keep `report-uri` only for old browsers.
- **Cost tradeoff:** a nonce CSP forces **dynamic rendering** (static optimization, ISR, and PPR are disabled, no CDN HTML caching). Scope the nonce middleware with a route matcher that excludes `/api`, `/_next/static`, `/_next/image`, favicon, and prefetches. The static-friendly alternative is the experimental **hash-based SRI CSP** (`experimental.sri.algorithm`), which keeps strict `script-src` without nonces or dynamic rendering; consider it for purely-static surfaces and reserve nonce CSP for wallet/authenticated routes.

## Cookies + sessions

```ts
res.cookies.set(name, value, {
  httpOnly: true,          // any cookie holding a token/identity
  secure: true,            // ALWAYS true, not gated on NODE_ENV (preview/staging are https too)
  sameSite: "lax",         // "strict" for the most sensitive
  path: "/",
});
```

- The SIWE session cookie must be **`Secure` unconditionally** (reuse the `setSecureCookie` helper rather than `secure: NODE_ENV === "production"`, which leaks on an https origin running with a non-prod env).
- Prefer an **encrypted, signed** session cookie (iron-session or equivalent, `>= 32`-char secret) with a **finite TTL** (no indefinite sessions) bound to the verified address.
- `pp_consent` is read by the client banner, so it is **not** `HttpOnly` (still `Secure` + `SameSite=Lax`). The next-intl locale cookie is framework-managed.
- Add `Cache-Control: no-store` on authenticated routes/responses so session data is not cached.

## SIWE / Sign-In with Ethereum (EIP-4361)

The signed message is the auth anti-replay control, so it must be a real EIP-4361 message, not a branded string.

- **Construct the message with the real `domain` + `uri` + `chainId` + a server nonce + `issuedAt` + a short `expirationTime` (5-15 min).** A message that omits the domain has no binding, so a signature phished on a look-alike site can be replayed against the real app; replay defense then rests entirely on the backend nonce. (If `buildSiweMessage` emits a plain branded string, that is a real gap to fix in coordination with the backend, which must reconstruct the message verbatim.)
- **Verify server-side:** pass the app's own known `domain` to `verify()` (do not trust the value in the payload), check `chainId`/`expirationTime`/`notBefore`, and **burn the single-use nonce** on success.
- Configure RPC for **EIP-1271** so smart-contract wallets (Privy embedded, Safe) verify correctly.
- The frontend requests a **fresh nonce per attempt** and never reuses one; nonce issuance/verify + rate-limiting are Backend controls.
- Session identity decoded from an **unverified** token (e.g. reading the address claim without checking the JWT signature) must never gate a security decision the frontend owns; only forward the token and display the address.

## Wallet write flows: signing + token approvals

This is the core risk of a wallet app and the area a generic checklist ignores. Pool Party signs ERC-20 `approve`, Permit2 EIP-712 permits, and raw EIP-1193 sends.

- **Clear signing over blind signing (WYSIWYS).** Before the wallet prompt, show the decoded intent in your own UI: contract/**spender**, function, asset, **exact amount**, recipient, and **chain**. Blind signing (approving a hash or an opaque blob) is the failure class behind major drains. Prefer EIP-712 structured payloads over opaque bytes, and back the confirm step with a **transaction simulation / state-change preview** where possible.
- **Token approvals: never default to unlimited.** `approve(spender, uint256.max)` and Permit2 max allowances are the standard drainer payload. Default the approve/permit amount to exactly what the action needs; treat "unlimited" as an explicit, warned opt-in; surface spender + amount in clear text; offer allowance hygiene (view/revoke). Prefer short Permit2 expirations over standing allowances.
- **Permit2 / gasless signatures move phishing off-chain.** A single EIP-712 Permit2 signature (no on-chain tx, no gas prompt) can authorize transfers, so a phished signature is as dangerous as an on-chain `approve`. Render the **full decoded permit** (token, spender, amount, expiration, nonce) before signing, set tight `sigDeadline` + allowance expiration windows, and bind the signing UI to the connected chain/domain so a cross-app replay is visible. Treat the Permit2 spender as a **trust anchor**: it is derived per chain from `@uniswap/permit2-sdk`; pin/verify the address rather than trusting an arbitrary one.

## Server-built transactions (server-action trust boundary)

In FU-001 a server action builds the calldata and the client signs + `eth_sendTransaction`s it (`buildAddLiquidityTxAction` etc. -> `executeBuiltTransaction`). The wallet signs **whatever the server action returns**, so the build response is a trust boundary.

- **Validate the built-tx shape strictly before signing**: `to`/`from` are 0x-addresses, `data` is `0x`-hex, `value` is wei within bounds. This is **done** (`builtTxSchema`, POO-352): the server action passes `schema: builtTxSchema` to `apiFetch`, which `safeParse`s the build response before it reaches the client. Keep it strict; do not loosen it back to "fields are strings".
- **Do not blind-send.** Pair the strict validation with the clear-signing/simulation step above so the user (and the code) sees the real effect before broadcast.
- Keep the build action **server-side**, with the wallet derived from the **session** (the HttpOnly SIWE cookie), not a client-supplied address, and the api key injected server-only. This is the reference pattern for any wallet-write flow.

## Client UX threats: clipboard hijacking + address poisoning

The current threat is not only the server; it is the address the user sees and copies.

- **Show the full, checksummed destination address** (with an identicon/blockie) at confirmation and again in the final signing step, never a truncated `0xAB...9F`. Truncated-address UI actively enables **address poisoning** (look-alike same-prefix/suffix addresses seeded into history).
- **Warn on a paste target never transacted with**, and prefer scanning/selecting from a verified contact list over manual paste (clipboard-clipper malware swaps a copied address at paste time).

## Supply-chain / dependency integrity (OWASP A03:2025)

A compromised dependency in any page that touches a wallet is a direct path to a drain. The skill previously covered none of this; it is now a top-3 risk.

- **Commit `pnpm-lock.yaml`; install with `pnpm install --frozen-lockfile`** (CI + Docker build). It installs exactly the lockfile and fails on drift instead of silently resolving a new (possibly malicious) version.
- **Add an install cooldown** (`minimumReleaseAge` via Renovate/Dependabot, or an npmrc `min-release-age`) so a freshly-compromised release is rejected pending detection; prefer exact/`~` pins over `^` for sensitive deps.
- **Gate install scripts:** flag newly added deps with `hasInstallScript: true`; use `--ignore-scripts` for installs that do not need lifecycle hooks. Use `overrides` to force a transitive dep onto a safe version during an active incident.
- **Verify provenance + scan in CI:** `pnpm audit` (signatures/provenance) and an SCA / known-malicious-package check that **fails the build** on a flagged version.
- **SRI** (`integrity` + `crossorigin`) on any third-party script you load directly (not via a tag manager); the experimental hash-based CSP can emit integrity for first-party JS.

## App-owned API routes

The app exposes public POST endpoints (`/api/analytics/user-id`, `/api/csp-report`) that any origin can call.

- The **`user-id` endpoint is an unauthenticated hash oracle**: any caller can POST an address and get its HMAC pseudonym, enabling offline correlation/enumeration. Add a **same-origin `Origin`/`Referer` check** and **rate limiting** (or derive the hash server-side at track time instead of exposing the oracle).
- `csp-report` is already hardened (size cap, shape-validated, never throws); keep it that way and rate-limit if it gets noisy.

## Secrets boundary (A02 / A04:2025)

- The server-side api key and any wallet secrets **never cross to the client**: never `NEXT_PUBLIC_`, never echoed into the dataLayer, logs, or error reports. Add a guard/test that **fails if a non-public secret name appears in the client bundle**.
- Privy custodies seed phrases / private keys; the app must never touch them. Keep the defense-in-depth scrub of addresses/signatures/seeds before analytics.

## Standards mapping

Target **OWASP ASVS 5.0 L1** on the client-owned controls, and track the rest explicitly rather than treating deferred server-side work as done.

- **ASVS V14 Browser Security** (CSP, headers, COOP/COEP/CORP, clickjacking, CORS, cookies), **V3 Web Frontend** (DOM-XSS / output encoding), **V7 Session Management**, **V8 Authentication**.
- **OWASP Top 10:2025** most relevant here: **A02 Security Misconfiguration** (headers/CSP/secrets), **A03 Software Supply Chain Failures** (NEW), **A04 Cryptographic Failures** (secret + session handling), **A08 Software/Data Integrity Failures** (SRI / build provenance).
- Server-side controls (nonce issuance + rate-limit, the API origin allowlist, session store) are **Backend** items; list them as deferred, do not mark them done.

## Testing

- **Header presence on a REAL response:** a middleware/route integration test (or a CI curl against the built app) asserting `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, COOP, and the **CSP + `Reporting-Endpoints`** headers actually appear on `/`. Unit-testing the header arrays + the CSP-string builder is necessary but not sufficient (a middleware composition regression would ship silently).
- **CSP:** keep Report-Only with the `/api/csp-report` collector; review violations before enforcing.
- **Secret-leak guard:** a test that fails if a non-public secret name appears in the client bundle.
- **Negative CORS:** assert no response sets `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`, and no unvalidated origin reflection.
- **Cookies:** assert token/session cookies carry `HttpOnly; Secure; SameSite`.
- **Built-tx:** assert `builtTxSchema` rejects a non-`0x` `to`/`data` and an out-of-bounds `value`.

## Anti-patterns

- `Cross-Origin-Opener-Policy: same-origin` on a wallet app (breaks popups); `COEP: require-corp` without a `SharedArrayBuffer` need.
- `connect-src *`, or `script-src 'unsafe-inline'`/`'unsafe-eval'` in prod; a hand-maintained `connect-src` that drifts from the chain config single-source.
- Permanent `style-src 'unsafe-inline'` when nonce styles work in prod; `report-uri` only (no `report-to`).
- A SIWE message with no domain binding; verifying against the domain in the payload instead of the server's known domain; an indefinite session; a session cookie `Secure`-gated on `NODE_ENV`.
- **Blind-signing**: prompting a wallet signature without showing the decoded intent (spender, amount, chain) in-app first.
- **Default unlimited approvals** / max Permit2 allowances; treating a Permit2 EIP-712 signature as lower-risk than an on-chain `approve`.
- **Signing server-built calldata** without strict shape/bounds validation.
- **Truncated-address** confirmation UI (enables address poisoning).
- Uncommitted/loose lockfile, `^` ranges on sensitive deps, install scripts unchecked, no provenance/SCA gate (A03:2025).
- An unauthenticated app API route (hash oracle) with no `Origin` check / rate limit.
- A non-public secret reachable from the client bundle, or any raw address/signature/seed in the dataLayer, logs, or error reports.
- Adding a third-party script/RPC/onramp without the corresponding CSP edit.
