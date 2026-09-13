/**
 * @id PP-CORE-LIB-084 (POO-1367)
 * @name clientIp tests
 * @implements-rules-version v2
 *
 * [R1] the end user's public IP is resolved from the request headers, [R2] a CloudFront viewer
 * address yields a bare IP with its port stripped in both IPv4 and bracketed-IPv6 form.
 *
 * Every case here is a shape observed in production or documented by AWS, not invented: the whole
 * defect this fixes was an assumption about a header's format that nobody checked against the live
 * edge.
 */

import { describe, expect, it } from "vitest";
import { resolveClientIp } from "./clientIp";

/** The resolved address alone, for the cases that do not assert on the source. */
const ipOf = (getHeader: (name: string) => string | null): string | null =>
  resolveClientIp(getHeader)?.ip ?? null;

/** Build the `(name) => string | null` getter `resolveClientIp` takes, from a plain object. */
const getter =
  (headers: Record<string, string>) =>
  (name: string): string | null =>
    headers[name.toLowerCase()] ?? null;

describe("resolveClientIp [R1]", () => {
  it("returns null when no usable header is present, so the caller can refuse to send", () => {
    expect(ipOf(getter({}))).toBeNull();
  });

  it("prefers cloudfront-viewer-address over x-forwarded-for", () => {
    const ip = ipOf(
      getter({
        "cloudfront-viewer-address": "203.0.113.7:52456",
        "x-forwarded-for": "198.51.100.4",
      }),
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("falls back to x-forwarded-for when CloudFront is absent", () => {
    expect(ipOf(getter({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("falls back to x-real-ip last", () => {
    expect(ipOf(getter({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });
});

describe("cloudfront-viewer-address port stripping [R2]", () => {
  it("strips the port from an IPv4 viewer address", () => {
    expect(ipOf(getter({ "cloudfront-viewer-address": "203.0.113.7:52456" }))).toBe("203.0.113.7");
  });

  it("strips the port from a BRACKETED IPv6 viewer address and drops the brackets", () => {
    // The regression that matters: passing this raw is itself "not a valid IP address" to Paybis.
    const ip = ipOf(getter({ "cloudfront-viewer-address": "[2001:db8::8a2e:370:7334]:52456" }));
    expect(ip).toBe("2001:db8::8a2e:370:7334");
  });

  it("strips only the trailing port from an UNBRACKETED IPv6 viewer address", () => {
    const ip = ipOf(getter({ "cloudfront-viewer-address": "2001:db8::8a2e:370:7334:52456" }));
    expect(ip).toBe("2001:db8::8a2e:370:7334");
  });
});

describe("x-forwarded-for selection", () => {
  it("takes the FIRST entry, which is the originating client, not the proxies after it", () => {
    const ip = ipOf(getter({ "x-forwarded-for": "198.51.100.4, 70.41.3.18, 150.172.238.178" }));
    expect(ip).toBe("198.51.100.4");
  });

  it("tolerates whitespace around entries", () => {
    expect(ipOf(getter({ "x-forwarded-for": "  198.51.100.4  , 70.41.3.18" }))).toBe(
      "198.51.100.4",
    );
  });

  it("unwraps an IPv4-mapped IPv6 address to its bare IPv4 form", () => {
    // `::ffff:198.51.100.4` is how a dual-stack listener reports an IPv4 client. Paybis wants the
    // IPv4.
    expect(ipOf(getter({ "x-forwarded-for": "::ffff:198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("returns a genuine IPv6 client address untouched", () => {
    expect(ipOf(getter({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });
});

describe("rejecting values that are not addresses", () => {
  it("skips an empty or whitespace-only header rather than returning it", () => {
    expect(ipOf(getter({ "x-forwarded-for": "   " }))).toBeNull();
  });

  it("skips a header whose entries are all unusable and moves to the next source", () => {
    const ip = ipOf(getter({ "x-forwarded-for": "unknown", "x-real-ip": "198.51.100.9" }));
    expect(ip).toBe("198.51.100.9");
  });

  it("never returns a private address, which is the container IP that caused the outage", () => {
    // The whole defect: the API fell back to `req.ip`, the Next container's Docker address, and
    // Paybis answered 422 "This value is not a valid IP address" on `userIp`.
    for (const priv of ["172.18.0.5", "10.0.0.4", "192.168.1.10", "127.0.0.1"]) {
      expect(ipOf(getter({ "x-forwarded-for": priv }))).toBeNull();
    }
  });

  it("skips a private first hop and takes the first PUBLIC entry after it", () => {
    const ip = ipOf(getter({ "x-forwarded-for": "10.0.0.4, 198.51.100.4" }));
    expect(ip).toBe("198.51.100.4");
  });

  // The IPv6 private ranges are the least obvious code in the module and a broken regex would ship
  // green without these: `fc00::/7` and `fe80::/10` are easy to write as `/^f[cd]/` or `/^fe8/` and
  // be subtly wrong at the range edges.
  it("never returns an IPv6 loopback, unique-local or link-local address", () => {
    for (const priv of [
      "::1", // loopback
      "fc00::1", // unique-local, bottom of fc00::/7
      "fdff::1", // unique-local, top of the fd half
      "fe80::1", // link-local, bottom of fe80::/10
      "febf::1", // link-local, top of fe80::/10
    ]) {
      expect(ipOf(getter({ "x-forwarded-for": priv }))).toBeNull();
    }
  });

  // The edges just OUTSIDE those ranges are global unicast and must survive.
  it("returns IPv6 addresses just outside the private ranges", () => {
    for (const pub of ["fe00::1", "fec0::1", "2001:db8::1", "2400:cb00::1"]) {
      expect(ipOf(getter({ "x-forwarded-for": pub }))).toBe(pub);
    }
  });

  // A colon alone used to be enough to pass as "IPv6", so any junk containing one reached the
  // outbound header. Bounded (undici rejects control characters) but garbage should not get that far.
  it("rejects colon-bearing junk that is not an IPv6 literal", () => {
    for (const junk of ["foo:bar", "haxxor:9999", "2001:db8 evil", "not:an:ip!"]) {
      expect(ipOf(getter({ "x-forwarded-for": junk }))).toBeNull();
    }
  });
});
