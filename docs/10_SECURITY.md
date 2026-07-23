# 10, Security

Canonical security baseline for Pool Party. Defines the controls, the threat model, and which area owns each one. The operational "how" lives in the per-area security skills (`frontend-security` now; `devops-infra-security`, `backend-security`, `smartcontract-security` later). This document is the source of truth; keep the per-area skills in sync with it.

## Principles

1. **Defense in depth.** Headers, CSP, cookies, DNS, and email auth are additional layers. They do not replace HTTPS, a WAF, audits, or careful code.
2. **Secrets never travel.** Seed phrases and private keys never touch logs, analytics, error reports, or the dataLayer (see `09_ANALYTICS.md`). Hard stop, everywhere.
3. **Least privilege.** Turn off browser APIs you do not use, allowlist origins explicitly, never use a wildcard with credentials.
4. **Roll out gradually.** HSTS `preload`, CSP enforce, and DMARC `p=reject` are one-way doors. Ship in Report-Only / monitor mode first, then tighten.
5. **Wallet-aware.** Pool Party relies on wallet popups (Privy, WalletConnect, OAuth) and RPC calls. No control may break cross-window messaging or RPC connectivity.

## Ownership map

| Area | Owns | Skill / agent |
|------|------|---------------|
| Frontend | HTTP security headers, CSP, clickjacking, cookie flags, client fetch/CORS, SIWE message | `frontend-security` + `security-reviewer` (active) |
| DevOps / Infra | HSTS preload submission, DNSSEC, registrar lock, CAA, email auth (SPF/DKIM/DMARC/BIMI), MTA-STS, WAF, CT monitoring | planned: `devops-infra-security` |
| Backend | Server-side session lifecycle, SIWE nonce issuance + verification, CORS policy, rate limiting | planned: `backend-security` |
| Smart contracts | Reentrancy, access control, oracle/price manipulation, upgrade safety, fund custody | planned: `smartcontract-security` |

## 1. HTTP security headers (Frontend + Infra)

Instructions handed to the browser so it does not make dangerous decisions. A defense-in-depth layer, not a replacement for HTTPS or a WAF.

| Header | Value (target) | Notes for Pool Party |
|--------|----------------|----------------------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (add `; preload` only when stable) | Forces HTTPS, blocks downgrade. Do not enable `includeSubDomains`+`preload` on day one: once cached the browser refuses HTTP even if a cert expires. Ramp up. Preload submission is owned by Infra. |
| `Content-Security-Policy` | start in `Content-Security-Policy-Report-Only`, then enforce | The surgical control over what may execute/load. Biggest defense against XSS and against data exfiltration by a compromised dependency: scope `connect-src` to our domains and RPCs. Needs tuning (inline JS/CSS may break). See `frontend-security` for the Pool Party recipe. |
| `X-Frame-Options` | `DENY` | Anti-clickjacking, paired with `frame-ancestors` (section 2). |
| `Content-Security-Policy: frame-ancestors` | `'none'` | Modern anti-clickjacking; supersedes `X-Frame-Options` where both exist. |
| `X-Content-Type-Options` | `nosniff` | Forces the declared Content-Type, prevents MIME-sniffing (an "image" executed as script). Only valid value is `nosniff`. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Stops leaking full URLs (which may carry sensitive data) to third parties. |
| `Permissions-Policy` | disable unused APIs (`camera=()`, `microphone=()`, `geolocation=()`, `usb=()`, `payment=()`) | Turn off browser APIs we do not use. |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | **Not `same-origin`.** Privy/WalletConnect/OAuth open popups and use `postMessage`; `same-origin` breaks that. `same-origin-allow-popups` isolates the page while keeping popups working. |
| `Cross-Origin-Embedder-Policy` | leave unset (or `credentialless` only if required) | `require-corp` enables `crossOriginIsolated` but breaks cross-origin resources (wallet SDKs, TradingView, token logos). Do not enable unless a feature needs `SharedArrayBuffer`. |
| `Cross-Origin-Resource-Policy` | `same-origin` on our own assets | Origin isolation for resources we serve. |

**Rollout order:** `X-Content-Type-Options` + `X-Frame-Options`/`frame-ancestors` first (safe), then HSTS without preload, then CSP in Report-Only and tune before enforcing.

## 2. Clickjacking (Frontend)

The attack: trick the user into clicking invisible iframes overlaid on legitimate-looking content, causing unintended actions. In DeFi this is severe: the hidden click can be Connect Wallet or, worse, a transaction approval.

