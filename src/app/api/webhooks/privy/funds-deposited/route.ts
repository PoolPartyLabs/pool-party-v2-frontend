/**
 * @id PP-CORE-SEC-005 (POO-1818)
 * @name Privy funds-deposited webhook relay
 * @implements-rules-version v1 (POO-1818 rules v1)
 * @analytics-events none, a server-to-server relay has no browser and pushes nothing to the dataLayer.
 *
 * Privy's `wallet.funds_deposited` delivery enters here and leaves unchanged for
 * `pool-party-api`, which verifies it, dedupes it and stores it.
 *
 * ## Why a relay exists at all
 *
 * `pool-party-api` has NO PUBLIC INGRESS. There is no DNS record for it
 * (`api.dev.pool-party.xyz` and `api.pool-party.xyz` are both NXDOMAIN), nothing
 * listens on 443 on the dev host, and its published port 5001 is closed at the
 * security group. Both frontends reach it over the internal docker network
 * (`http://pp_api:5001`). This origin is the only public HTTPS door the stack
 * has, so it is the only place Privy can post to.
 *
 * That does NOT make this an "unauthenticated write endpoint on the frontend
 * origin" in the sense POO-1818 warns against. Nothing is decided here: no
 * signature check, no parse, no persistence, no business rule. All of it lives
 * in `pool-party-api`, with the database and the signing key. When the API is
 * given its own hostname, this file is deleted and nothing downstream changes.
 *
 * ## Why it must be byte-faithful
 *
 * The signature is an HMAC over the EXACT bytes Privy sent, so this route reads
 * an `ArrayBuffer` and forwards it verbatim. It never calls `request.json()`,
 * never re-serialises, and never touches the encoding. Re-serialising is
 * precisely the bug in Privy's own `verifyWebhook` helper
 * (`@privy-io/server-auth`, `dist/cjs/client.js`, `JSON.stringify(payload)`),
 * and doing it here would break every delivery in a way that looks like a wrong
 * secret.
 *
 * ## Status codes are a retry contract, not decoration
 *
 * Svix retries on any non-2xx and stops on a 2xx. The API's status is COLLAPSED
 * to that decision rather than passed through, because the retry is the only
 * thing Privy can act on:
 *   - the API answered 2xx: return 200. It answers 200 to everything it can make
 *     a decision about, including a body it rejects, because a retry cannot fix
 *     a bad signature.
 *   - the API answered anything else: return 502. Since a decided delivery is
 *     always a 2xx, a non-2xx is by construction a fault rather than a verdict,
 *     and a fault is exactly what a retry may fix.
 *   - the API is unreachable or timed out: return 502. This is the one case
 *     where a retry genuinely helps, and swallowing it would lose the delivery
 *     for good. Losing it is the exact failure this whole issue exists to close.
 *   - the body could not be read off the socket: return 400. Nothing usable
 *     arrived, so a retry is the right outcome and the status names why.
 *
 * PP-INTEGRATION-POINT: Privy webhook delivery (Svix) for `wallet.funds_deposited`,
 * registered on the Funding page of the Privy dashboard against this URL, and add
 * edge/proxy rate limiting in front of it. That second half is the same debt the
 * CSP report endpoint carries: both are unauthenticated public doors, and neither
 * has an app-level limiter that could stand in for one.
 */
import { type NextRequest, NextResponse } from "next/server";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";

/**
 * A relay holds no state and must never be answered from a cache: two identical
 * deliveries are a retry, and a cached 200 would hide the second one from the
 * API that has to dedupe it.
 */
export const dynamic = "force-dynamic";

/**
 * Matches the receiver's own cap (`MAX_BODY_BYTES` in
 * `pool-party-api/src/webhooks/privy-webhook.service.ts`). Enforced here as well
 * so junk never crosses the internal network: a real `wallet.funds_deposited` is
 * a few hundred bytes.
 */
const MAX_BODY_BYTES = 16_384;

/**
 * The headers the signature is computed over, plus the unbranded Standard
 * Webhooks spelling the receiver also accepts. Everything else Privy sends is
 * dropped: an allowlist means a forwarded header set that cannot grow by
 * accident, and nothing here is used for authorisation.
 */
const FORWARDED_HEADERS = [
  "svix-id",
  "svix-timestamp",
  "svix-signature",
  "webhook-id",
  "webhook-timestamp",
  "webhook-signature",
] as const;

