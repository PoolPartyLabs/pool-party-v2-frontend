/**
 * @id PP-CORE-SEC-003 — tests
 * @name on-ramp method-icon proxy (allow-list) — tests
 * @implements-rules-version v1 (POO-1643 rules v1)
 * @analytics-events none. A pure allow-list emits nothing; the reason is on the module itself.
 *
 * The allow-list is the whole security boundary of the proxy, so it is tested as a boundary and not
 * as a formatter: every assertion below is a value an attacker would actually send. A hostile value
 * must decode to ABSENCE, which the consumer renders as its neutral glyph, so a refusal costs one
 * logo and can never cost a request.
 */
import { describe, expect, it } from "vitest";
import {
  buildMethodIconProxyUrl,
  METHOD_ICON_PROXY_PATH,
  PAYBIS_ICON_HOSTS,
  resolveMethodIconSource,
} from "./methodIconProxy";

const PROD = "https://cdn.paybis.com/methods/revolut.svg";
const SANDBOX = "https://cdn.sandbox.paybis.com/methods/revolut.svg";

describe("resolveMethodIconSource — the allow-list (POO-1643 [R2])", () => {
  // @rule R2
  it("accepts the two Paybis CDN hosts and nothing else is needed to serve a logo", () => {
    expect(resolveMethodIconSource(PROD)).toBe(PROD);
    expect(resolveMethodIconSource(SANDBOX)).toBe(SANDBOX);
    expect(PAYBIS_ICON_HOSTS).toEqual(["cdn.paybis.com", "cdn.sandbox.paybis.com"]);
  });

  /**
   * @rule R2
   *
   * The three shapes a host allow-list is actually attacked with, and each defeats a different
   * sloppy implementation: a SUFFIX test (`endsWith("paybis.com")`) passes the first two, a
   * SUBSTRING test (`includes("cdn.paybis.com")`) passes the second, and a PREFIX test passes the
   * third. Only exact string equality on `URL.hostname` refuses all three.
   */
  it.each([
    ["a suffix-appended host", "https://cdn.paybis.com.evil.tld/x.svg"],
    [
      "the allowed host as a subdomain label of another",
      "https://cdn.paybis.com.attacker.io/x.svg",
    ],
    ["a prefix-extended host", "https://evilcdn.paybis.com/x.svg"],
    ["a subdomain UNDER the allowed host", "https://a.cdn.paybis.com/x.svg"],
    ["an unrelated paybis host", "https://widget.paybis.com/x.svg"],
    ["a bare host", "https://evil.tld/x.svg"],
  ])("refuses %s", (_case, value) => {
    expect(resolveMethodIconSource(value)).toBeUndefined();
  });

  // @rule R2 — scheme. `javascript:` and `data:` both satisfy `new URL()`, which is exactly why the
  // check is on `protocol` and not on parseability.
  it.each([
    ["plain http", "http://cdn.paybis.com/x.svg"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:image/svg+xml,<svg onload=alert(1)/>"],
    ["file", "file:///etc/passwd"],
    ["protocol-relative", "//cdn.paybis.com/x.svg"],
    ["a bare path", "/x.svg"],
  ])("refuses %s", (_case, value) => {
    expect(resolveMethodIconSource(value)).toBeUndefined();
  });

  // @rule R2 — credentials and ports. `https://cdn.paybis.com@evil.tld/x` parses with hostname
  // `evil.tld` (the allowed host is the USERNAME), so it is already refused by the host check; the
  // explicit credential refusal covers the reverse, where the allowed host is real and the
  // credentials are the payload.
  it.each([
    ["embedded credentials", "https://user:pass@cdn.paybis.com/x.svg"],
    ["the allowed host smuggled as a username", "https://cdn.paybis.com@evil.tld/x.svg"],
    ["a non-default port", "https://cdn.paybis.com:8080/x.svg"],
    ["an internal port on the allowed host", "https://cdn.paybis.com:22/x.svg"],
  ])("refuses %s", (_case, value) => {
    expect(resolveMethodIconSource(value)).toBeUndefined();
  });

  // @rule R2 — a non-string, an empty string and an unparseable string are the same answer: absence.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a number", 42],
    ["an object", { href: PROD }],
    ["unparseable text", "not a url at all"],
  ])("refuses %s", (_case, value) => {
    expect(resolveMethodIconSource(value)).toBeUndefined();
  });

  /**
   * @rule R2
   *
   * A host with no path is not an icon, it is the CDN root, and proxying it would turn this route
   * into a general fetcher for whatever that origin serves at `/`.
   */
  it("refuses an allowed host with no path of its own", () => {
    expect(resolveMethodIconSource("https://cdn.paybis.com")).toBeUndefined();
    expect(resolveMethodIconSource("https://cdn.paybis.com/")).toBeUndefined();
  });

  /**
   * @rule R3
   *
   * The returned value is RECONSTRUCTED from the validated host plus the normalised path, so the
   * query string and the fragment are dropped rather than forwarded. Both are attacker-controlled
   * and neither is needed to fetch a logo: a query rides through to the vendor as a cache key and,
   * on a CDN that redirects on one, as a redirect parameter.
   */
  it("drops the query string and the fragment instead of forwarding them", () => {
    expect(resolveMethodIconSource(`${PROD}?redirect=https://evil.tld`)).toBe(PROD);
    expect(resolveMethodIconSource(`${PROD}#fragment`)).toBe(PROD);
    expect(resolveMethodIconSource(`${PROD}?a=1&b=2#c`)).toBe(PROD);
  });

  /**
   * @rule R3
   *
   * `URL` normalises the path before this ever sees it, so a traversal cannot climb out of the
   * origin (there is nothing above it) and, more usefully, cannot survive into the outbound string
   * as raw `..` for an upstream proxy to re-interpret.
   */
  it("normalises a traversal path rather than forwarding the dots", () => {
    expect(resolveMethodIconSource("https://cdn.paybis.com/a/../../b.svg")).toBe(
      "https://cdn.paybis.com/b.svg",
    );
  });

  /**
   * @rule R2
   *
   * A unicode look-alike host punycodes to something that is not in the list, and a trailing dot is
   * a different string from the allowed one. Both refuse, which is the fail-closed direction.
   */
  it("refuses a unicode look-alike host and a trailing-dot host", () => {
    expect(resolveMethodIconSource("https://cdn.paybís.com/x.svg")).toBeUndefined();
    expect(resolveMethodIconSource("https://cdn.paybis.com./x.svg")).toBeUndefined();
  });
});