Belt-and-suspenders (the two headers complement each other for compatibility):
- `X-Frame-Options: DENY` (use `SAMEORIGIN` only if the app must be embedded in its own iframe).
- CSP `frame-ancestors 'none'` (or `'self'`). When both exist, browsers enforce `frame-ancestors` and ignore `X-Frame-Options`; old browsers fall back to `X-Frame-Options`.
- Avoid the deprecated `ALLOW-FROM`. To allow a specific external origin, use `frame-ancestors`.

## 3. Session hijacking (Frontend + Backend)

Covers cookie/token theft, session fixation, and replay. Two surfaces: an admin/dashboard session (classic) and the user auth (Web3, SIWE with nonce + signature).

- **Cookie attributes.** `HttpOnly` (blocks JS read, neutralizes theft via XSS), `Secure` (HTTPS only), `SameSite=Strict` or `Lax` (mitigates CSRF/cross-site send). Use `Strict` for sensitive sessions. Pool Party note: Privy manages most auth tokens; our own cookies are `pp_consent` (read client-side by the consent banner, so **not** `HttpOnly`) and the next-intl locale cookie.
- **Rotation + expiry.** New session id on login and on every privilege elevation (kills fixation). Short TTL, rotated refresh tokens. (Backend.)
- **Binding + invalidation.** Invalidate server-side on logout; do not rely on cookie expiry alone. Immediate revocation. (Backend.)
- **TLS everywhere.** Sniffing-based hijack needs an unencrypted channel; HSTS (section 1) closes it.
- **`Cache-Control: no-store`** on authenticated pages so session data is not cached.
- **SIWE / nonce.** Single-use, short-lived nonce; check the domain in the EIP-4361 message so a signature phished elsewhere cannot be replayed on the real site. (Nonce issuance/verification is Backend; the message construction is Frontend.) **Frontend status (POO-376):** `src/lib/auth/siweMessage.ts` builds a real EIP-4361 message (domain/uri/chainId/nonce/issuedAt + short `expirationTime`) via viem `createSiweMessage`, gated by `NEXT_PUBLIC_SIWE_EIP4361` (default OFF → legacy branded string until the backend verifies EIP-4361). **Backend (deferred, POO-436):** parse the client `message`, verify `domain` against the server's OWN known domain (not the payload's), check chainId/expiry/notBefore, burn the single-use nonce, and configure RPC for EIP-1271.

The link between XSS and session hijack is direct: XSS + a non-`HttpOnly` cookie equals stolen session. That is why CSP and `HttpOnly` go together.

## 4. Email authentication (DevOps / Infra)

Protects users from phishing that appears to come from us. Published as DNS records.

- **SPF** (TXT): approved senders for the domain. Mind the 10 DNS-lookup limit.
- **DKIM**: public/private key signature verifying sender identity before acceptance.
- **DMARC**: checks SPF/DKIM alignment and tells receivers how to treat failures, plus reports. Roll out `p=none` (monitor) then move to `p=reject` once all legitimate sources are aligned/signed.
- **BIMI**: shows the verified brand logo in the inbox when enforcing DMARC.

Context: since 2024-02-01 Google and Yahoo require bulk senders (5,000+ daily) to implement DMARC at least `p=none`.

## 5. DNS and registrar (DevOps / Infra)

The largest Web3 losses came from DNS hijacking (Curve, Arrakis), so this complements the headers.

- **DNSSEC**: signs DNS answers, hampering spoofing/cache poisoning.
- **Registry lock + hardware-key 2FA** at the registrar: blocks unauthorized nameserver changes (the Curve/Arrakis vector).
- **CAA record**: restricts which CAs may issue certs for the domain.
- **Monitoring** of DNS changes and certificates (CT logs).
- **MTA-STS + TLS-RPT**: forces TLS for email transport and reports failures.

## 6. CORS (Backend + Frontend)

A misconfigured CORS (`Access-Control-Allow-Origin: *` with credentials, or reflecting the origin without validation) lets malicious sites make authenticated requests to our API. Use an explicit origin allowlist, never a wildcard with credentials. (Policy owned by Backend; the Frontend keeps `fetch` credentials scoped.)

## Deployment order (overall)

1. `X-Content-Type-Options: nosniff` + `X-Frame-Options: DENY` + `frame-ancestors 'none'` (immediate, safe).
2. HSTS without `preload`.
3. CSP in Report-Only, tune against real traffic, then enforce.
4. Cookie flags + `Cache-Control: no-store` on authed pages.
5. (Infra) DNSSEC, CAA, registrar lock, SPF/DKIM/DMARC `p=none` then `p=reject`, MTA-STS.
6. HSTS `preload` submission once everything is stable.

## How to add a new external dependency

Adding any third-party script, RPC, iframe, or API means updating the CSP allowlist in `frontend-security`. Default-deny: a new `connect-src`/`script-src`/`frame-src` entry is a reviewed change, not an afterthought. This is the control that limits blast radius if a dependency is compromised.
