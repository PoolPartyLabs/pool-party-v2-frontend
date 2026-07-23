/**
 * @id PP-AUTH (POO-270)
 * @name Server session tests
 * @implements-rules-version v1
 *
 * decodeAccessToken + walletFromToken: address claim, expiry, malformed input.
 */
import { describe, expect, it } from "vitest";
import { decodeAccessToken, walletFromToken } from "./session";

/** Build a fake (unsigned) JWT with the given payload for decode tests. */
function makeToken(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

describe("decodeAccessToken", () => {
  it("decodes the payload of a well-formed token", () => {
    const token = makeToken({ address: "0xABC", exp: future });
    expect(decodeAccessToken(token)).toMatchObject({ address: "0xABC", exp: future });
  });

  it("returns null for a non-JWT string", () => {
    expect(decodeAccessToken("not-a-jwt")).toBeNull();
    expect(decodeAccessToken("a.b")).toBeNull();
  });
});

describe("walletFromToken", () => {
  it("returns the lowercased address for a valid token", () => {
    const token = makeToken({ address: "0xAbCdEf0000000000000000000000000000000001", exp: future });
    expect(walletFromToken(token)).toBe("0xabcdef0000000000000000000000000000000001");
  });

  it("returns null when there is no token", () => {
    expect(walletFromToken(null)).toBeNull();
  });

  it("returns null for an expired token", () => {
    expect(walletFromToken(makeToken({ address: "0xABC", exp: past }))).toBeNull();
  });

  it("returns null when the address claim is missing", () => {
    expect(walletFromToken(makeToken({ exp: future }))).toBeNull();
  });

  it("treats a token without exp as non-expiring", () => {
    expect(walletFromToken(makeToken({ address: "0xABC" }))).toBe("0xabc");
  });
});
