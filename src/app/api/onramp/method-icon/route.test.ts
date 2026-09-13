/**
 * @id PP-CORE-SEC-003 — tests
 * @name on-ramp method-icon proxy route — tests
 * @implements-rules-version v1 (POO-1643 rules v1)
 * @analytics-events none. An image endpoint emits no product events; the reason is on the route.
 *
 * This is a security surface, so the tests are written as the attacks rather than as the happy path
 * with a few negatives appended. Each `it` below is a way this route could become something it is
 * not: an SSRF fetcher, an open redirect follower, a content-type sink, a memory sink, or a cache
 * that serves a poisoned answer for a day.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ICON_BYTES } from "@/lib/onramp/methodIconProxy";
import { GET } from "./route";

const PROD_ICON = "https://cdn.paybis.com/methods/revolut.svg";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

/** A request to the route with a raw, unencoded `src` value, exactly as an attacker would send it. */
function request(src?: string): NextRequest {
  const url = new URL("http://localhost/api/onramp/method-icon");
  if (src !== undefined) url.searchParams.set("src", src);
  return new NextRequest(url, { method: "GET" });
}

/** An upstream answer: body, status and content type, as `fetch` would resolve it. */
function upstream(body: BodyInit, contentType: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/onramp/method-icon — it serves the logo (POO-1643 [R1])", () => {
  /**
   * @rule R1
   *
   * The whole issue in one assertion: the buyer's browser asks US, and OUR server is the one that
   * talks to Paybis. The buyer's IP, and the fact that they opened a payment picker at a KYC'd
   * venue they have not chosen, never leave this origin.
   */
  it("fetches the vendor URL server-side and returns the bytes from our own origin", async () => {
    fetchMock.mockResolvedValue(upstream(SVG, "image/svg+xml"));
    const response = await GET(request(PROD_ICON));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SVG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(PROD_ICON);
  });

  /**
   * @rule R5
   *
   * `redirect: "manual"` is the one option that stops an allow-listed host from becoming a
   * universal fetcher. Without it a `302` from `cdn.paybis.com` to `http://169.254.169.254/...`
   * is followed by our server, from inside our network, and the allow-list has bought nothing.
   */
  it("never follows a redirect, and bounds the request with a signal", async () => {
    fetchMock.mockResolvedValue(upstream(SVG, "image/svg+xml"));
    await GET(request(PROD_ICON));
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  // @rule R5 — a 30x reaches us as a response rather than being followed, and it is not an image.
  it("answers 502 for a redirect instead of chasing it", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } }),
    );
    const response = await GET(request(PROD_ICON));
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
  });

  /**
   * @rule R3
   *
   * The outbound URL is rebuilt from the validated host and path, so a query the attacker appended
   * is not forwarded. A redirect parameter is the specific thing this stops from reaching a CDN
   * that honours one.
   */
  it("strips the query string before it reaches the vendor", async () => {
    fetchMock.mockResolvedValue(upstream(SVG, "image/svg+xml"));
    await GET(request(`${PROD_ICON}?redirect=https://evil.tld&x=1`));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(PROD_ICON);
  });

  // @rule R1 — no cookie, no referrer, no identity of ours travels with the logo request either.
  it("sends no credentials and no referrer upstream", async () => {
    fetchMock.mockResolvedValue(upstream(SVG, "image/svg+xml"));
    await GET(request(PROD_ICON));
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("no-referrer");
  });
});

