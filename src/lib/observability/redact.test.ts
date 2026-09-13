/**
 * @id PP-CORE-LIB-072 (POO-1147) - tests
 * @implements-rules-version v1
 *
 * `redactAddresses` behaviour is pinned by `logger.test.ts` through the logger's re-export, which is
 * the point of the re-export: the move must be invisible. What is tested here is the ADDITION,
 * `redactSecrets`, and specifically its floor - the line between "long enough to be a key" and "a
 * build hash a human needs to read".
 */
import { describe, expect, it } from "vitest";
import { redactAddresses, redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("masks a 0x address, exactly as the log lines do", () => {
    const masked = redactSecrets("owner 0x1234567890abcdef1234567890abcdef12345678 failed");
    expect(masked).toBe("owner 0x1234…5678 failed");
    expect(masked).not.toContain("7890abcdef");
  });

  it("masks a raw private key that lost its 0x prefix", () => {
    const key = "a".repeat(64);
    const masked = redactSecrets(`key=${key}`);
    expect(masked).not.toContain(key);
    expect(masked).toBe("key=aaaa…aaaa");
  });

  it("masks a bare 40-character address", () => {
    const address = "1234567890abcdef1234567890abcdef12345678";
    expect(redactSecrets(address)).toBe("1234…5678");
  });

  it("leaves a 32-hex trace id readable, because correlating on it is the whole point", () => {
    const traceId = "0123456789abcdef0123456789abcdef";
    expect(redactSecrets(`traceId=${traceId}`)).toContain(traceId);
  });

  /**
   * Two different floors, and both are deliberate. `0x`-prefixed runs keep POO-243's 8-hex floor
   * (which is why a 4-byte selector like `0xa9059cbb` IS masked - it is indistinguishable from a
   * truncated address). BARE hex needs 40 to be worth hiding, because everything shorter is a chunk
   * hash, a trace id or a nonce that a human has to be able to read.
   */
  it("leaves a short 0x value and any bare hex under 40 characters readable", () => {
    expect(redactSecrets("chain 0x89 block 0x1a2b chunk 4f3a2b1c9d8e7f60")).toBe(
      "chain 0x89 block 0x1a2b chunk 4f3a2b1c9d8e7f60",
    );
  });

  /**
   * The `0x` prefix is data, not syntax: the hex digits were always matched case-insensitively while
   * the literal prefix was not, so an UPPERCASED run walked through the mask untouched. Reachable
   * because the API's `toMachineCode(label)` uppercases its entire input before the value ever
   * reaches us.
   */
  it("masks an uppercased 0X prefix exactly like a lowercase one", () => {
    expect(redactSecrets(`owner 0X${"a".repeat(40).toUpperCase()} failed`)).toBe(
      "owner 0xAAAA…AAAA failed",
    );
  });

  it("does not re-mangle an already-masked run", () => {
    expect(redactSecrets(redactAddresses(`0x${"b".repeat(60)}`))).toBe("0xbbbb…bbbb");
  });

  it("masks every occurrence, not just the first", () => {
    const masked = redactSecrets(`0x${"1".repeat(40)} and 0x${"2".repeat(40)}`);
    expect(masked).toBe("0x1111…1111 and 0x2222…2222");
  });
});
