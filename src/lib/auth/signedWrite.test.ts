/**
 * @id PP-AUTH-LIB-001 (POO-637 R4)
 * @name signedWrite tests
 * @implements-rules-version v1
 *
 * The FE signed-write helper MUST reproduce the pool-party-api guard's canonical message
 * byte-for-byte, or `verifyMessage` recovers the wrong address and every write 401s. These
 * fixtures are pinned against the deployed guard (`src/auth/signed-write/canonical-message.ts`,
 * `signed-write.constants.ts` in pool-party-api @ POO-637): the domain tag, the multi-line
 * format, the recursive key-sort canonicalization, and the lowercase-hex sha256 payload hash.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildSignedWriteMessage,
  canonicalJson,
  hashPayload,
  SIGNED_WRITE_DOMAIN,
  SIGNED_WRITE_HEADERS,
  signWrite,
} from "./signedWrite";

/** Independent reference hash (mirrors the backend `createHash('sha256').update(json).digest('hex')`). */
function refHash(json: string): string {
  return createHash("sha256").update(json).digest("hex");
}

describe("canonicalJson", () => {
  // @rule POO-637 R2 (canonicalization: recursive key-sort, arrays keep order)
  it("sorts object keys recursively so key order does not change the bytes", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  // @rule POO-637 R2 (arrays are order-significant)
  it("preserves array order", () => {
    expect(canonicalJson({ xs: [3, 1, 2] })).toBe('{"xs":[3,1,2]}');
  });

  // @rule POO-637 R2 (null/undefined body canonicalizes to {})
  it("treats a null/undefined body as an empty object", () => {
    expect(canonicalJson(undefined)).toBe("{}");
    expect(canonicalJson(null)).toBe("{}");
  });
});

describe("hashPayload", () => {
  // @rule POO-637 R2 (lowercase-hex sha256, no 0x prefix, matches Node crypto)
  it("returns the lowercase sha256 hex of the canonical JSON without a 0x prefix", () => {
    const body = { email: "a@b.com", displayName: "Ana" };
    const hash = hashPayload(body);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(refHash(canonicalJson(body)));
  });

  // @rule POO-637 R2 (empty body hashes to sha256 of "{}")
  it("hashes an empty body to the sha256 of {}", () => {
    expect(hashPayload({})).toBe(refHash("{}"));
  });
});

describe("buildSignedWriteMessage", () => {
  // @rule POO-637 R2 (exact multi-line, domain-separated format the guard reconstructs)
  it("builds the exact multi-line domain-separated message the backend verifies", () => {
    const message = buildSignedWriteMessage({
      action: "profile.update",
      wallet: "0xAbC0000000000000000000000000000000000001",
      payloadHash: "deadbeef",
      nonce: "nonce-123",
      timestamp: 1_700_000_000_000,
    });
    expect(message).toBe(
      [
        "Pool Party Signed Write v1",
        "",
        "Action: profile.update",
        "Wallet: 0xabc0000000000000000000000000000000000001",
        "Payload SHA-256: deadbeef",
        "Nonce: nonce-123",
        "Timestamp: 1700000000000",
      ].join("\n"),
    );
    expect(message.startsWith(SIGNED_WRITE_DOMAIN)).toBe(true);
  });

  // @rule POO-637 R2 (wallet is lowercased in the message for determinism)
  it("lowercases the wallet in the message", () => {
    const message = buildSignedWriteMessage({
      action: "a",
      wallet: "0xDEADBEEF00000000000000000000000000000000",
      payloadHash: "h",
      nonce: "n",
      timestamp: 1,
    });
    expect(message).toContain("Wallet: 0xdeadbeef00000000000000000000000000000000");
  });
});

describe("signWrite", () => {
  const wallet = "0xAbC0000000000000000000000000000000000001";

  // @rule POO-637 R4 (helper signs the canonical message and returns the envelope headers)
  it("signs the canonical message and returns the five envelope headers + body", async () => {
    const signMessage = vi.fn(async () => "0xsig");
    const body = { displayName: "Ana", email: "a@b.com" };
    const { headers, body: sentBody } = await signWrite({
      action: "profile.update",
      wallet,
      network: "polygon",
      body,
      nonce: "nonce-123",
      timestamp: 1_700_000_000_000,
      signMessage,
    });

    // The wallet signs exactly the canonical message (byte-identical to the guard's reconstruction).
    const expectedMessage = buildSignedWriteMessage({
      action: "profile.update",
      wallet,
      payloadHash: hashPayload(body),
      nonce: "nonce-123",
      timestamp: 1_700_000_000_000,
    });
    expect(signMessage).toHaveBeenCalledWith(expectedMessage);

    expect(headers[SIGNED_WRITE_HEADERS.WALLET]).toBe(wallet);
    expect(headers[SIGNED_WRITE_HEADERS.SIGNATURE]).toBe("0xsig");
    expect(headers[SIGNED_WRITE_HEADERS.NONCE]).toBe("nonce-123");
    expect(headers[SIGNED_WRITE_HEADERS.TIMESTAMP]).toBe("1700000000000");
    expect(headers[SIGNED_WRITE_HEADERS.NETWORK]).toBe("polygon");
    // The body is passed through unchanged so its bytes still hash to the signed payloadHash.
    expect(sentBody).toBe(body);
  });

  // @rule POO-637 R2 (network is lowercased to match the guard's SUPPORTED_NETWORKS check)
  it("lowercases the network header", async () => {
    const { headers } = await signWrite({
      action: "profile.update",
      wallet,
      network: "Polygon",
      body: {},
      signMessage: async () => "0xsig",
    });
    expect(headers[SIGNED_WRITE_HEADERS.NETWORK]).toBe("polygon");
  });

  // @rule POO-637 R2 (a fresh single-use nonce + current timestamp are generated when omitted)
  it("generates a fresh nonce and timestamp when not supplied", async () => {
    const before = Date.now();
    const { headers } = await signWrite({
      action: "profile.update",
      wallet,
      network: "polygon",
      body: {},
      signMessage: async () => "0xsig",
    });
    const ts = Number(headers[SIGNED_WRITE_HEADERS.TIMESTAMP]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
    const nonce = headers[SIGNED_WRITE_HEADERS.NONCE] ?? "";
    expect(nonce).toBeTruthy();
    expect(nonce.length).toBeGreaterThanOrEqual(8);
  });
});
