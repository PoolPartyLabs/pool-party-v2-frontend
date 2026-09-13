/**
 * @id PP-CORE-SEC-003 (POO-1643)
 * @name on-ramp method-icon proxy route
 * @implements-rules-version v1 (POO-1643 rules v1)
 * @analytics-events none, deliberately. An image endpoint has no product funnel: it is not viewed,
 *   not started, not completed, and a buyer never intends to reach it. The one signal worth having
 *   (the vendor's CDN is failing) is a server-side observability concern and is logged as such
 *   below, not sent to GA4, where it would arrive once per method per picker open and measure the
 *   CDN rather than the product.
 *
 * The server half of the method-logo proxy: our server fetches the logo from Paybis' CDN so the
 * BUYER's browser never does. The allow-list and the reasoning behind it live in
 * `src/lib/onramp/methodIconProxy.ts`, which this shares with the client so there is one list and
 * not two.
 *
 * ## What this route is for (POO-1643, `CR-TOK-011`)
 *
 * Rendered directly, a `cdn.paybis.com` logo tells a KYC'd payment venue, from the buyer's own IP
 * and with a referrer, that they opened a payment picker they have not chosen anything in. Paybis
 * otherwise learns nothing about a buyer until `request-id` is minted, which is a deliberate act.
 * This route is what keeps that true: the browser asks us, we ask the vendor, and the only IP the
 * vendor sees is the container's.
 *
 * ## PP-SECURITY: the four ways a proxy like this goes wrong, and what stops each
 *
 *   1. **SSRF.** The URL is re-validated here, not trusted from the markup, because it arrives as a
 *      query parameter off the open internet. `resolveMethodIconSource` rebuilds the outbound URL
 *      from a two-literal host allow-list, so the host we fetch is provably one of two constants.
 *   2. **The redirect bypass.** `redirect: "manual"`. An allow-listed host that answers `302
 *      http://169.254.169.254/latest/meta-data/` would otherwise be followed by our server, from
 *      inside the VPC, and the allow-list would have bought nothing. A 3xx is not an image, so it
 *      fails the same way a 404 does.
 *   3. **The content-type sink.** The upstream type decides only WHETHER we serve. What we send is
 *      our own constant from {@link SERVED_IMAGE_TYPES}, so a vendor answering `text/html` (or
 *      smuggling anything after a `;`) cannot make our own origin serve markup. An SVG is a
 *      document rather than a picture, so it additionally ships under `sandbox`, `nosniff` and
 *      `Content-Disposition: attachment` (ignored by `<img>`, which is why the logo still draws, and
 *      decisive for a direct navigation, which is the only way a hostile SVG could ever execute).
 *   4. **The memory and cache sinks.** The body is read against a byte cap rather than trusting
 *      `content-length`, the request carries a timeout, and nothing that failed is ever cacheable.
 *
 * ## Why not `next/image` + `images.remotePatterns`
 *
 * POO-1643 named that mechanism and it cannot serve these logos, measured against the installed
 * Next 15.5.18 rather than assumed:
 *
 *   * `node_modules/next/dist/server/image-optimizer.js:980` refuses an `image/svg+xml` upstream
 *     unless `dangerouslyAllowSVG` is set, and that flag is GLOBAL: it would relax every image the
 *     optimizer serves, for one vendor's logos. The observed icons are `.svg`.
 *   * `image-optimizer.js:208` throws `Module 'sharp' not found` for anything it must transcode.
 *     `sharp` is not in `package.json`, and the Dockerfile installs `--ignore-scripts` under
 *     `output: "standalone"`, so its native binary would not build even if it were added.
 *
 * A route also lets [R3] (drop the query), [R4] (pin the type), [R5] (cap and time-bound) and [R9]
 * (never cache a refusal) be enforced explicitly instead of inherited from a framework default that
 * a future upgrade can change. No wildcard is introduced anywhere, which is the constraint the
 * `remotePatterns` instruction existed to protect.
 *
 * PP-INTEGRATION-POINT: the outbound call to Paybis' asset CDN. This is the app's only direct
 * server-to-Paybis call: every other Paybis interaction goes through pool-party-api (`apiFetch`) or
 * runs in the buyer's browser inside the widget. It carries no credential and no identity, and it
 * must stay that way, or it stops being a logo fetch and becomes a second, unreviewed vendor client.
 */