/** Beyond this the delivery is treated as undeliverable and Svix is asked to retry. */
const UPSTREAM_TIMEOUT_MS = 10_000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiUrl = process.env.PP_API_URL;
  if (!apiUrl) {
    // A 502 rather than a 200: the delivery is real and a retry after the env is
    // fixed will land. A 200 here would silently drop a paid deposit.
    logError("privy.webhook.relay.unconfigured", { reason: "PP_API_URL is not set" });
    return NextResponse.json({ relayed: false, reason: "unconfigured" }, { status: 502 });
  }

  // Refuse on the DECLARED size before buffering. `await request.arrayBuffer()` reads
  // the whole body into memory first, so the post-read check below only ever fired
  // after we had already paid for the bytes; on the only public door the stack has,
  // that cost is precisely what an unauthenticated flood is trying to impose.
  // `content-length` is attacker-controlled and may be absent or a lie, which is why
  // the post-read check STAYS as the authority: this header is a cheap early refusal,
  // never the guarantee. It closes the honest-declaration case only. A chunked body
  // that declares no length still buffers unbounded, and that residual belongs to the
  // edge body-size limit, not to this route.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    logWarn("privy.webhook.relay.rejected", { bytes: declaredLength, cap: MAX_BODY_BYTES });
    return NextResponse.json({ relayed: false, reason: "size" }, { status: 200 });
  }

  let body: Buffer;
  try {
    body = Buffer.from(await request.arrayBuffer());
  } catch {
    logWarn("privy.webhook.relay.unreadable", {});
    return NextResponse.json({ relayed: false, reason: "unreadable" }, { status: 400 });
  }

  // Zero bytes is NOT the same failure as an oversized body, and it used to share
  // this branch and its 200. Svix never sends an empty body, so a zero length means
  // OUR OWN runtime failed to hand us the bytes, and a 200 makes that unrecoverable.
  // 502 buys the delivery eight more chances at the cost of a little retry noise
  // from scanners, which is a trade worth making on the one path that carries money.
  // (A dashboard probe or a curious operator gets the GET below, not this.)
  if (body.byteLength === 0) {
    logWarn("privy.webhook.relay.empty", {});
    return NextResponse.json({ relayed: false, reason: "empty" }, { status: 502 });
  }

  if (body.byteLength > MAX_BODY_BYTES) {
    // Not forwarded and not retried: a body over the cap is never going to
    // verify, so asking Svix to send it again buys nothing.
    logWarn("privy.webhook.relay.rejected", { bytes: body.byteLength, cap: MAX_BODY_BYTES });
    return NextResponse.json({ relayed: false, reason: "size" }, { status: 200 });
  }

  const headers = new Headers({ "content-type": "application/json" });
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstream = await fetch(`${apiUrl}/api/v1/webhooks/privy/funds-deposited`, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      // Never follow a redirect. For a POST the fetch spec downgrades a 301/302/303
      // to a GET and DROPS the body, and the followed 200 would make this relay answer
      // 200 with the delivery silently lost. Manual leaves the 3xx as `ok === false`,
      // so the mapping below turns it into the retryable 502 it is.
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    // The delivery id is the only correlator worth logging. The body is NEVER
    // logged, here or in the receiver.
    logInfo("privy.webhook.relay.forwarded", {
      status: upstream.status,
      deliveryId: request.headers.get("svix-id") ?? request.headers.get("webhook-id") ?? undefined,
      bytes: body.byteLength,
    });

    // Collapsed to the retry decision, not passed through: 2xx becomes 200 and
    // everything else becomes 502. The API answers 200 to everything it decided
    // on, so a non-2xx is by construction a fault that a retry may fix.
    return NextResponse.json({ relayed: true }, { status: upstream.ok ? 200 : 502 });
  } catch (error) {
    logError("privy.webhook.relay.unreachable", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ relayed: false, reason: "upstream" }, { status: 502 });
  }
}

/**
 * Svix sends a probe when an endpoint is registered in the dashboard, and an
 * operator will inevitably open the URL in a browser. Both should say what this
 * is rather than render a Next 405 page.
 */
export function GET(): NextResponse {
  return NextResponse.json({ endpoint: "privy-funds-deposited-relay", method: "POST" });
}