describe("GET /api/onramp/method-icon — it refuses everything else (POO-1643 [R2])", () => {
  /**
   * @rule R2
   *
   * The route re-validates rather than trusting that the only caller is our own markup. This URL
   * arrives off the open internet: anyone can type it, and the fact that `PaymentMethodList` only
   * ever builds a validated one is not a property of the request that shows up here.
   */
  it.each([
    ["no src at all", undefined],
    ["an empty src", ""],
    ["another origin", "https://evil.tld/x.svg"],
    ["a suffix-appended host", "https://cdn.paybis.com.evil.tld/x.svg"],
    ["a subdomain of the allowed host", "https://a.cdn.paybis.com/x.svg"],
    ["the widget host, which is not the CDN", "https://widget.paybis.com/x.svg"],
    ["plain http", "http://cdn.paybis.com/x.svg"],
    ["a file URL", "file:///etc/passwd"],
    ["the cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
    ["localhost", "http://127.0.0.1:5001/api/v1/pools/all"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:image/svg+xml,<svg onload=alert(1)/>"],
    ["credentials smuggling the allowed host", "https://cdn.paybis.com@evil.tld/x.svg"],
    ["a non-default port on the allowed host", "https://cdn.paybis.com:22/x.svg"],
    ["the CDN root, which is not an icon", "https://cdn.paybis.com/"],
  ])("answers 400 for %s, and issues no outbound request", async (_case, src) => {
    const response = await GET(request(src));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * @rule R9
   *
   * A refusal must never be cached. This route is a plain GET behind whatever CDN fronts the app,
   * so a cacheable 400 or 502 would pin one bad answer in front of every buyer in that POP until it
   * expired, turning a transient vendor blip into a day of missing logos.
   */
  it("never lets a refusal be cached", async () => {
    const refused = await GET(request("https://evil.tld/x.svg"));
    expect(refused.headers.get("cache-control")).toBe("no-store");

    fetchMock.mockResolvedValue(upstream("nope", "text/html"));
    const failed = await GET(request(PROD_ICON));
    expect(failed.status).toBe(502);
    expect(failed.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/onramp/method-icon — the content type is pinned (POO-1643 [R4])", () => {
  /**
   * @rule R4
   *
   * The upstream type decides only WHETHER we serve; it never decides WHAT we say it is. Echoing
   * the vendor's string is how a proxy becomes a content-type sink: a compromised or misconfigured
   * CDN answers `text/html` and our own origin serves attacker markup under our cookies.
   */
  it.each([
    ["text/html", "text/html"],
    ["javascript", "application/javascript"],
    ["json", "application/json"],
    ["a bare octet stream", "application/octet-stream"],
    ["nothing at all", ""],
    ["a type that merely starts like an image", "image/svg+xml-evil"],
  ])("answers 502 for an upstream %s", async (_case, contentType) => {
    fetchMock.mockResolvedValue(upstream("<script>alert(1)</script>", contentType));
    const response = await GET(request(PROD_ICON));
    expect(response.status).toBe(502);
  });

  /**
   * @rule R4
   *
   * The served type is OUR constant for the matched type, so a parameter the vendor appended (a
   * charset, or anything smuggled after a `;`) cannot ride out on our own response header.
   */
  it("serves its own canonical type, never the upstream's string", async () => {
    fetchMock.mockResolvedValue(upstream(SVG, "image/svg+xml; charset=utf-8; x-injected=1"));
    const response = await GET(request(PROD_ICON));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
  });

  // @rule R4 — the accepted set is explicit and small. A logo is one of these or it is not served.
  it.each([
    "image/svg+xml",
    "image/png",
    "image/jpeg",
    "image/webp",
  ])("accepts %s", async (type) => {
    fetchMock.mockResolvedValue(upstream("bytes", type));
    const response = await GET(request(PROD_ICON));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(type);
  });

  /**
   * @rule R4
   *
   * An SVG is a document, not a picture: served from our own origin it can run script in it. Three
   * headers make that impossible and they ship together, because each one alone has a hole.
   * `sandbox` stops the script, `attachment` stops a direct navigation from rendering it at all
   * (and is ignored by `<img>`, which is why the logo still draws), and `nosniff` stops a browser
   * deciding the bytes are something friendlier than what we declared.
   */
  it("serves an image so hardened that a hostile SVG cannot execute", async () => {
    fetchMock.mockResolvedValue(upstream(SVG, "image/svg+xml"));
    const headers = (await GET(request(PROD_ICON))).headers;
    expect(headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-disposition")).toBe("attachment");
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  // @rule R9 — a served logo IS cacheable: the URL is stable per method and the bytes are a logo.
  it("caches a logo it actually served", async () => {
    fetchMock.mockResolvedValue(upstream(SVG, "image/svg+xml"));
    const cacheControl = (await GET(request(PROD_ICON))).headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("public");
    expect(cacheControl).not.toContain("no-store");
  });
});

describe("GET /api/onramp/method-icon — it stays bounded and never throws (POO-1643 [R5])", () => {
  /**
   * @rule R5
   *
   * The cap is enforced on the BYTES READ, not on the `content-length` header, because a header is
   * the attacker's to write and can simply be absent. Without the read-side cap a hostile upstream
   * streams until the container runs out of memory.
   */
  it("refuses a body over the cap even when the header understates it", async () => {
    const oversize = new Uint8Array(MAX_ICON_BYTES + 1);
    fetchMock.mockResolvedValue(
      new Response(oversize, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "10" },
      }),
    );
    const response = await GET(request(PROD_ICON));
    expect(response.status).toBe(502);
  });

  // @rule R5 — the declared length is still an early exit, so an honest giant is never even read.
  it("refuses on a declared length over the cap without reading the body", async () => {
    fetchMock.mockResolvedValue(
      new Response("small", {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(MAX_ICON_BYTES + 1) },
      }),
    );
    expect((await GET(request(PROD_ICON))).status).toBe(502);
  });

  it("serves a body exactly at the cap", async () => {
    fetchMock.mockResolvedValue(upstream(new Uint8Array(MAX_ICON_BYTES), "image/png"));
    expect((await GET(request(PROD_ICON))).status).toBe(200);
  });

  // @rule R5/R6 — the vendor being down is a missing logo, never a 500 on a route in a buy flow.
  it.each([
    ["a network failure", () => fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))],
    ["a timeout", () => fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"))],
    ["an upstream 404", () => fetchMock.mockResolvedValue(upstream("", "image/png", 404))],
    ["an upstream 500", () => fetchMock.mockResolvedValue(upstream("", "image/png", 500))],
  ])("answers 502 for %s rather than throwing", async (_case, arrange) => {
    arrange();
    const response = await GET(request(PROD_ICON));
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  /**
   * @rule R5/R9 — the rejection that arrives AFTER the headers, which is a different code path.
   *
   * Every case above rejects at the `fetch` itself, before any header exists, and that path was
   * always inside a try. `AbortSignal.timeout` also covers the BODY, so a CDN that answers headers
   * fast and then stalls (or a connection reset mid-stream) rejects inside the read loop instead.
   * Unwrapped, that escapes the route: Next answers its generic 500, WITHOUT the `no-store` that
   * makes a transient vendor blip uncacheable, so a POP could pin the failure as the permanent answer
   * for a legitimate icon.
   *
   * Asserting `no-store` here is the point of the test, not decoration: the status alone would pass
   * on a plain 500 in some runtimes.
   */
  /**
   * @rule R4 — the served type comes from a CLOSED map, and an object literal is not closed.
   *
   * `SERVED_IMAGE_TYPES["constructor"]` is the `Object` FUNCTION, which passes an `!== undefined`
   * gate and reaches `new Response` as a Content-Type. Measured on Node 24. Never exploitable, but
   * it falsified the claim this file makes load-bearing, so the gate is `Object.hasOwn` now.
   */
  it.each([
    ["constructor"],
    ["__proto__"],
    ["toString"],
    ["valueOf"],
    ["hasOwnProperty"],
  ])("refuses the prototype member %s as a content type", async (type) => {
    fetchMock.mockResolvedValue(upstream("x", type, 200));
    const response = await GET(request(PROD_ICON));
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  /**
   * @rule PP-SECURITY — an unauthenticated route that makes one outbound request per inbound one.
   *
   * Mirrors `/api/analytics/user-id`. An ABSENT header must still be served: this is an image a page
   * loads, and non-browser callers send none.
   */
  it("refuses a cross-origin caller and still serves one with no sec-fetch-site", async () => {
    const cross = new NextRequest(request(PROD_ICON).url, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    const refused = await GET(cross);
    expect(refused.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(upstream("<svg/>", "image/svg+xml", 200));
    expect((await GET(request(PROD_ICON))).status).toBe(200);
  });

  it("answers 502 when the upstream body fails after the headers landed", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.error(new DOMException("aborted", "TimeoutError"));
          },
        }),
        { status: 200, headers: { "content-type": "image/svg+xml" } },
      ),
    );

    const response = await GET(request(PROD_ICON));
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  /**
   * @rule R5
   *
   * A 502 body is empty on purpose. Reflecting the vendor's error text would put an unreviewed,
   * single-language third-party string on our own origin, and the consumer needs no body: it has
   * already decided to draw the glyph.
   */
  it("puts nothing of the vendor's into a failure body", async () => {
    fetchMock.mockResolvedValue(upstream("Paybis says: request 1234 denied", "text/plain", 403));
    const response = await GET(request(PROD_ICON));
    expect(await response.text()).toBe("");
  });
});