describe("buildMethodIconProxyUrl — what the browser is given (POO-1643 [R1])", () => {
  /**
   * @rule R1
   *
   * The load-bearing assertion of the whole issue: what a row renders is a RELATIVE, same-origin
   * path. A relative URL cannot reach another origin, so no browser request can arrive at Paybis
   * because the picker opened.
   */
  it("returns a relative same-origin path, never an absolute URL", () => {
    const url = buildMethodIconProxyUrl(PROD);
    expect(url?.startsWith(`${METHOD_ICON_PROXY_PATH}?`)).toBe(true);
    expect(url).not.toMatch(/^https?:/);
    expect(url).not.toMatch(/^\/\//);
  });

  // @rule R1 — the vendor URL rides as a query parameter, encoded, so it round-trips through the
  // route's own validation unchanged. It is present in the markup and that is not a disclosure:
  // nothing fetches it, and it is a value this app already holds.
  it("carries the canonical vendor URL as an encoded parameter the route can re-validate", () => {
    const url = buildMethodIconProxyUrl(`${PROD}?tracking=1`);
    const parsed = new URL(url ?? "", "https://app.pool-party.xyz");
    expect(parsed.searchParams.get("src")).toBe(PROD);
  });

  // @rule R6 — absence in, absence out. The consumer's neutral glyph is the only other state.
  it("returns nothing for an absent or refused icon, so the consumer falls back", () => {
    expect(buildMethodIconProxyUrl(undefined)).toBeUndefined();
    expect(buildMethodIconProxyUrl("")).toBeUndefined();
    expect(buildMethodIconProxyUrl("https://evil.tld/x.svg")).toBeUndefined();
    expect(buildMethodIconProxyUrl("javascript:alert(1)")).toBeUndefined();
  });
});