import { type NextRequest, NextResponse } from "next/server";
import { logWarn } from "@/lib/observability/logger";
import {
  MAX_ICON_BYTES,
  METHOD_ICON_PROXY_PARAM,
  resolveMethodIconSource,
} from "@/lib/onramp/methodIconProxy";

/**
 * The image types we will serve, mapped to the EXACT string we send back.
 *
 * A map and not a `Set`, so the served value is our own literal rather than the upstream's echoed
 * text. That is the difference between "we checked the type" and "we pinned it": an upstream
 * `image/svg+xml; charset=utf-8; x-anything=1` matches the key `image/svg+xml` and goes out as
 * exactly `image/svg+xml`.
 *
 * Four entries, not a family match on `image/`. `image/*` would admit `image/svg+xml-evil` and every
 * future type nobody reviewed, and a payment-method logo is one of these four.
 */
const SERVED_IMAGE_TYPES: Record<string, string> = {
  "image/svg+xml": "image/svg+xml",
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
};

/** How long the vendor gets to answer. A logo that takes longer than this is a missing logo. */
const UPSTREAM_TIMEOUT_MS = 5_000;

/**
 * Served-response caching. Long, because the URL is stable per method and the bytes are a logo; the
 * `s-maxage` is what keeps a CDN in front of the app from asking us (and us asking Paybis) once per
 * buyer. `stale-while-revalidate` means a vendor blip is served from the last good copy instead of
 * flipping every row to the neutral tile at once.
 */
const SERVED_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/**
 * A refusal, in the one shape every failure takes: a status, an empty body, and `no-store`.
 *
 * [R9] The `no-store` is load-bearing rather than tidy. This is a plain GET behind whatever CDN
 * fronts the app, so a cacheable failure would pin one bad answer in front of every buyer in that
 * POP until it expired, turning a five-second vendor blip into a day of missing logos.
 *
 * The body is empty on purpose: the vendor's own error text is unreviewed, single-language,
 * third-party copy, and the consumer needs none of it. It has already decided to draw the tile.
 */
