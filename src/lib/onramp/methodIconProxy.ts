/**
 * @id PP-CORE-SEC-003 (POO-1643)
 * @name on-ramp method-icon proxy allow-list
 * @implements-rules-version v1 (POO-1643 rules v1)
 * @analytics-events none, deliberately. This is a pure allow-list with no user-visible surface of
 *   its own: it decides a URL and returns. The picker that consumes it (`PP-DEP-CMP-005`) fires no
 *   analytics either by its own design (POO-1612), and a per-row image outcome is not a product
 *   event: instrumenting one would emit once per method per open, and the useful signal (the vendor's
 *   CDN is failing) belongs in the route's server-side observability, not in GA4.
 *
 * The client half of the method-logo proxy, and the ONLY place the vendor's hosts are named. Pure
 * (no I/O, no React, no `server-only`), so the same function runs in the browser to build the `src`
 * and in the route handler to re-validate what arrives. One allow-list, applied twice, is the point:
 * a second copy on the server would be a second thing to keep in step.
 *
 * ## Why this exists (POO-1643, and `CR-TOK-011` before it)
 *
 * POO-1603 stopped `OnRampPaymentMethod.icon` being discarded on arrival, so a picker row CAN render
 * each method's real logo. Those URLs are `cdn.paybis.com` / `cdn.sandbox.paybis.com`. Rendered
 * directly, the browser fetches them the moment the picker OPENS: one request per method, from the
 * buyer's own IP, carrying a referrer, to a KYC'd payment venue the buyer has not chosen and may
 * never open. Today Paybis learns nothing about a buyer until `request-id` is minted, which is a
 * deliberate act; a logo would move first contact to a screen the buyer is only looking at, and an IP
 * is personal data in the EU. So the fetch moves to our server and the browser only ever sees a
 * RELATIVE path to our own origin.
 *
 * ## PP-SECURITY: what makes this an allow-list rather than a fetcher
 *
 * A proxy that takes a URL and fetches it is an SSRF primitive: our server sits inside the VPC, and
 * `http://169.254.169.254/latest/meta-data/` answers instance credentials to anything that asks from
 * there. Five properties keep this from being that, and each refuses a different real attack:
 *
 *   1. **The scheme is `https:` exactly.** `new URL()` happily parses `javascript:`, `data:` and
 *      `file:`, so parseability proves nothing. (This is the same trap `wireIconSchema` in
 *      `schemas.ts` documents: zod's `.url()` delegates to `new URL()` and accepts `javascript:`.)
 *   2. **The hostname matches by exact string equality** against {@link PAYBIS_ICON_HOSTS}. Never
 *      `endsWith`, which admits `cdn.paybis.com.evil.tld`; never `includes`, which admits anything
 *      containing the string; never a leading-wildcard match, which admits `a.cdn.paybis.com`.
 *   3. **Credentials and an explicit port are refused.** `https://cdn.paybis.com@evil.tld/x` parses
 *      with hostname `evil.tld` and is already refused by (2); refusing credentials outright also
 *      covers the reverse shape. A port turns an allowed HOST into an arbitrary internal SERVICE.
 *   4. **The outbound URL is RECONSTRUCTED, never passed through.** What we return is
 *      `"https://" + <one of two module constants> + <a URL-normalised pathname>`. The host in the
 *      string our server fetches is therefore provably one of two literals, whatever the input was.
 *      The query and the fragment are dropped: a logo needs neither, and a forwarded query is a
 *      redirect parameter on any CDN that honours one.
 *   5. **A path is required.** An allowed host with no path is the CDN ROOT, not an icon, and
 *      proxying it would serve whatever that origin puts at `/`.
 *
 * What this does NOT do, stated so it is not mistaken for something it is: it does not authenticate
 * the caller. Anyone can request this route. The blast radius is bounded by construction rather than
 * by a secret: the only reachable origin is one of two vendor CDNs, on a path, with no query, and the
 * route caps the size and the time. An HMAC over the path was considered and left out on that basis
 * (it would add an env secret and a deploy coupling to protect against unmetered fetching of public
 * logos); if abuse is ever observed, this comment is the decision to revisit.
 *
 * PP-INTEGRATION-POINT: `cdn.paybis.com` / `cdn.sandbox.paybis.com` are Paybis' asset CDNs, reached
 * only from the server route below. Which one a given deployment sees is decided by pool-party-api's
 * Paybis environment, not by anything here, which is why BOTH are listed rather than switched on an
 * env var: the two are the sandbox and production faces of one vendor, and a wrong switch would show
 * a buyer no logos at all.
 */

