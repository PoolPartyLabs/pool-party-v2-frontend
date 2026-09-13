/**
 * @id PP-CORE-LIB-084 (POO-1367)
 * @name clientIp
 * @implements-rules-version v2
 *
 * The end user's public IP, resolved from the incoming request headers.
 *
 * ## Why this exists
 *
 * Paybis `POST /v3/request` requires the END USER's public IP and rejects anything else with
 * 422 `{"property_path":"userIp","message":"This value is not a valid IP address."}`.
 *
 * `apiFetch` is server-only, so `on-ramp/request-id` is called container-to-container from the Next
 * server, not from the browser. It sends `x-api-key`, `content-type` and the trace headers, and
 * nothing else. `pool-party-api`'s `extractClientIp` therefore found no forwarded-IP header and fell
 * through to `req.ip`, which is the NEXT CONTAINER's Docker address (172.x.x.x). Every prod purchase
 * failed at the final step.
 *
 * The backend already reads `x-forwarded-for` first, so the whole fix is for this side to send it.
 * No API change is required, and any other caller keeps working unchanged.
 *
 * ## Ordering, and why CloudFront comes first
 *
 * Prod sits behind CloudFront, which sets `cloudfront-viewer-address` as `IP:port` (and IPv6 as
 * `[addr]:port`). Forwarding that header RAW is itself an invalid IP: the port has to come off. It is
 * preferred over `x-forwarded-for` because the edge writes it and a client cannot forge it, whereas
 * `x-forwarded-for` is a client-supplied header that the edge only appends to.
 *
 * Takes a header getter rather than calling `next/headers` itself, so the whole policy is unit
 * testable without a request context, and so this module stays free of a server-only import.
 */

/** A dotted-quad. Deliberately not a full range check: {@link isPrivate} handles what matters. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** How a dual-stack listener reports an IPv4 client. The bare IPv4 is what Paybis wants. */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i;

/** `[2001:db8::1]:52456`, the form CloudFront uses for an IPv6 viewer. */
const BRACKETED_WITH_PORT = /^\[([^\]]+)\]:\d+$/;

/**
 * Private, loopback and link-local space. Rejecting these is the point of the module rather than a
 * nicety: the outage was a container address (172.18.x.x) being sent as a real user's IP, and a
 * fabricated `127.0.0.1` fallback would have passed Paybis's format check while still being a lie on
 * a money path. Better to resolve nothing and let the caller refuse to send.
 */
function isPrivate(ip: string): boolean {
  if (/^(127|10)\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  // 172.16.0.0 - 172.31.255.255, NOT the whole 172/8.
  const twoOhSeven = ip.match(/^172\.(\d{1,3})\./);
  if (twoOhSeven && Number(twoOhSeven[1]) >= 16 && Number(twoOhSeven[1]) <= 31) return true;

  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  // Unique-local fc00::/7 and link-local fe80::/10.
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  return false;
}

/**
 * An IPv6 literal: hex groups and colons only, so at minimum a `::` or two separated groups. This is
 * a SHAPE check, not a full RFC 4291 parse (a parse would reject `1:2:3` and buy us nothing Paybis
 * does not already reject). What it does buy is that no arbitrary colon-bearing string reaches an
 * outbound header: `foo:bar`, `2001:db8 evil` and `haxxor:9999` are all rejected here.
 */
const IPV6_SHAPE = /^[0-9a-f:]+$/i;

/** Looks like an address at all. Anything else (`unknown`, an empty entry) is skipped. */
function isAddress(ip: string): boolean {
  if (IPV4.test(ip)) return true;
  return ip.includes(":") && IPV6_SHAPE.test(ip);
}

/** `::ffff:198.51.100.4` becomes `198.51.100.4`; everything else is returned unchanged. */
function unwrapMapped(ip: string): string {
  return ip.match(IPV4_MAPPED)?.[1] ?? ip;
}

/** A usable public address, or null. The single gate every candidate passes through. */
function usable(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const ip = unwrapMapped(raw.trim());
  if (!ip || !isAddress(ip) || isPrivate(ip)) return null;
  return ip;
}

/**
 * Strip the port CloudFront appends. Scoped to that header alone, because the port is ALWAYS present
 * there: applying "drop the last colon segment" to a bare IPv6 elsewhere would corrupt the address
 * (`2001:db8::1` would become `2001:db8:`).
 */
function stripViewerPort(viewerAddress: string): string {
  const bracketed = viewerAddress.match(BRACKETED_WITH_PORT)?.[1];
  if (bracketed) return bracketed;

  const lastColon = viewerAddress.lastIndexOf(":");
  return lastColon === -1 ? viewerAddress : viewerAddress.slice(0, lastColon);
}

/** Which header the address came from. Reported so a deploy can prove the edge is configured. */
export type ClientIpSource = "cloudfront-viewer-address" | "x-forwarded-for" | "x-real-ip";

/** A resolved address and the header it came from. */
export interface ResolvedClientIp {
  ip: string;
  source: ClientIpSource;
}

/**
 * The end user's public IP and the header it came from, or null when none can be established.
 *
 * Null is a real answer, not a failure to try: the caller refuses to send the purchase rather than
 * inventing an address, so the request fails locally with a reason instead of as an opaque upstream
 * 422.
 *
 * `source` exists because the security question this module raises cannot be answered from the code.
 * `cloudfront-viewer-address` is unforgeable ONLY if the CloudFront origin-request-policy actually
 * forwards it; if it does not, resolution degrades silently to the client-supplied
 * `x-forwarded-for`, where a forged leftmost entry would win. Reporting which header won turns that
 * invisible degrade into one grep on the deployed logs. The ADDRESS is never logged (it is personal
 * data); only the source name is.
 *
 * @param getHeader - case-insensitive header lookup, e.g. `(n) => (await headers()).get(n)`.
 */
export function resolveClientIp(
  getHeader: (name: string) => string | null,
): ResolvedClientIp | null {
  const viewer = getHeader("cloudfront-viewer-address");
  if (viewer?.trim()) {
    const ip = usable(stripViewerPort(viewer.trim()));
    if (ip) return { ip, source: "cloudfront-viewer-address" };
  }

  // Leftmost-first: `x-forwarded-for` is ordered client, then each proxy. Skipping private entries
  // walks past an internal first hop instead of reporting the load balancer as the user.
  const forwarded = getHeader("x-forwarded-for");
  if (forwarded) {
    for (const entry of forwarded.split(",")) {
      const ip = usable(entry);
      if (ip) return { ip, source: "x-forwarded-for" };
    }
  }

  const realIp = usable(getHeader("x-real-ip"));
  return realIp ? { ip: realIp, source: "x-real-ip" } : null;
}