function refuse(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Read a response body against a byte cap, or `undefined` when it exceeds one.
 *
 * Read from the STREAM rather than `arrayBuffer()`, because `arrayBuffer()` allocates whatever
 * arrives before anyone can check its size: a cap applied afterwards has already paid the cost it
 * exists to avoid. The reader is cancelled the moment the cap is passed, so a hostile upstream is
 * disconnected rather than drained.
 */
async function readCapped(response: Response): Promise<ArrayBuffer | undefined> {
  // An honest `content-length` over the cap is an early exit, so a large body is never read at all.
  // It is only ever a hint: absent or understated is the normal hostile case, which the loop below
  // is the real defence against.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) return undefined;

  const reader = response.body?.getReader();
  if (!reader) return undefined;

  const chunks: Uint8Array[] = [];
  let size = 0;
  /**
   * [R5] WRAPPED, because `AbortSignal.timeout` covers the BODY and not just the headers.
   *
   * A CDN that answers headers quickly and then stalls, or a connection reset mid-body, rejects HERE
   * rather than at the `fetch`. Unwrapped that rejection escapes the route entirely: the caller gets
   * Next's generic 500 instead of our 502, and crucially WITHOUT the `no-store` that [R9] calls
   * load-bearing, so a routine vendor blip becomes cacheable and an unhandled server error in the
   * logs. The `fetch`'s own try/catch only ever covered rejection BEFORE headers.
   */
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_ICON_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    // Same answer as the cap: no icon. Cancel so the socket goes back rather than waiting for GC.
    await reader.cancel().catch(() => undefined);
    return undefined;
  }

  const body = new ArrayBuffer(size);
  const view = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Serve one payment-method logo from our own origin.
 *
 * Every failure answers 502 with an empty body: the consumer draws its neutral tile either way
 * (POO-1643 [R6]), so distinguishing "the vendor 404'd" from "the vendor is down" would buy the
 * caller nothing and would leak which of our upstreams is unwell to anyone who asks. The 400 is
 * kept separate because it says something about the REQUEST rather than about the vendor, and it is
 * the one case where no outbound call is made at all.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  /**
   * PP-SECURITY: the same-origin guard this repo already uses on its other unauthenticated routes
   * (`/api/analytics/user-id`, `/api/client-error`).
   *
   * The endpoint is unauthenticated and makes one outbound vendor request per inbound one, which is
   * a mild amplification: a hostile page could otherwise conscript real browsers into it. An ABSENT
   * header falls through deliberately, because non-browser and older-browser callers send none and
   * this is an image a page loads, not an API. Edge rate limiting remains the infra follow-up; this
   * is the three lines that stop the cross-origin case today.
   */
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return refuse(403);

  const upstreamUrl = resolveMethodIconSource(
    request.nextUrl.searchParams.get(METHOD_ICON_PROXY_PARAM),
  );
  // PP-SECURITY: re-validated here rather than trusted. `PaymentMethodList` only ever builds a
  // validated URL, but that is a property of our markup and not of the request that arrives here.
  if (upstreamUrl === undefined) return refuse(400);

  let response: Response;
  try {
    response = await fetch(upstreamUrl, {
      // PP-SECURITY: never follow a redirect. See the header: this is the allow-list bypass.
      redirect: "manual",
      // No cookie of ours, no referrer, and nothing that identifies this app or its users.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { accept: Object.keys(SERVED_IMAGE_TYPES).join(",") },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // A timeout, a DNS failure, a dropped connection. A missing logo, never a 500 in a buy flow.
    logWarn("onramp.method_icon.unreachable", { host: new URL(upstreamUrl).hostname });
    return refuse(502);
  }

  // A 3xx lands here rather than being followed, and it is not an image. So does every 4xx/5xx.
  // Cancel before refusing: an unread body keeps the undici socket allocated until GC, which is the
  // same discipline `readCapped` already applies when it hits the cap.
  if (!response.ok) {
    // Logged, because the header claims a failing vendor CDN is observable and it was not: a CDN
    // answering 403/404 across every method would have been completely silent, indistinguishable
    // from a design with no logos.
    logWarn("onramp.method_icon.upstream_status", { status: response.status });
    await response.body?.cancel().catch(() => undefined);
    return refuse(502);
  }

  // [R4] The upstream type decides WHETHER, never WHAT. Split on ";" so a smuggled parameter cannot
  // ride along, and match the bare type against the closed map.
  const declaredType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  const declaredKey = declaredType.toLowerCase();
  /**
   * [R4] `Object.hasOwn` and not `!== undefined`, because an object literal carries
   * `Object.prototype`. Measured on Node 24: an upstream `Content-Type: constructor` resolves to the
   * `Object` FUNCTION, passes an `!== undefined` gate, and `new Response` then emits
   * `Content-Type: function Object() { [native code] }`; `__proto__` gives `[object Object]`. The
   * camelCase members were saved only by the `.toLowerCase()` above, which is luck, not design. It
   * was never exploitable (nothing on the prototype stringifies to a dangerous type, and nosniff +
   * attachment + sandbox still apply) but it falsified this file's own claim that the served type
   * comes from a closed four-entry map, and `Record<string, string>` lies about the result being one.
   */
  const servedType = Object.hasOwn(SERVED_IMAGE_TYPES, declaredKey)
    ? SERVED_IMAGE_TYPES[declaredKey]
    : undefined;
  if (servedType === undefined) {
    logWarn("onramp.method_icon.unexpected_type", { declaredType: declaredType.slice(0, 64) });
    await response.body?.cancel().catch(() => undefined);
    return refuse(502);
  }

  const body = await readCapped(response);
  if (body === undefined) return refuse(502);

  return new NextResponse(body, {
    status: 200,
    headers: {
      // [R4] Ours, never the upstream's.
      "content-type": servedType,
      "content-length": String(body.byteLength),
      "cache-control": SERVED_CACHE_CONTROL,
      // PP-SECURITY: an SVG is a document. These three ship together and each closes a different
      // hole: `sandbox` denies it a script context, `attachment` stops a direct navigation from
      // rendering it at all (and is ignored for `<img>` subresources, so the row still draws), and
      // `nosniff` stops a browser deciding the bytes are something other than what we declared.
      "content-security-policy": "default-src 'none'; sandbox",
      "content-disposition": "attachment",
      "x-content-type-options": "nosniff",
      // Nobody else's page needs to embed our proxy, and this makes it so.
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer",
    },
  });
}
