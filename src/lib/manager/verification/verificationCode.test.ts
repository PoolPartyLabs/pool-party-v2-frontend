/**
 * Tests for the mock verification-code generator (POO-745). The real code is minted server-side by
 * POO-744; this generator only backs mock mode. It must match the API's format: 8-char uppercase
 * Crockford base32 (no ambiguous I/L/O/U), so a mock-mode code looks/behaves like a real one.
 */
import { describe, expect, it } from "vitest";
import { CROCKFORD_ALPHABET, generateVerificationCode } from "./verificationCode";

describe("generateVerificationCode", () => {
  it("is 8 characters long", () => {
    expect(generateVerificationCode()).toHaveLength(8);
  });

  it("uses only uppercase Crockford base32 characters (no ambiguous I/L/O/U)", () => {
    // Sample many draws so a stray out-of-alphabet character can't slip through by luck.
    for (let i = 0; i < 500; i++) {
      const code = generateVerificationCode();
      expect(code).toMatch(/^[0-9A-Z]{8}$/);
      for (const char of code) expect(CROCKFORD_ALPHABET).toContain(char);
    }
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ILOU]/);
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
  });

  it("varies between calls (CSPRNG-backed, not constant)", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateVerificationCode()));
    // 50 draws from ~40 bits of entropy: a collision is astronomically unlikely, so expect near-50.
    expect(codes.size).toBeGreaterThan(45);
  });
});
