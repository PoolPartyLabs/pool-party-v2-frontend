/**
 * @name email — tests
 * Covers the lenient email-shape check (accept typical addresses, reject obvious typos).
 */
import { describe, expect, it } from "vitest";
import { isValidEmail } from "./email";

describe("isValidEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidEmail("maria@email.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.domain.co")).toBe(true);
    expect(isValidEmail("  trimmed@example.com  ")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidEmail("maria@email")).toBe(false);
    expect(isValidEmail("maria.email.com")).toBe(false);
    expect(isValidEmail("two@@at.com")).toBe(false);
    expect(isValidEmail("with space@email.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});