/**
 * The exact hosts a method logo may come from. Two literals, matched by equality.
 *
 * Deliberately NOT `*.paybis.com`. A wildcard outlives the decision that justified it: it would also
 * admit `widget.paybis.com` (the checkout, not an asset host) and every future subdomain nobody
 * reviewed. `csp.ts` uses the wildcard form for `script-src`/`frame-src`/`connect-src` because those
 * genuinely span two widget subdomains across environments; an image proxy spans exactly these two.
 */
export const PAYBIS_ICON_HOSTS = ["cdn.paybis.com", "cdn.sandbox.paybis.com"] as const;

/** The same-origin route that serves the bytes. Relative on purpose: see {@link buildMethodIconProxyUrl}. */
export const METHOD_ICON_PROXY_PATH = "/api/onramp/method-icon";

/** The query parameter carrying the (re-validated) vendor URL. */
export const METHOD_ICON_PROXY_PARAM = "src";

/**
 * Validate a vendor icon value and return the canonical upstream URL to fetch, or `undefined`.
 *
 * `undefined` is the ONLY failure mode: there is no throw and no partial result, because every caller
 * treats a refusal and an absent icon identically (POO-1643 [R6], the neutral tile). A hostile value
 * therefore costs one logo and can never cost a request, a row, or the list.
 *
 * @param value - Whatever arrived: `OnRampPaymentMethod.icon`, or a raw query parameter off the open
 *   internet. Typed `unknown` on purpose, so a caller cannot satisfy the signature by asserting.
 * @returns `https://<allowed host><path>`, with no query, fragment, credentials or port. Or nothing.
 */
export function resolveMethodIconSource(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not absolute, or not a URL at all. A protocol-relative "//host/x" lands here too: it needs a
    // base to resolve, and giving it one is exactly how a host allow-list gets bypassed.
    return undefined;
  }

  // PP-SECURITY: parseability is not a scheme check. `javascript:`, `data:` and `file:` all parse.
  if (url.protocol !== "https:") return undefined;
  // PP-SECURITY: credentials, and an explicit port that would reach a different service on the host.
  if (url.username !== "" || url.password !== "" || url.port !== "") return undefined;
  // PP-SECURITY: exact equality against the closed set. Not endsWith, not includes, not a wildcard.
  if (!(PAYBIS_ICON_HOSTS as readonly string[]).includes(url.hostname)) return undefined;
  // An allowed host with no path of its own is the CDN root, not an icon.
  if (url.pathname === "" || url.pathname === "/") return undefined;

  // PP-SECURITY: rebuilt from the validated pieces. `url.hostname` is one of the two literals above,
  // and `url.pathname` is URL-normalised (traversal already collapsed, control characters already
  // percent-encoded). Concatenated, never resolved through `new URL(path, base)`, which would let a
  // "//evil.tld/x" path replace the base's host.
  return `https://${url.hostname}${url.pathname}`;
}

/**
 * Build the same-origin `src` a picker row renders, or `undefined` when the icon cannot be vouched
 * for (the consumer draws its neutral tile).
 *
 * The returned value is RELATIVE, and that is the property the whole issue turns on: a relative URL
 * resolves against our own origin and is structurally incapable of reaching another one. The vendor
 * URL does appear in the markup as an encoded parameter, which is not a disclosure: nothing fetches
 * it, and it is a string this app already holds.
 */
export function buildMethodIconProxyUrl(value: unknown): string | undefined {
  const source = resolveMethodIconSource(value);
  if (source === undefined) return undefined;
  return `${METHOD_ICON_PROXY_PATH}?${METHOD_ICON_PROXY_PARAM}=${encodeURIComponent(source)}`;
}

/**
 * The byte cap on a logo. 256 KiB is roughly two orders of magnitude above a real payment-method
 * mark (the observed ones are single-digit KiB SVGs) and far below anything that threatens a
 * container, so it refuses a hostile stream without ever refusing a real logo.
 *
 * It lives HERE rather than in the route because a Next route module may only export the fields Next
 * defines (`GET`, `runtime`, `dynamic`, ...). Exporting anything else fails `next build` with
 * "is not a valid Route export field" - and nothing else catches it: typecheck and the whole test
 * suite pass, because the constraint is Next's route contract rather than TypeScript's. The route and
 * its test both import it from here, so the test still asserts the real bound and not a copy.
 */
export const MAX_ICON_BYTES = 256 * 1024;
