/**
 * @id PP-CORE-LIB-029 (POO-649, POO-735, POO-750, POO-853, POO-901)
 * @name publicUrls
 * @implements-rules-version v2 · v1 (POO-901: manager-profile referral deep link)
 *
 * The single builder for Pool Party PUBLIC share / deep-link URLs (referral invite, manager profile,
 * public strategy page) and for the external Uniswap position deep link (POO-750). Before this, the
 * host `pool-party.xyz` and the path shapes were hardcoded inline in several places, which is how the
 * strategy share link drifted to a non-existent route and how the referral link shipped a generic host
 * instead of the deployed origin.
 *
 * POO-735: the public origin now comes from `NEXT_PUBLIC_APP_URL` (a build-time-inlined public env var,
 * baked per environment from `.env.<env>` by `scripts/push_image.sh`), resolved here so every share URL
 * reflects the deployed origin — `http://localhost:3000`, `https://v2.dev.pool-party.xyz`,
 * `https://app.pool-party.xyz` — from this one module, not scattered literals. Read as a STATIC
 * `process.env.NEXT_PUBLIC_APP_URL` reference so Next inlines it into the client bundle.
 */

/** Prod origin used when `NEXT_PUBLIC_APP_URL` is unset: a valid shareable link, never a dev one. */
const FALLBACK_ORIGIN = "https://app.pool-party.xyz";

/**
 * The app's public origin — scheme + host, no trailing slash — from `NEXT_PUBLIC_APP_URL`
 * ({@link FALLBACK_ORIGIN} when unset). Carries its own scheme so a localhost origin stays `http://`.
 */
export function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const origin = raw && raw.length > 0 ? raw : FALLBACK_ORIGIN;
  return origin.replace(/\/+$/, "");
}

/** The public host, schemeless (for display pills): {@link appOrigin} minus its scheme. */
export function appHost(): string {
  return appOrigin().replace(/^https?:\/\//, "");
}

/**
 * The manager public profile URL (display form, no scheme): `<host>/m/<handle>`. The handle is
 * percent-encoded so a URL-significant char cannot break out of the path (mirrors {@link referralUrl}).
 */
export function managerProfileUrl(handle: string): string {
  return `${appHost()}/m/${encodeURIComponent(handle)}`;
}

/** The public strategy page URL (display form, no scheme): `<host>/strategies/<id>`. */
export function publicStrategyUrl(id: string): string {
  return `${appHost()}/strategies/${id}`;
}

/**
 * The pool-scoped referral deep link (display form, no scheme): `<host>/strategies/<id>?ref=<code>`
 * (POO-853 [R4], the v2 twin of v1's add-liquidity referral link). Deep-links a specific strategy while
 * carrying the referrer's code; attribution stays account-wide (the backend has no per-pool scoping, v1
 * parity), the strategy id only sets the destination. The code is kept AS TYPED and percent-encoded
 * (mirrors {@link referralUrl}); the strategy-detail share offers this when the user has a code and
 * falls back to {@link publicStrategyUrl} when the code is null.
 */
export function strategyReferralUrl(id: string, code: string): string {
  return `${publicStrategyUrl(id)}?ref=${encodeURIComponent(code)}`;
}

/**
 * The manager-profile referral deep link (display form, no scheme): `<host>/m/<handle>?ref=<code>`
 * (POO-901 [R3], mirrors {@link strategyReferralUrl}). Deep-links a manager's public profile while
 * carrying the SHARER's code; attribution stays account-wide (no per-manager scoping), the handle
 * only sets the destination. The code is kept AS TYPED and percent-encoded (mirrors
 * {@link referralUrl}); {@link managerProfileUrl} already percent-encodes the handle. Share
 * surfaces fall back to {@link managerProfileUrl} while the sharer has no code.
 */
export function managerProfileReferralUrl(handle: string, code: string): string {
  return `${managerProfileUrl(handle)}?ref=${encodeURIComponent(code)}`;
}

/**
 * The canonical referral invite URL (display form, no scheme): `<host>?ref=<code>` (POO-717). The single
 * source for the `?ref=` link that POO-718 reads back on load. The code is kept AS TYPED (never
 * lowercased) — it round-trips a case-sensitive backend code — and percent-encoded so a less-constrained
 * code cannot break out of the query. {@link absoluteUrl} adds the scheme for share / clipboard.
 */
export function referralUrl(code: string): string {
  return `${appHost()}?ref=${encodeURIComponent(code)}`;
}

/**
 * Absolutize a display URL (or bare host/path) for the clipboard / share sheet, using the app origin's
 * scheme so a localhost origin stays `http://` (never force `https://`). An already-absolute URL is
 * returned unchanged.
 */
export function absoluteUrl(hostOrUrl: string): string {
  if (/^https?:\/\//.test(hostOrUrl)) return hostOrUrl;
  const scheme = appOrigin().startsWith("http://") ? "http" : "https";
  return `${scheme}://${hostOrUrl}`;
}

/**
 * The Uniswap v3 POSITION deep link for an NFT token id (POO-750):
 * `app.uniswap.org/positions/v3/<network>/<tokenId>`. `network` is the API slug
 * (arbitrum/base/polygon), which matches Uniswap's path segments. Used by the manager "View on
 * Uniswap" link to open the CREATED position — the tokenId changes when the range is moved (a new NFT
 * is minted), so always pass the current id (read fresh from the fetched detail).
 * Both path segments are URL-encoded at this boundary (as {@link referralUrl} encodes its code):
 * identity for the fixed network slug + numeric id, but it hardens this shared helper against any
 * caller passing a less-constrained value that could otherwise break out of the path.
 */
export function uniswapPositionUrl(network: string, tokenId: string): string {
  return `https://app.uniswap.org/positions/v3/${encodeURIComponent(network)}/${encodeURIComponent(tokenId)}`;
}
