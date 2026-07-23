import { describe, expect, it } from "vitest";
import { hashWalletAddress } from "./hashWalletAddress";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const SECRET = "test-secret-not-for-production";

describe("hashWalletAddress", () => {
  it("returns a 64-char lowercase hex HMAC-SHA-256 digest", async () => {
    const hash = await hashWalletAddress(ADDRESS, SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and case-insensitive on the input", async () => {
    const lower = await hashWalletAddress(ADDRESS, SECRET);
    const upper = await hashWalletAddress(ADDRESS.toUpperCase() as `0x${string}`, SECRET);
    expect(lower).toBe(upper);
  });

  // PP-SECURITY: the secret keys the digest, so the same address under a different secret must not
  // be linkable. This is the join protection plain SHA-256 lacked.
  it("produces a different digest under a different secret", async () => {
    const a = await hashWalletAddress(ADDRESS, SECRET);
    const b = await hashWalletAddress(ADDRESS, "a-different-secret");
    expect(a).not.toBe(b);
  });

  it("produces a different digest for a different address", async () => {
    const a = await hashWalletAddress(ADDRESS, SECRET);
    const b = await hashWalletAddress(OTHER_ADDRESS, SECRET);
    expect(a).not.toBe(b);
  });

  // PP-SECURITY [R2]: the output must not contain the raw address.
  it("never echoes the raw address", async () => {
    const hash = await hashWalletAddress(ADDRESS, SECRET);
    expect(hash).not.toContain(ADDRESS.slice(2));
  });

  it("throws when no secret is provided (forces server-side keyed hashing)", async () => {
    await expect(hashWalletAddress(ADDRESS, "")).rejects.toThrow(/secret/i);
  });
});
